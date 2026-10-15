import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { stat } from "node:fs/promises";
import path from "node:path";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { InstagramService } from "./instagram.service.js";
import { DEFAULT_MAX_LATE_MS, INLINE_POLL_MS, KIND_LABEL, PROCESSING_DEADLINE_MS, PROCESSING_RECHECK_MS, PUBLISHING_STALE_MS, QUOTA_RECHECK_MS,
  type PostKind, isKind, isValidMediaFile, isVideoFile, maxBytesFor, mediaDir, mediaUrl, retryPlan, rowFiles, safeError, validateMediaSet } from "./ig-publisher.logic.js";

// Zamanlanmış içerik yayıncısı (hikâye, gönderi, karusel, Reels). Dakikada bir zamanı gelen 'queued' satırları
// sahiplenir (FOR UPDATE SKIP LOCKED; birden fazla örnek güvenle çalışır), kapsayıcı oluşturur, durum FINISHED olunca yayınlar.
// Video işleme dakikalar sürebildiği için işçi beklemez: kapsayıcı IN_PROGRESS ise satır 'queued' kalır, deneme hakkı
// geri verilir ve bir dakika sonra yeniden sorulur (PROCESSING_DEADLINE_MS'e kadar).
// Hata: en fazla 3 deneme (5 dk, 15 dk arayla), sonra 'failed'. Kapatma: IG_PUBLISHER=0 veya AUDIT_WORKER=0.

const TICK_MS = 60_000;
const PER_TICK = 3;

class PermanentError extends Error {}

export interface ClaimedPost {
  id: string; kind?: string; fileName: string; mediaFiles?: unknown; coverFile?: string | null; caption?: string | null;
  containerId: string | null; childIds?: unknown; containerCreatedAt?: Date | null; attempts: number; scheduledAt: Date;
}
type Outcome = { state: "published"; mediaId: string | null } | { state: "waiting"; delayMs: number; note: string | null };

