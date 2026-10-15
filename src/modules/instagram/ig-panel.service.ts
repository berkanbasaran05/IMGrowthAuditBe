import { Injectable } from "@nestjs/common";
import crypto from "node:crypto";
import { constants as fsc } from "node:fs";
import { copyFile, link, mkdir, open as fopen, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { InstagramService } from "./instagram.service.js";
import { KIND_LABEL, MEDIA_ROUTE, type PostKind, feedRatioError, isKind, isValidMediaFile, isVideoFile, jpegSize, maxBytesFor, mediaDir, mediaFileName,
  rowFiles, safeError, validateCaption, validateMediaSet, videoExt } from "./ig-publisher.logic.js";
import { MAX_UPLOAD_BYTES, MEDIA_BASE_FIELDS, MEDIA_FIELDS, MEDIA_LIMIT, MEDIA_TTL_MS, PROFILE_BASE_FIELDS, PROFILE_FIELDS, PROFILE_TTL_MS, STORY_FIELDS, TZ,
  isFieldError, isJpeg, isPng, normalizeMedia, normalizeProfile, parseOrder, parseSchedule, queueActionPlan, weekStart, wantsContactSince } from "./ig-panel.logic.js";

// Panel "Instagram" sekmesi: canlı profil/gönderiler (graph.instagram.com, önbellekli), hikâye kuyruğu yönetimi,
// bot etkinliği ve özet sayılar. Instagram yapılandırması yoksa profil/medya null döner, DB verileri yine gösterilir.

export class PanelError extends Error { constructor(readonly status: number, message: string) { super(message); } }

// Yüklenen dosya: multer diskStorage ({path,size}) ya da bellek ({buffer}; testler ve eski uç).
export interface Upload { buffer?: Buffer; path?: string; size?: number; originalname?: string }
export interface Uploads { files?: Upload[]; image?: Upload[]; cover?: Upload[] }
interface Checked { up: Upload; ext: "jpg" | "mp4" | "mov" }

const sizeOf = async (f: Upload) => f.buffer?.length ?? f.size ?? (f.path ? (await stat(f.path)).size : 0);
async function headOf(f: Upload, bytes: number): Promise<Buffer> {
  if (f.buffer) return f.buffer.subarray(0, bytes);
  if (!f.path) return Buffer.alloc(0);
  const h = await fopen(f.path, "r");
  try { const b = Buffer.alloc(bytes); const { bytesRead } = await h.read(b, 0, bytes, 0); return b.subarray(0, bytesRead); }
  finally { await h.close(); }
}
const tempCleanup = (u?: Uploads) => Promise.all([...(u?.files || []), ...(u?.image || []), ...(u?.cover || [])].map((f) => (f.path ? unlink(f.path).catch(() => {}) : null)));

const DAY = 86_400_000;
const PERMALINK_LOOKUPS = 15;

@Injectable()
export class IgPanelService {
  private profileCache: { at: number; data: ReturnType<typeof normalizeProfile> } | null = null;
  private mediaCache: { at: number; data: any } | null = null;
  private permalinks = new Map<string, string | null>();
  private quotaCache: { at: number; data: { used: number; total: number | null } | null } | null = null;

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
      queued, publishedWeek, dmAnalyses7d: dmAnalyses, commentTriggers7d: commentTriggers,
      wantsContact7d: wantRows == null ? null : wantRows.filter((r: any) => wantsContactSince(r.value, since)).length,
    };
  }

  async overview(force = false) {
    let profile = null, profileError: string | null = null;
    try { profile = await this.profile(force); } catch (e) { profileError = safeError(e); }
    return { connected: this.connected, profile, profileError, kpis: await this.kpis(), quota: await this.quota(force) };
  }

  // Yayın kotası (content_publishing_limit). En iyi çaba, 5 dk önbellek.
  async quota(force = false, now = Date.now()) {
    if (!this.client) return null;
    if (!force && this.quotaCache && now - this.quotaCache.at < PROFILE_TTL_MS) return this.quotaCache.data;
    let data: { used: number; total: number | null } | null = null;
    try { const q = await this.client.publishingLimit(); data = { used: q.used, total: q.total }; } catch { data = null; }
    this.quotaCache = { at: now, data };
    return data;
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
      const files = rowFiles(r).filter(isValidMediaFile).map((f) => ({ name: f, url: `${MEDIA_ROUTE}/${f}`, type: isVideoFile(f) ? "video" : "image" }));
      const cover = r.coverFile && isValidMediaFile(r.coverFile) ? `${MEDIA_ROUTE}/${r.coverFile}` : null;
      items.push({
        id: r.id, kind: r.kind, caption: r.caption ?? null, fileName: r.fileName, files, coverUrl: cover,
        imageUrl: cover || files.find((f) => f.type === "image")?.url || null,
        scheduledAt: r.scheduledAt, status: r.status, attempts: r.attempts, nextAttemptAt: r.nextAttemptAt,
        // Kapsayıcı Meta'da işleniyor (ör. Reels videosu): satır sırada, işçi dakikada bir durumu sorar.
        processing: r.status === "queued" && !!r.containerId && new Date(r.scheduledAt).getTime() <= Date.now(),
        mediaId: r.mediaId, permalink, error: r.error, publishedAt: r.publishedAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
      });
    }
    return { connected: this.connected, publisherEnabled: this.connected && process.env.IG_PUBLISHER !== "0" && process.env.AUDIT_WORKER !== "0", timeZone: TZ, items };
  }

  // Eski uç (tek hikâye görseli). Yeni panel create() kullanır.
  upload(file: Upload | undefined, scheduledAt: unknown, now = new Date()) {
    return this.create({ kind: "story", scheduledAt }, { files: file ? [file] : [] }, now);
  }

  // Dosya içeriği koklanır (uzantı/mimetype'a güvenilmez): JPEG ≤ 8 MB, MP4/MOV (hikâye ≤ 100 MB, Reels ≤ 300 MB).
  // Akış görselleri (gönderi/karusel) 4:5 – 1.91:1 aralığında olmalı.
  private async check(f: Upload, kind: PostKind, role: "main" | "cover"): Promise<Checked> {
    const size = await sizeOf(f);
    if (!size) throw new PanelError(400, "Dosya boş");
    const head = await headOf(f, 64);
    if (isJpeg(head)) {
      if (size > MAX_UPLOAD_BYTES) throw new PanelError(413, "Görsel 8 MB sınırını aşıyor");
      if (role === "main" && (kind === "image" || kind === "carousel")) {
        const err = feedRatioError(jpegSize(f.buffer ?? (f.path ? await readFile(f.path) : Buffer.alloc(0))));
        if (err) throw new PanelError(422, err);
      }
      return { up: f, ext: "jpg" };
    }
    if (isPng(head)) throw new PanelError(415, "PNG doğrudan kabul edilmiyor; JPEG'e çevirip yükleyin");
    const v = videoExt(head);
    if (v) {
      if (role === "cover" || kind === "image" || kind === "carousel") throw new PanelError(415, `${role === "cover" ? "Kapak" : KIND_LABEL[kind]} için yalnızca JPEG görsel kullanılabilir`);
      const max = maxBytesFor(kind, `x.${v}`);
      if (size > max) throw new PanelError(413, `Video ${Math.round(max / 1048576)} MB sınırını aşıyor`);
      return { up: f, ext: v };
    }
    throw new PanelError(415, kind === "image" || kind === "carousel" || role === "cover" ? "Yalnızca JPEG görsel yüklenebilir" : "Yalnızca JPEG görsel ya da MP4/MOV video yüklenebilir");
  }

  // Dosyayı IG_MEDIA_DIR'e benzersiz adla koyar (üzerine yazmaz). Disk yüklemesi aynı dizindeki geçici klasörden bağlanır.
  private async persist(c: Checked, kind: PostKind, at: Date, idx: number): Promise<string> {
    const dir = mediaDir();
    await mkdir(dir, { recursive: true });
    const src = String(c.up.originalname || kind).slice(0, 200);
    let name = mediaFileName(kind, src, at, TZ, c.ext);
    if (idx > 0) name = name.replace(/\.(jpg|mp4|mov)$/, `-${idx + 1}.$1`);
    for (let i = 0; ; i++) {
      const dest = path.join(dir, name);
      try {
        if (c.up.buffer) await writeFile(dest, c.up.buffer, { flag: "wx", mode: 0o644 });
        else if (c.up.path) {
          try { await link(c.up.path, dest); } catch (e: any) { if (e?.code !== "EXDEV") throw e; await copyFile(c.up.path, dest, fsc.COPYFILE_EXCL); }
        } else throw new Error("dosya yok");
        return name;
      } catch (e: any) {
        if (e?.code !== "EEXIST" || i >= 4) throw new PanelError(500, "Dosya kaydedilemedi");
        name = name.replace(/(-[0-9a-f]{6})?\.(jpg|mp4|mov)$/, `-${crypto.randomBytes(3).toString("hex")}.$2`);
      }
    }
  }

  private async removeFiles(names: string[]) {
    await Promise.all(names.filter(isValidMediaFile).map((n) => unlink(path.join(mediaDir(), n)).catch(() => {})));
  }

  // Başka satırın kullanmadığı dosyaları siler (düzenlemede çıkarılan medya).
  private async removeUnreferenced(names: string[], exceptId: string) {
    const posts = this.prisma.igScheduledPost;
    const drop: string[] = [];
    for (const n of names.filter(isValidMediaFile)) {
      const used = await posts.count({ where: { id: { not: exceptId }, OR: [{ fileName: n }, { coverFile: n }, { mediaFiles: { array_contains: [n] } }] } }).catch(() => 1);
      if (!used) drop.push(n);
    }
    await this.removeFiles(drop);
  }

  // Yeni içerik: tür, açıklama, dosyalar (sırasıyla), isteğe bağlı Reels kapağı, İstanbul saatiyle zaman.
  async create(body: any, uploads: Uploads | undefined, now = new Date()) {
    const written: string[] = [];
    try {
      const kind = body?.kind == null || body.kind === "" ? "story" : body.kind;
      if (!isKind(kind)) throw new PanelError(400, "Geçersiz içerik türü");
      const ups = [...(uploads?.files || []), ...(uploads?.image || [])];
      if (!ups.length) throw new PanelError(400, "Dosya seçilmedi");
      const cap = validateCaption(kind, body?.caption);
      if (!cap.ok) throw new PanelError(400, cap.error!);
      const when = parseSchedule(body?.scheduledAt, now);
      if (!when.ok) throw new PanelError(400, when.error!);
      const checked: Checked[] = [];
      for (const u of ups) checked.push(await this.check(u, kind, "main"));
      const setErr = validateMediaSet(kind, checked.map((c, i) => `f${i}.${c.ext}`));
      if (setErr) throw new PanelError(400, setErr);
      const coverUp = uploads?.cover?.[0];
      if (coverUp && kind !== "reels") throw new PanelError(400, "Kapak görseli yalnızca Reels için kullanılır");
      const cover = coverUp ? await this.check(coverUp, kind, "cover") : null;
      for (let i = 0; i < checked.length; i++) written.push(await this.persist(checked[i], kind, when.at!, checked.length > 1 ? i : 0));
      const coverFile = cover ? await this.persist({ ...cover }, "cover" as PostKind, when.at!, 0) : null;
      if (coverFile) written.push(coverFile);
      const row = await this.prisma.igScheduledPost.create({ data: {
        kind, fileName: written[0], mediaFiles: written.slice(0, checked.length), coverFile, caption: cap.value ?? null, scheduledAt: when.at!, status: "queued",
      } as any });
      return { id: row.id, kind, fileName: written[0], files: written.slice(0, checked.length), scheduledAt: row.scheduledAt, status: row.status };
    } catch (e) {
      await this.removeFiles(written);
      throw e;
    } finally { await tempCleanup(uploads); }
  }

  // Sıradaki içeriği düzenle: açıklama, zaman, dosyalar (sıra/ekle/çıkar), kapak. Tür değişmez. Meta kapsayıcısı sıfırlanır.
  async edit(id: string, body: any, uploads: Uploads | undefined, now = new Date()) {
    const written: string[] = [];
    try {
      if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new PanelError(404, "Kayıt bulunamadı");
      const posts = this.prisma.igScheduledPost;
      const row: any = await posts.findUnique({ where: { id } });
      if (!row) throw new PanelError(404, "Kayıt bulunamadı");
      if (row.status !== "queued") throw new PanelError(409, `Yalnızca sıradaki içerik düzenlenebilir (durum: ${row.status})`);
      const kind: PostKind = isKind(row.kind) ? row.kind : "story";
      const data: Record<string, unknown> = {};
      if (body?.scheduledAt != null && body.scheduledAt !== "") {
        const when = parseSchedule(body.scheduledAt, now);
        if (!when.ok) throw new PanelError(400, when.error!);
        data.scheduledAt = when.at;
      }
      if (body && "caption" in body) {
        const cap = validateCaption(kind, body.caption);
        if (!cap.ok) throw new PanelError(400, cap.error!);
        data.caption = cap.value ?? null;
      }
      const current = rowFiles(row);
      const newUps = [...(uploads?.files || []), ...(uploads?.image || [])];
      const checked: Checked[] = [];
      for (const u of newUps) checked.push(await this.check(u, kind, "main"));
      let next: ({ old: string } | { neu: number })[] | null = null;
      if (body?.order != null && body.order !== "") {
        const o = parseOrder(body.order, current, checked.length);
        if (!o.ok) throw new PanelError(400, o.error!);
        next = o.order!;
      } else if (checked.length) next = checked.map((_, i) => ({ neu: i }));
      const coverUp = uploads?.cover?.[0];
      if (coverUp && kind !== "reels") throw new PanelError(400, "Kapak görseli yalnızca Reels için kullanılır");
      const cover = coverUp ? await this.check(coverUp, kind, "cover") : null;
      const removeCover = body?.removeCover === true || body?.removeCover === "1" || body?.removeCover === "true";
      let files = current;
      if (next) {
        const tentative = next.map((t) => ("old" in t ? t.old : `n${t.neu}.${checked[t.neu].ext}`));
        const setErr = validateMediaSet(kind, tentative);
        if (setErr) throw new PanelError(400, setErr);
        const at = (data.scheduledAt as Date) || new Date(row.scheduledAt);
        const names: string[] = [];
        for (let i = 0; i < next.length; i++) {
          const t = next[i];
          if ("old" in t) names.push(t.old);
          else { const n = await this.persist(checked[t.neu], kind, at, next.length > 1 ? i : 0); written.push(n); names.push(n); }
        }
        files = names;
        Object.assign(data, { fileName: files[0], mediaFiles: files });
      }
      let coverFile: string | null = row.coverFile ?? null;
      if (cover) { coverFile = await this.persist(cover, "cover" as PostKind, (data.scheduledAt as Date) || new Date(row.scheduledAt), 0); written.push(coverFile); data.coverFile = coverFile; }
      else if (removeCover) { coverFile = null; data.coverFile = null; }
      if (!Object.keys(data).length) throw new PanelError(400, "Değişiklik yok");
      Object.assign(data, { containerId: null, childIds: null, containerCreatedAt: null, error: null, nextAttemptAt: null, attempts: 0 });
      const r = await posts.updateMany({ where: { id, status: "queued" }, data: data as any });
      if (!r.count) throw new PanelError(409, "İçerik bu sırada yayına alındı; düzenlenemedi");
      written.length = 0; // artık satıra ait
      const dropped = [...current.filter((f) => !files.includes(f)), ...(row.coverFile && row.coverFile !== coverFile ? [row.coverFile] : [])];
      await this.removeUnreferenced(dropped, id);
      return posts.findUnique({ where: { id } });
    } catch (e) {
      await this.removeFiles(written);
      throw e;
    } finally { await tempCleanup(uploads); }
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
      throw new PanelError(409, `Bu işlem "${cur.status}" durumundaki içerikte yapılamaz`);
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
