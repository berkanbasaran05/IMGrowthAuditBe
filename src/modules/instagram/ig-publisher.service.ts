import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { stat } from "node:fs/promises";
import path from "node:path";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { InstagramService } from "./instagram.service.js";
import { DEFAULT_MAX_LATE_MS, PUBLISHING_STALE_MS, STATUS_POLL_DELAYS_MS, isValidMediaFile, mediaDir, mediaUrl, retryPlan, safeError } from "./ig-publisher.logic.js";

// Zamanlanmış hikâye yayıncısı. Dakikada bir zamanı gelen 'queued' satırları sahiplenir (FOR UPDATE SKIP LOCKED;
// birden fazla örnek güvenle çalışır), STORIES kapsayıcısı oluşturur, durum FINISHED olunca yayınlar.
// Hata: en fazla 3 deneme (5 dk, 15 dk arayla), sonra 'failed'. Kapatma: IG_PUBLISHER=0 veya AUDIT_WORKER=0.

const TICK_MS = 60_000;
const PER_TICK = 3;

class PermanentError extends Error {}

export interface ClaimedPost { id: string; fileName: string; containerId: string | null; attempts: number; scheduledAt: Date }

@Injectable()
export class IgPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("IgPublisher");
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  constructor(private readonly prisma: PrismaService, private readonly ig: InstagramService) {}

  private get client() { return this.ig.client; }

  onModuleInit() {
    if (process.env.IG_PUBLISHER === "0" || process.env.AUDIT_WORKER === "0" || !process.env.DATABASE_URL) return;
    if (!this.client) { this.log.log("Hikâye yayıncısı kapalı (Instagram yapılandırması yok)"); return; }
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
      const late = await posts.updateMany({ where: { status: "queued", scheduledAt: { lt: new Date(now.getTime() - maxLate) } }, data: { status: "failed", error: `Zamanı ${Math.round(maxLate / 3_600_000)} saatten fazla geçti; yayınlanmadı` } });
      if (late.count) this.log.warn(`${late.count} hikâye zamanı geçtiği için atlandı`);
      for (let i = 0; i < PER_TICK; i++) {
        const row = await this.claim(now);
        if (!row) break;
        await this.processRow(row, now);
      }
    } catch (e: any) { this.log.warn(`Hikâye yayıncısı turu başarısız: ${safeError(e)}`); }
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
      RETURNING "id", "file_name" AS "fileName", "container_id" AS "containerId", "attempts", "scheduled_at" AS "scheduledAt"`;
    return rows[0] ?? null;
  }

  async processRow(row: ClaimedPost, now = new Date()): Promise<"published" | "queued" | "failed"> {
    const posts = this.prisma.igScheduledPost;
    try {
      const mediaId = await this.publishStory(row);
      await posts.update({ where: { id: row.id }, data: { status: "published", mediaId, publishedAt: new Date(), error: null, nextAttemptAt: null } });
      this.log.log(`Hikâye yayınlandı: ${row.fileName}${mediaId ? ` (medya ${mediaId})` : ""}`);
      return "published";
    } catch (e) {
      const plan = e instanceof PermanentError ? { status: "failed" as const, nextAttemptAt: null } : retryPlan(row.attempts, now);
      const error = safeError(e);
      await posts.update({ where: { id: row.id }, data: { status: plan.status, nextAttemptAt: plan.nextAttemptAt, error } });
      this.log.warn(`Hikâye yayınlanamadı (${row.fileName}, deneme ${row.attempts}, ${plan.status}): ${error}`);
      return plan.status;
    }
  }

  // Kapsayıcı varsa (önceki deneme) önce durumu sorulur: PUBLISHED → yinelenmez; FINISHED → yalnızca yayınla.
  private async publishStory(row: ClaimedPost): Promise<string | null> {
    const client = this.client;
    if (!client) throw new Error("Instagram yapılandırması yok");
    if (!isValidMediaFile(row.fileName)) throw new PermanentError("Geçersiz dosya adı");
    if (!row.fileName.endsWith(".jpg")) throw new PermanentError("Instagram yalnızca JPEG kabul ediyor; dosyayı .jpg olarak zamanlayın");
    const st = await stat(path.join(mediaDir(), row.fileName)).catch(() => null);
    if (!st?.isFile()) throw new PermanentError(`Dosya bulunamadı: ${row.fileName}`);
    if (st.size > 8 * 1024 * 1024) throw new PermanentError("Görsel 8 MB sınırını aşıyor");

    let containerId = row.containerId;
    if (containerId) {
      const s = await client.containerStatus(containerId).catch(() => ({ code: "ERROR" }));
      if (s.code === "PUBLISHED") return null;
      if (s.code === "FINISHED") return client.publishMedia(containerId);
      if (s.code !== "IN_PROGRESS") containerId = null;
    }
    if (!containerId) {
      containerId = await client.createStoryContainer(mediaUrl(row.fileName));
      await this.prisma.igScheduledPost.update({ where: { id: row.id }, data: { containerId } });
    }
    for (const delay of STATUS_POLL_DELAYS_MS) {
      await this.sleep(delay);
      const s = await client.containerStatus(containerId);
      if (s.code === "FINISHED") return client.publishMedia(containerId);
      if (s.code === "PUBLISHED") return null;
      if (s.code === "ERROR" || s.code === "EXPIRED") {
        await this.prisma.igScheduledPost.update({ where: { id: row.id }, data: { containerId: null } });
        throw new Error(`Kapsayıcı ${s.code}${s.status ? `: ${s.status}` : ""}`);
      }
    }
    throw new Error("Kapsayıcı 2 dakikada hazır olmadı; sonraki denemede yeniden sorulacak");
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
        id: r.id, kind: r.kind, fileName: r.fileName, imageUrl: isValidMediaFile(r.fileName) ? mediaUrl(r.fileName) : null,
        scheduledAt: r.scheduledAt, status: r.status, attempts: r.attempts, nextAttemptAt: r.nextAttemptAt,
        mediaId: r.mediaId, error: r.error, publishedAt: r.publishedAt, createdAt: r.createdAt,
      })),
    };
  }
}
