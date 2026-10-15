import { Injectable } from "@nestjs/common";
import crypto from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { InstagramService } from "./instagram.service.js";
import { MEDIA_ROUTE, isValidMediaFile, mediaDir, safeError, storyFileName } from "./ig-publisher.logic.js";
import { MAX_UPLOAD_BYTES, MEDIA_BASE_FIELDS, MEDIA_FIELDS, MEDIA_LIMIT, MEDIA_TTL_MS, PROFILE_BASE_FIELDS, PROFILE_FIELDS, PROFILE_TTL_MS, STORY_FIELDS, TZ,
  isFieldError, isJpeg, isPng, normalizeMedia, normalizeProfile, parseSchedule, queueActionPlan, weekStart, wantsContactSince } from "./ig-panel.logic.js";

// Panel "Instagram" sekmesi: canlı profil/gönderiler (graph.instagram.com, önbellekli), hikâye kuyruğu yönetimi,
// bot etkinliği ve özet sayılar. Instagram yapılandırması yoksa profil/medya null döner, DB verileri yine gösterilir.

export class PanelError extends Error { constructor(readonly status: number, message: string) { super(message); } }

const DAY = 86_400_000;
const PERMALINK_LOOKUPS = 15;

@Injectable()
export class IgPanelService {
  private profileCache: { at: number; data: ReturnType<typeof normalizeProfile> } | null = null;
  private mediaCache: { at: number; data: any } | null = null;
  private permalinks = new Map<string, string | null>();

  constructor(private readonly prisma: PrismaService, private readonly ig: InstagramService) {}

  private get client() { return this.ig.client; }
  get connected() { return !!this.client; }

  // Alan desteklenmiyorsa (kod 100) temel alanlarla yeniden denenir.
  private async readFields(base: string, full: string, fallback: string, what: string) {
    try { return await this.client!.read(`${base}fields=${full}`, what); }
    catch (e) { if (!isFieldError(e)) throw e; return this.client!.read(`${base}fields=${fallback}`, what); }
  }

  async profile(force = false, now = Date.now()) {
    if (!this.client) return null;
    if (!force && this.profileCache && now - this.profileCache.at < PROFILE_TTL_MS) return this.profileCache.data;
    const data = normalizeProfile(await this.readFields("me?", PROFILE_FIELDS, PROFILE_BASE_FIELDS, "Profil"));
    this.profileCache = { at: now, data };
    return data;
  }

  async kpis(now = new Date()) {
    const since = new Date(now.getTime() - 7 * DAY);
    const safe = <T>(p: Promise<T>) => p.catch(() => null);
    const posts = this.prisma.igScheduledPost;
    const botLeads = safe(this.prisma.igConversation.findMany({ where: { leadId: { not: null } }, select: { leadId: true } }));
    const [queued, publishedWeek, leadRows, commentTriggers, wantRows] = await Promise.all([
      safe(posts.count({ where: { status: { in: ["queued", "publishing"] } } })),
      safe(posts.count({ where: { status: "published", publishedAt: { gte: weekStart(now) } } })),
      botLeads,
      safe(this.prisma.igCommentEvent.count({ where: { handledAt: { gte: since } } })),
      safe(this.prisma.hashValue.findMany({ where: { bucket: "leads", value: { contains: '"inboundWantsContactVia":"instagram"' } }, select: { value: true } })),
    ]);
    // Bot analizleri: Instagram kaynaklı analiz istekleri içinde bot konuşmalarına bağlı firmalar.
    const ids = [...new Set((leadRows || []).map((r: any) => r.leadId).filter(Boolean))] as string[];
    const dmAnalyses = leadRows == null ? null : ids.length
      ? await safe(this.prisma.publicAuditRequest.count({ where: { source: "instagram", createdAt: { gte: since }, leadId: { in: ids } } }))
      : 0;
    return {
      storiesQueued: queued, storiesPublishedWeek: publishedWeek, dmAnalyses7d: dmAnalyses, commentTriggers7d: commentTriggers,
      wantsContact7d: wantRows == null ? null : wantRows.filter((r: any) => wantsContactSince(r.value, since)).length,
    };
  }

