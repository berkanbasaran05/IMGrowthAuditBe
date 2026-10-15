import { createHash } from "node:crypto";
import { DEFAULT_BACKEND_BASE } from "../sales/report.public.js";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { getOne, put } from "../growth/lib/redis.js";
import { decryptSecret, encryptionConfigured, encryptSecret } from "../growth-manager/security.js";
import { PublicAuditError, PublicAuditService, domainOf } from "../audit/public-audit.service.js";
import { IgClient, type TokenStore } from "./instagram.client.js";
import { ABOUT_QUICK, COPY, HANDOFF_MS, RESULT_QUICK, auditsUsedToday, dayKey, decide, progressLevel, resultCard, stepsText, parseWebhook, type IncomingMessage,
  COMMENT_COPY, COMMENT_DAILY_LIMIT, DAILY_AUDIT_LIMIT, PRIVATE_REPLY_WINDOW_MS, commentTrigger, parseComments, publicReplyFor, type IncomingComment } from "./instagram.logic.js";

// Instagram DM analiz botu. Durum ig_conversations tablosunda tutulur; bekleyen analizler 15 sn'de bir
// yoklanır (sunucu yeniden başlasa da sonuç gönderilir). Ekibe Telegram/e-posta bildirimi GÖNDERİLMEZ:
// ekip Instagram'dan elle yanıtlar; talepler Gelen Talepler'de görünür.

const POLL_MS = 15_000;
const REFRESH_CHECK_MS = 6 * 3_600_000;
const REFRESH_EVERY_MS = 7 * 86_400_000;
const AUDIT_GIVEUP_MS = 20 * 60_000;
const SENDING_STALE_MS = 5 * 60_000;
const TOKEN_KEY = "ig:access_token";
const DEFAULT_BASE = DEFAULT_BACKEND_BASE;