@Injectable()
export class IgPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("IgPublisher");
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private quotaCache: { at: number; used: number; total: number | null } | null = null;
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  constructor(private readonly prisma: PrismaService, private readonly ig: InstagramService) {}

  private get client() { return this.ig.client; }

  onModuleInit() {
    if (process.env.IG_PUBLISHER === "0" || process.env.AUDIT_WORKER === "0" || !process.env.DATABASE_URL) return;
    if (!this.client) { this.log.log("İçerik yayıncısı kapalı (Instagram yapılandırması yok)"); return; }
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    setTimeout(() => void this.tick(), 15_000).unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick(now = new Date()) {
    if (this.running || !this.client) return;
    this.running = true;
    try {
      const posts = this.prisma.igScheduledPost;
      await posts.updateMany({ where: { status: "publishing", updatedAt: { lt: new Date(now.getTime() - PUBLISHING_STALE_MS) } }, data: { status: "queued" } });
      const maxLate = Number(process.env.IG_STORY_MAX_LATE_HOURS) > 0 ? Number(process.env.IG_STORY_MAX_LATE_HOURS) * 3_600_000 : DEFAULT_MAX_LATE_MS;
      // İşlenmekte olan kapsayıcısı olan satırlar (ör. Reels) gecikme kuralına takılmaz; kendi bekleme süreleri vardır.
      const late = await posts.updateMany({ where: { status: "queued", containerId: null, scheduledAt: { lt: new Date(now.getTime() - maxLate) } }, data: { status: "failed", error: `Zamanı ${Math.round(maxLate / 3_600_000)} saatten fazla geçti; yayınlanmadı` } });
      if (late.count) this.log.warn(`${late.count} içerik zamanı geçtiği için atlandı`);
      for (let i = 0; i < PER_TICK; i++) {
        const row = await this.claim(now);
        if (!row) break;
        await this.processRow(row, now);
      }
    } catch (e: any) { this.log.warn(`Yayıncı turu başarısız: ${safeError(e)}`); }
    finally { this.running = false; }
  }

  // Zamanı gelen tek satırı atomik olarak sahiplenir ve deneme sayısını artırır.
  async claim(now: Date): Promise<ClaimedPost | null> {
    const rows = await this.prisma.$queryRaw<ClaimedPost[]>`
      UPDATE "ig_scheduled_posts" SET "status" = 'publishing', "attempts" = "attempts" + 1, "updated_at" = ${now}
      WHERE "id" = (
        SELECT "id" FROM "ig_scheduled_posts"
        WHERE "status" = 'queued' AND "scheduled_at" <= ${now} AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ${now})
        ORDER BY "scheduled_at" LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "kind", "file_name" AS "fileName", "media_files" AS "mediaFiles", "cover_file" AS "coverFile", "caption",
        "container_id" AS "containerId", "child_container_ids" AS "childIds", "container_created_at" AS "containerCreatedAt",
        "attempts", "scheduled_at" AS "scheduledAt"`;
    return rows[0] ?? null;
  }

  async processRow(row: ClaimedPost, now = new Date()): Promise<"published" | "queued" | "failed" | "processing"> {
    const posts = this.prisma.igScheduledPost;
    const label = isKind(row.kind) ? KIND_LABEL[row.kind] : "Hikâye";
    try {
      const r = await this.publish(row, now);
      if (r.state === "waiting") {
        // Deneme hakkı geri verilir (claim artırmıştı); satır kısa süre sonra yeniden sahiplenilir.
        await posts.update({ where: { id: row.id }, data: { status: "queued", attempts: Math.max(0, row.attempts - 1), nextAttemptAt: new Date(now.getTime() + r.delayMs), error: r.note } });
        return "processing";
      }
      await posts.update({ where: { id: row.id }, data: { status: "published", mediaId: r.mediaId, publishedAt: new Date(), error: null, nextAttemptAt: null } });
      this.log.log(`${label} yayınlandı: ${row.fileName}${r.mediaId ? ` (medya ${r.mediaId})` : ""}`);
      return "published";
    } catch (e) {
      const plan = e instanceof PermanentError ? { status: "failed" as const, nextAttemptAt: null } : retryPlan(row.attempts, now);
      const error = safeError(e);
      await posts.update({ where: { id: row.id }, data: { status: plan.status, nextAttemptAt: plan.nextAttemptAt, error } });
      this.log.warn(`${label} yayınlanamadı (${row.fileName}, deneme ${row.attempts}, ${plan.status}): ${error}`);
      return plan.status;
    }
  }

  // Kota (content_publishing_limit) dolu mu? En iyi çaba: okunamazsa yayın denenir. 5 dk önbellek.
  private async quotaFull(now: Date) {
    try {
      if (!this.quotaCache || now.getTime() - this.quotaCache.at > 5 * 60_000) {
        const q = await this.client!.publishingLimit();
        this.quotaCache = { at: now.getTime(), used: q.used, total: q.total };
      }
      const { used, total } = this.quotaCache;
      return total != null && used >= total ? `Instagram yayın kotası dolu (${used}/${total}, 24 saat); ${Math.round(QUOTA_RECHECK_MS / 60_000)} dk sonra yeniden denenecek` : null;
    } catch { return null; }
  }

  private containerBody(kind: PostKind, files: string[], row: ClaimedPost): Record<string, unknown> {
    const url = mediaUrl(files[0]);
    const caption = row.caption ? { caption: row.caption } : {};
    if (kind === "story") return isVideoFile(files[0]) ? { media_type: "STORIES", video_url: url } : { media_type: "STORIES", image_url: url };
    if (kind === "reels") return { media_type: "REELS", video_url: url, share_to_feed: true, ...caption, ...(row.coverFile && isValidMediaFile(row.coverFile) ? { cover_url: mediaUrl(row.coverFile) } : {}) };
    return { image_url: url, ...caption };
  }

  private async clearContainer(id: string) {
    await this.prisma.igScheduledPost.update({ where: { id }, data: { containerId: null, childIds: null as any, containerCreatedAt: null } });
  }

  // Kapsayıcı varsa (önceki deneme/tur) önce durumu sorulur: PUBLISHED → yinelenmez; FINISHED → yalnızca yayınla;
  // IN_PROGRESS → beklemeye devam.
  private async publish(row: ClaimedPost, now: Date): Promise<Outcome> {
    const client = this.client;
    if (!client) throw new Error("Instagram yapılandırması yok");
    const kind: PostKind = isKind(row.kind) ? row.kind : "story";
    const files = rowFiles(row);
    const setErr = validateMediaSet(kind, files);
    if (setErr) throw new PermanentError(setErr.includes("JPEG") && kind === "story" ? "Instagram yalnızca JPEG kabul ediyor; dosyayı .jpg olarak zamanlayın" : setErr);
    for (const f of [...files, ...(row.coverFile ? [row.coverFile] : [])]) {
      if (!isValidMediaFile(f)) throw new PermanentError("Geçersiz dosya adı");
      const st = await stat(path.join(mediaDir(), f)).catch(() => null);
      if (!st?.isFile()) throw new PermanentError(`Dosya bulunamadı: ${f}`);
      const max = f === row.coverFile ? maxBytesFor("image", f) : maxBytesFor(kind, f);
      if (st.size > max) throw new PermanentError(`${f} ${Math.round(max / 1048576)} MB sınırını aşıyor`);
    }
    const posts = this.prisma.igScheduledPost;
    const isVideo = files.some(isVideoFile);
    const label = KIND_LABEL[kind];

    let containerId = row.containerId;
    let createdAt = row.containerCreatedAt ? new Date(row.containerCreatedAt) : null;
    if (containerId) {
      const s = await client.containerStatus(containerId).catch(() => ({ code: "ERROR" }));
      if (s.code === "PUBLISHED") return { state: "published", mediaId: null };
      if (s.code === "FINISHED") return { state: "published", mediaId: await client.publishMedia(containerId) };
      if (s.code !== "IN_PROGRESS") { containerId = null; await this.clearContainer(row.id); row.childIds = null; }
      else if (!createdAt) { createdAt = now; await posts.update({ where: { id: row.id }, data: { containerCreatedAt: now } }); }
    }
    if (!containerId) {
      const full = await this.quotaFull(now);
      if (full) return { state: "waiting", delayMs: QUOTA_RECHECK_MS, note: full };
      if (kind === "carousel") {
        let children = Array.isArray(row.childIds) && row.childIds.length === files.length && row.childIds.every((x) => typeof x === "string") ? (row.childIds as string[]) : null;
        if (!children) {
          children = [];
          for (const f of files) children.push(await client.createContainer({ image_url: mediaUrl(f), is_carousel_item: true }, "Karusel öğesi"));
          await posts.update({ where: { id: row.id }, data: { childIds: children } });
        }
        try {
          containerId = await client.createContainer({ media_type: "CAROUSEL", children: children.join(","), ...(row.caption ? { caption: row.caption } : {}) }, "Karusel kapsayıcısı");
        } catch (e) { await this.clearContainer(row.id); throw e; }
      } else {
        containerId = await client.createContainer(this.containerBody(kind, files, row), `${label} kapsayıcısı`);
      }
      createdAt = now;
      await posts.update({ where: { id: row.id }, data: { containerId, containerCreatedAt: now } });
    }
    for (const delay of INLINE_POLL_MS) {
      await this.sleep(delay);
      const s = await client.containerStatus(containerId);
      if (s.code === "FINISHED") return { state: "published", mediaId: await client.publishMedia(containerId) };
      if (s.code === "PUBLISHED") return { state: "published", mediaId: null };
      if (s.code === "ERROR" || s.code === "EXPIRED") {
        await this.clearContainer(row.id);
        throw new Error(`Kapsayıcı ${s.code}${s.status ? `: ${s.status}` : ""}`);
      }
    }
    const deadline = isVideo ? PROCESSING_DEADLINE_MS.video : PROCESSING_DEADLINE_MS.image;
    if (now.getTime() - (createdAt ?? now).getTime() > deadline) {
      await this.clearContainer(row.id);
      throw new Error(`Kapsayıcı ${Math.round(deadline / 60_000)} dakikada hazır olmadı; yeniden oluşturulacak`);
    }
    return { state: "waiting", delayMs: PROCESSING_RECHECK_MS, note: null };
  }

  async queue(limit = 200) {
    const since = new Date(Date.now() - 14 * 86_400_000);
    const rows = await this.prisma.igScheduledPost.findMany({
      where: { OR: [{ status: { in: ["queued", "publishing"] } }, { scheduledAt: { gte: since } }] },
      orderBy: { scheduledAt: "asc" }, take: limit,
    });
    return {
      enabled: !!this.client && process.env.IG_PUBLISHER !== "0" && process.env.AUDIT_WORKER !== "0",
      items: rows.map((r) => ({
        id: r.id, kind: r.kind, fileName: r.fileName, files: rowFiles(r), caption: r.caption, imageUrl: isValidMediaFile(r.fileName) ? mediaUrl(r.fileName) : null,
        scheduledAt: r.scheduledAt, status: r.status, attempts: r.attempts, nextAttemptAt: r.nextAttemptAt,
        mediaId: r.mediaId, error: r.error, publishedAt: r.publishedAt, createdAt: r.createdAt,
      })),
    };
  }
}