  async overview(force = false) {
    let profile = null, profileError: string | null = null;
    try { profile = await this.profile(force); } catch (e) { profileError = safeError(e); }
    return { connected: this.connected, profile, profileError, kpis: await this.kpis() };
  }

  // Son gönderiler (en fazla 36, sayfalanarak) + etkin hikâyeler. IG CDN adresleri süreli olduğu için kısa önbellek.
  async media(force = false, now = Date.now()) {
    if (!this.client) return { connected: false, items: [], stories: [] };
    if (!force && this.mediaCache && now - this.mediaCache.at < MEDIA_TTL_MS) return this.mediaCache.data;
    const items: ReturnType<typeof normalizeMedia>[] = [];
    let fields = MEDIA_FIELDS, after = "";
    for (let page = 0; page < 4 && items.length < MEDIA_LIMIT; page++) {
      const q = `me/media?limit=${Math.min(25, MEDIA_LIMIT - items.length)}${after ? `&after=${encodeURIComponent(after)}` : ""}&`;
      let j: any;
      try { j = await this.client.read(`${q}fields=${fields}`, "Gönderiler"); }
      catch (e) { if (!isFieldError(e) || fields === MEDIA_BASE_FIELDS) throw e; fields = MEDIA_BASE_FIELDS; j = await this.client.read(`${q}fields=${fields}`, "Gönderiler"); }
      for (const m of Array.isArray(j?.data) ? j.data : []) if (m?.id) items.push(normalizeMedia(m));
      after = typeof j?.paging?.cursors?.after === "string" && j?.paging?.next ? j.paging.cursors.after : "";
      if (!after) break;
    }
    let stories: ReturnType<typeof normalizeMedia>[] = [], storiesError: string | null = null;
    try {
      const j = await this.client.read(`me/stories?fields=${STORY_FIELDS}`, "Hikâyeler");
      stories = (Array.isArray(j?.data) ? j.data : []).filter((m: any) => m?.id).map(normalizeMedia);
    } catch (e) { storiesError = safeError(e); }
    const data = { connected: true, items: items.slice(0, MEDIA_LIMIT), stories, storiesError };
    this.mediaCache = { at: now, data };
    return data;
  }

  private async permalink(mediaId: string) {
    if (this.permalinks.has(mediaId)) return this.permalinks.get(mediaId) ?? null;
    if (!this.client || !/^\d{1,40}$/.test(mediaId)) return null;
    try {
      const j = await this.client.read(`${encodeURIComponent(mediaId)}?fields=permalink`, "Permalink");
      const url = normalizeMedia({ id: mediaId, permalink: j?.permalink }).permalink;
      this.permalinks.set(mediaId, url);
      return url;
    } catch { return null; } // hikâyeler 24 saat sonra erişilemez olabilir; bir sonraki yüklemede yeniden denenir
  }

  async queue() {
    const since = new Date(Date.now() - 30 * DAY);
    const rows = await this.prisma.igScheduledPost.findMany({
      where: { OR: [{ status: { in: ["queued", "publishing"] } }, { scheduledAt: { gte: since } }] },
      orderBy: { scheduledAt: "desc" }, take: 200,
    });
    let lookups = 0;
    const items = [];
    for (const r of rows) {
      let permalink: string | null = null;
      if (r.mediaId && (this.permalinks.has(r.mediaId) || lookups++ < PERMALINK_LOOKUPS)) permalink = await this.permalink(r.mediaId);
      items.push({
        id: r.id, kind: r.kind, fileName: r.fileName, imageUrl: isValidMediaFile(r.fileName) ? `${MEDIA_ROUTE}/${r.fileName}` : null,
        scheduledAt: r.scheduledAt, status: r.status, attempts: r.attempts, nextAttemptAt: r.nextAttemptAt,
        mediaId: r.mediaId, permalink, error: r.error, publishedAt: r.publishedAt, createdAt: r.createdAt,
      });
    }
    return { connected: this.connected, publisherEnabled: this.connected && process.env.IG_PUBLISHER !== "0" && process.env.AUDIT_WORKER !== "0", timeZone: TZ, items };
  }