export const reportBase = () => (process.env.PUBLIC_REPORT_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");

@Injectable()
export class InstagramService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("InstagramBot");
  private timers: NodeJS.Timeout[] = [];
  private polling = false;
  client: IgClient | null;

  constructor(private readonly prisma: PrismaService, private readonly publicAudits: PublicAuditService) {
    this.client = IgClient.fromEnv(this.tokenStore());
  }

  get enabled() { return !!this.client; }

  onModuleInit() {
    if (!this.client) { this.log.log("Instagram botu kapalı (IG_* ortam değişkenleri eksik)"); return; }
    if (process.env.AUDIT_WORKER === "0" || !process.env.DATABASE_URL) return;
    this.timers.push(setInterval(() => void this.pollPending(), POLL_MS));
    this.timers.push(setInterval(() => void this.maybeRefreshToken(), REFRESH_CHECK_MS));
    setTimeout(() => void this.maybeRefreshToken(), 30_000).unref?.();
  }
  onModuleDestroy() { for (const t of this.timers) clearInterval(t); }

  // Depodaki (otomatik yenilenen) belirteç, türetildiği env belirtecinin parmak izini (src) taşır. Env'e yeni belirteç
  // girilirse (ör. yeni izinle üretildi) parmak izi tutmaz: kayıt silinir, env belirteci kullanılır ve yenileme ondan devam eder.
  tokenStore(): TokenStore {
    const envFp = () => tokenFingerprint(process.env.IG_ACCESS_TOKEN || "");
    return {
      get: async () => {
        const row = await this.prisma.keyValue.findUnique({ where: { key: TOKEN_KEY } });
        if (!row) return null;
        const v = JSON.parse(row.value);
        if (process.env.IG_ACCESS_TOKEN && v.src !== envFp()) {
          await this.prisma.keyValue.deleteMany({ where: { key: TOKEN_KEY } });
          this.log.log("Env'de yeni Instagram belirteci var; depodaki belirteç sıfırlandı");
          return null;
        }
        return v.enc ? decryptSecret(v.t) : v.t;
      },
      set: async (token, expiresIn) => {
        const enc = encryptionConfigured();
        const value = JSON.stringify({ t: enc ? encryptSecret(token) : token, enc, src: envFp(), at: new Date().toISOString(), exp: new Date(Date.now() + expiresIn * 1000).toISOString() });
        await this.prisma.keyValue.upsert({ where: { key: TOKEN_KEY }, create: { key: TOKEN_KEY, value }, update: { value } });
      },
    };
  }

  async maybeRefreshToken() {
    if (!this.client) return;
    try {
      await this.client.token(); // env belirteci değiştiyse depodaki kayıt burada sıfırlanır
      const row = await this.prisma.keyValue.findUnique({ where: { key: TOKEN_KEY } });
      const at = row ? Date.parse(JSON.parse(row.value).at) : 0;
      if (Date.now() - at < REFRESH_EVERY_MS) return;
      const sec = await this.client.refresh();
      this.log.log(`Instagram belirteci yenilendi (${Math.round(sec / 86_400)} gün geçerli)`);
    } catch (e: any) { this.log.warn(`Instagram belirteci yenilenemedi: ${e.message}`); }
  }

  // Webhook gövdesi (imza doğrulanmış). Hatalar yutulur; Meta'ya her zaman 200 dönülür.
  async handleWebhook(body: any) {
    if (!this.client) return;
    for (const msg of parseWebhook(body, this.client.cfg.accountId)) {
      try { await this.handleMessage(msg); }
      catch (e: any) { this.log.warn(`DM işlenemedi: ${e.message}`); }
    }
    for (const c of parseComments(body, this.client.cfg.accountId, process.env.IG_ACCOUNT_USERNAME || "")) {
      try { await this.handleComment(c); }
      catch (e: any) { this.log.warn(`Yorum işlenemedi: ${e.message}`); }
    }
  }

  // Aynı mesaj kimliği (mid) ikinci kez işlenmez (Meta yeniden deneyebilir).
  private async firstSeen(mid: string) {
    try {
      await this.prisma.keyValue.create({ data: { key: `ig:mid:${mid}`.slice(0, 300), value: "1", expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
      return true;
    } catch (e: any) { if (e?.code === "P2002") return false; throw e; }
  }

  // Her gönderimden önce "yazıyor…" gösterilir (en iyi çaba).
  private async send(igsid: string, texts: string[], quickReplies?: object[]) {
    for (let i = 0; i < texts.length; i++) {
      await this.client!.action(igsid, "typing_on");
      await this.client!.send(igsid, texts[i], i === texts.length - 1 ? quickReplies : undefined);
    }
  }

  // Sonuç kartı: generic template → button template → URL'siz metin + not.
  private async sendCard(igsid: string, card: ReturnType<typeof resultCard>) {
    await this.client!.action(igsid, "typing_on");
    try { await this.client!.sendMessage(igsid, card.generic); return "generic"; }
    catch (e: any) { this.log.warn(`Kart gönderilemedi, buton şablonu deneniyor: ${e.message}`); }
    try { await this.client!.sendMessage(igsid, card.button); return "button"; }
    catch (e: any) { this.log.warn(`Buton şablonu gönderilemedi, metne düşülüyor: ${e.message}`); }
    await this.client!.send(igsid, `${card.text}\n\n${COPY.noLinkNote}`);
    return "text";
  }

  async handleMessage(msg: IncomingMessage, now = new Date()) {
    if (!(await this.firstSeen(msg.mid))) return;
    let conv = await this.prisma.igConversation.findUnique({ where: { igsid: msg.igsid } });
    if (!conv) {
      const p = await this.client!.profile(msg.igsid);
      conv = await this.prisma.igConversation.create({ data: { igsid: msg.igsid, username: p?.username || null } });
    }
    await this.prisma.igConversation.update({ where: { igsid: msg.igsid }, data: { lastMid: msg.mid, lastInboundAt: now, messagesIn: { increment: 1 } } });
    // Yorumdan özel yanıt sonrası ilk yanıt: kapı açılır; analiz sürüyorsa sonuç hazırsa hemen, değilse durum mesajı.
    if ((conv as any).replyGate) {
      await this.prisma.igConversation.update({ where: { igsid: msg.igsid }, data: { replyGate: false } });
      if (conv.state === "auditing") {
        const delivered = await this.deliver({ ...conv, replyGate: false } as any, now, true);
        if (!delivered) await this.send(msg.igsid, [COPY.busy]);
        return;
      }
    }
    const action = decide(conv as any, msg, now);
    const set = (data: Record<string, any>) => this.prisma.igConversation.update({ where: { igsid: msg.igsid }, data });

    switch (action.kind) {
      case "silent": return;
      case "busy": return this.send(msg.igsid, [COPY.busy]);
      case "help": await set({ state: "helped" }); return this.send(msg.igsid, [COPY.help]);
      case "about": return this.send(msg.igsid, [COPY.about], ABOUT_QUICK);
      case "rate_limited": await set({ state: "idle" }); return this.send(msg.igsid, [COPY.rateLimited]);
      case "ask_url": await set({ state: "awaiting_url", handoffUntil: null }); return this.send(msg.igsid, [COPY.askUrl]);
      case "no": await set({ state: "idle" }); return this.send(msg.igsid, [COPY.no]);
      case "yes": {
        await set({ state: "handoff", handoffUntil: new Date(now.getTime() + HANDOFF_MS) });
        if (conv.leadId) await this.markWantsContact(conv.leadId, conv.username, now).catch((e) => this.log.warn(`Firma işaretlenemedi: ${e.message}`));
        return this.send(msg.igsid, [COPY.yes]);
      }
      case "start_audit": {
        const domain = domainOf(action.url.toString()) || action.url.hostname;
        await this.client!.action(msg.igsid, "mark_seen");
        let started: { token: string; leadId: string; auditId?: string };
        try {
          started = await this.publicAudits.submit({
            websiteUrl: action.url.toString(), name: "", email: "", phone: "", company: "", sector: "",
            instagram: conv.username || "", message: (conv as any).commentMedia ? `Yorum: ${(conv as any).commentMedia} (IGSID ${msg.igsid})` : `Instagram DM (IGSID ${msg.igsid})`, source: "instagram", locale: "tr",
          }, `ig:${msg.igsid}`, { notify: false, createdBy: "instagram-bot" });
        } catch (e) {
          if (e instanceof PublicAuditError) { await set({ state: "awaiting_url" }); return this.send(msg.igsid, [COPY.invalidUrl]); }
          throw e;
        }
        const today = dayKey(now);
        await set({
          state: "auditing", domain, leadId: started.leadId, auditId: started.auditId ?? null, publicToken: started.token, handoffUntil: null,
          auditsDay: today, auditsToday: auditsUsedToday(conv as any, now) + 1, auditsTotal: { increment: 1 },
        });
        await this.tagLead(started.leadId, msg.igsid, conv.username).catch(() => {});
        await this.prisma.keyValue.deleteMany({ where: { key: progressKey(msg.igsid) } }).catch(() => {});
        return this.send(msg.igsid, [COPY.started(domain)]);
      }
    }
  }

  // Yorum → özel yanıt DM + (isteğe bağlı) herkese açık yanıt. Yorum kimliği başına bir kez (ig_comment_events).
  async handleComment(c: IncomingComment, now = new Date()) {
    const { trigger, url } = commentTrigger(c.text);
    if (!trigger) return "ignored";
    if (now.getTime() - c.timestamp > PRIVATE_REPLY_WINDOW_MS) return "expired";
    // Bizim yanıtladığımız bir yoruma gelen yanıtlar (ör. "teşekkürler, analiz…") yeniden tetiklemez.
    if (c.parentId && (await this.prisma.igCommentEvent.findUnique({ where: { commentId: c.parentId } }))) return "ignored";
    const ev = this.prisma.igCommentEvent;
    try { await ev.create({ data: { commentId: c.commentId, mediaId: c.mediaId || null, igsid: c.igsid, username: c.username || null, action: "processing" } }); }
    catch (e: any) { if (e?.code === "P2002") return "duplicate"; throw e; }
    const done = (action: string) => ev.update({ where: { commentId: c.commentId }, data: { action } }).then(() => action);

    const replied = { igsid: c.igsid, action: { in: ["private_reply", "audit_started"] } };
    const dayStart = new Date(Date.parse(`${dayKey(now)}T00:00:00+03:00`));
    // Aynı gönderide aynı kişiye 24 saatte bir yanıt (spam koruması); ertesi gün yeniden yorum yazarsa yine yanıt alır.
    if (c.mediaId && (await ev.count({ where: { ...replied, mediaId: c.mediaId, handledAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } } })) >= 1) return done("limited_post");
    if ((await ev.count({ where: { ...replied, handledAt: { gte: dayStart } } })) >= COMMENT_DAILY_LIMIT) return done("limited_day");

    let conv = await this.prisma.igConversation.findUnique({ where: { igsid: c.igsid } });
    if (conv && (conv.state === "auditing" || conv.state === "sending")) return done("busy");
    if (!conv) conv = await this.prisma.igConversation.create({ data: { igsid: c.igsid, username: c.username || null } });
    const media = (c.mediaId || "").slice(0, 64) || null;

    let action = "private_reply";
    if (url && auditsUsedToday(conv as any, now) < DAILY_AUDIT_LIMIT) {
      const domain = domainOf(url.toString()) || url.hostname;
      try {
        const started = await this.publicAudits.submit({
          websiteUrl: url.toString(), name: "", email: "", phone: "", company: "", sector: "",
          instagram: c.username || conv.username || "", message: `Yorum: ${media || "?"} (IGSID ${c.igsid})`, source: "instagram", locale: "tr",
        }, `ig:${c.igsid}`, { notify: false, createdBy: "instagram-bot" });
        await this.client!.privateReply(c.commentId, COMMENT_COPY.started(domain));
        await this.prisma.igConversation.update({ where: { igsid: c.igsid }, data: {
          state: "auditing", domain, leadId: started.leadId, auditId: started.auditId ?? null, publicToken: started.token, handoffUntil: null,
          replyGate: true, commentMedia: media, auditsDay: dayKey(now), auditsToday: auditsUsedToday(conv as any, now) + 1, auditsTotal: { increment: 1 },
        } });
        await this.tagLead(started.leadId, c.igsid, c.username || conv.username).catch(() => {});
        await this.prisma.keyValue.deleteMany({ where: { key: progressKey(c.igsid) } }).catch(() => {});
        action = "audit_started";
      } catch (e) {
        if (!(e instanceof PublicAuditError)) throw e;
        action = "private_reply"; // geçersiz adres: adres iste
      }
    }
    if (action === "private_reply") {
      await this.client!.privateReply(c.commentId, COMMENT_COPY.askUrl);
      await this.prisma.igConversation.update({ where: { igsid: c.igsid }, data: { state: "awaiting_url", handoffUntil: null, replyGate: false, commentMedia: media } });
    }
    await done(action);
    if (!c.live && process.env.IG_COMMENT_PUBLIC_REPLY !== "0") {
      await this.client!.replyComment(c.commentId, publicReplyFor(c.commentId)).catch((e) => this.log.warn(`Yorum yanıtı gönderilemedi: ${e.message}`));
    }
    return action;
  }

  private async tagLead(leadId: string, igsid: string, username: string | null) {
    const lead = await getOne("leads", leadId);
    if (!lead) return;
    await put("leads", leadId, { ...lead, inboundChannel: "instagram_dm", instagramIgsid: igsid, instagram: lead.instagram || username || undefined });
  }

  private async markWantsContact(leadId: string, username: string | null, now: Date) {
    const lead = await getOne("leads", leadId);
    if (!lead) return;
    await put("leads", leadId, { ...lead, inbound: true, inboundWantsContact: true, inboundWantsContactAt: now.toISOString(), inboundWantsContactVia: "instagram", instagram: lead.instagram || username || undefined });
  }

  // Bekleyen analizleri yoklar ve sonucu DM olarak gönderir. Birden fazla örnek güvenle çalışır (koşullu güncelleme ile sahiplenme).
  async pollPending(now = new Date()) {
    if (this.polling || !this.client) return;
    this.polling = true;
    try {
      await this.prisma.igConversation.updateMany({ where: { state: "sending", updatedAt: { lt: new Date(now.getTime() - SENDING_STALE_MS) } }, data: { state: "auditing" } });
      const pending = await this.prisma.igConversation.findMany({ where: { state: "auditing", replyGate: false }, orderBy: { updatedAt: "asc" }, take: 20 });
      for (const c of pending) await this.deliver(c, now).catch((e) => this.log.warn(`Sonuç gönderilemedi: ${e.message}`));
    } finally { this.polling = false; }
  }

  // true: sonuç/hata mesajı gönderildi. onReply: kullanıcı yeni yanıtladı (işlemde ise ara mesaj yerine false döner).
  private async deliver(c: { igsid: string; publicToken: string | null; domain: string | null; updatedAt: Date }, now: Date, onReply = false): Promise<boolean> {
    const domain = c.domain || "Siteniz";
    const out: any = c.publicToken ? await this.publicAudits.poll(c.publicToken, reportBase()) : null;
    let texts: string[] = [], quick: object[] | undefined, next = "idle", score: number | null = null, card: ReturnType<typeof resultCard> | null = null;
    if (out?.status === "processing") {
      if (now.getTime() - c.updatedAt.getTime() < AUDIT_GIVEUP_MS) { if (!onReply) await this.maybeProgress(c.igsid, out.progress); return false; }
      texts = [COPY.failed(domain)];
    } else if (out?.status === "completed") {
      const r = out.result;
      score = r.overallScore;
      const steps = r.topOpportunities.map((o: any) => o.title);
      card = resultCard({ domain, score, grade: r.grade, steps, reportUrl: r.reportUrl, cardUrl: r.cardUrl });
      const st = stepsText(steps);
      texts = [st || "Detaylı rapordaki önerileri ekibimizle birlikte değerlendirebilirsiniz."];
      quick = RESULT_QUICK; next = "result_sent";
    } else if (out?.status === "no_website") texts = [COPY.noWebsite(domain)];
    else texts = [COPY.failed(domain)];

    const claimed = await this.prisma.igConversation.updateMany({ where: { igsid: c.igsid, state: "auditing" }, data: { state: "sending" } });
    if (claimed.count !== 1) return false;
    try {
      if (card) await this.sendCard(c.igsid, card);
      await this.send(c.igsid, texts, quick);
      await this.prisma.igConversation.update({ where: { igsid: c.igsid }, data: { state: next, publicToken: null, lastScore: score } });
      return true;
    } catch (e) {
      // 24 saatlik pencere dışına çıkıldıysa vazgeç; aksi halde sonraki turda yeniden dene.
      const giveUp = now.getTime() - c.updatedAt.getTime() > 23 * 3_600_000;
      await this.prisma.igConversation.update({ where: { igsid: c.igsid }, data: giveUp ? { state: "idle", publicToken: null } : { state: "auditing", updatedAt: c.updatedAt } });
      throw e;
    }
  }

  // Gerçek denetim ilerlemesine göre en fazla 2 ara mesaj; düzey key_values'ta tutulur (konuşma satırının updatedAt'ı değişmez).
  private async maybeProgress(igsid: string, progress: number) {
    const level = progressLevel(progress);
    if (!level) return;
    const key = progressKey(igsid);
    const row = await this.prisma.keyValue.findUnique({ where: { key } });
    const sent = row ? Number(row.value) || 0 : 0;
    if (level <= sent) return;
    await this.prisma.keyValue.upsert({ where: { key }, create: { key, value: String(level), expiresAt: new Date(Date.now() + 86_400_000) }, update: { value: String(level) } });
    await this.send(igsid, [level === 2 ? COPY.progressAi : COPY.progressScan]).catch((e) => this.log.warn(`Ara mesaj gönderilemedi: ${e.message}`));
  }
}

// Env belirtecinin parmak izi (sha256, ilk 32 onaltılık hane). Belirtecin kendisi saklanmaz/yazdırılmaz.
export const tokenFingerprint = (token: string) => (token ? createHash("sha256").update(token).digest("hex").slice(0, 32) : "");

const progressKey = (igsid: string) => `ig:progress:${igsid}`.slice(0, 300);