  // Yükleme: yalnızca JPEG (sharp bağımlılığı yok; panel PNG'yi tarayıcıda JPEG'e çevirir). Dosya IG_MEDIA_DIR'e yazılır, hikâye kuyruğa eklenir.
  async upload(file: { buffer?: Buffer; size?: number; originalname?: string } | undefined, scheduledAt: unknown, now = new Date()) {
    const buf = file?.buffer;
    if (!buf?.length) throw new PanelError(400, "Görsel seçilmedi");
    if (buf.length > MAX_UPLOAD_BYTES) throw new PanelError(413, "Görsel 8 MB sınırını aşıyor");
    if (!isJpeg(buf)) throw new PanelError(415, isPng(buf) ? "PNG doğrudan kabul edilmiyor; JPEG'e çevirip yükleyin" : "Yalnızca JPEG görsel yüklenebilir");
    const when = parseSchedule(scheduledAt, now);
    if (!when.ok) throw new PanelError(400, when.error);
    const dir = mediaDir();
    await mkdir(dir, { recursive: true });
    let fileName = storyFileName(String(file?.originalname || "story").slice(0, 200), when.at, TZ);
    for (let i = 0; ; i++) {
      try { await writeFile(path.join(dir, fileName), buf, { flag: "wx", mode: 0o644 }); break; }
      catch (e: any) {
        if (e?.code !== "EEXIST" || i >= 4) throw new PanelError(500, "Görsel kaydedilemedi");
        fileName = fileName.replace(/(-[0-9a-f]{6})?\.jpg$/, `-${crypto.randomBytes(3).toString("hex")}.jpg`);
      }
    }
    try {
      const row = await this.prisma.igScheduledPost.create({ data: { kind: "story", fileName, scheduledAt: when.at, status: "queued" } });
      return { id: row.id, fileName, scheduledAt: row.scheduledAt, status: row.status };
    } catch (e) {
      await unlink(path.join(dir, fileName)).catch(() => {});
      throw e;
    }
  }

  // İptal / yeniden zamanla / şimdi paylaş. Durum koşulu sorguda: yayıncı satırı aynı anda sahiplendiyse 409.
  async update(id: string, body: any, now = new Date()) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new PanelError(404, "Kayıt bulunamadı");
    const plan = queueActionPlan(body?.action, body?.scheduledAt, now);
    if (!plan.ok) throw new PanelError(400, plan.error);
    const posts = this.prisma.igScheduledPost;
    const r = await posts.updateMany({ where: { id, status: { in: plan.from } }, data: plan.data as any });
    if (!r.count) {
      const cur = await posts.findUnique({ where: { id } });
      if (!cur) throw new PanelError(404, "Kayıt bulunamadı");
      throw new PanelError(409, `Bu işlem "${cur.status}" durumundaki hikâyede yapılamaz`);
    }
    return posts.findUnique({ where: { id } });
  }

  async activity() {
    const [conversations, comments] = await Promise.all([
      this.prisma.igConversation.findMany({ orderBy: { updatedAt: "desc" }, take: 30,
        select: { igsid: true, username: true, state: true, domain: true, leadId: true, lastScore: true, auditsTotal: true, messagesIn: true, handoffUntil: true, updatedAt: true } }),
      this.prisma.igCommentEvent.findMany({ orderBy: { handledAt: "desc" }, take: 30 }),
    ]);
    return {
      conversations: conversations.map(({ igsid, ...c }) => ({ id: igsid.slice(-6), ...c })),
      comments: comments.map((c) => ({ id: c.commentId, mediaId: c.mediaId, username: c.username, action: c.action, handledAt: c.handledAt })),
    };
  }
}
