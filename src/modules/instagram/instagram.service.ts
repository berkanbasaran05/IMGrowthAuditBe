import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { getOne, put } from "../growth/lib/redis.js";
import { decryptSecret, encryptionConfigured, encryptSecret } from "../growth-manager/security.js";
import { PublicAuditError, PublicAuditService, domainOf } from "../audit/public-audit.service.js";
import { IgClient, type TokenStore } from "./instagram.client.js";
import { COPY, HANDOFF_MS, YES_NO, auditsUsedToday, dayKey, decide, formatResult, parseWebhook, type IncomingMessage } from "./instagram.logic.js";

// Instagram DM analiz botu. Durum ig_conversations tablosunda tutulur; bekleyen analizler 15 sn'de bir
// yoklanır (sunucu yeniden başlasa da sonuç gönderilir). Ekibe Telegram/e-posta bildirimi GÖNDERİLMEZ:
// ekip Instagram'dan elle yanıtlar; talepler Gelen Talepler'de görünür.

const POLL_MS = 15_000;
const REFRESH_CHECK_MS = 6 * 3_600_000;
const REFRESH_EVERY_MS = 7 * 86_400_000;
const AUDIT_GIVEUP_MS = 20 * 60_000;
const SENDING_STALE_MS = 5 * 60_000;
const TOKEN_KEY = "ig:access_token";
const DEFAULT_BASE = "https://customer.istanbul.marketing";

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

  tokenStore(): TokenStore {
    return {
      get: async () => {
        const row = await this.prisma.keyValue.findUnique({ where: { key: TOKEN_KEY } });
        if (!row) return null;
        const v = JSON.parse(row.value);
        return v.enc ? decryptSecret(v.t) : v.t;
      },
      set: async (token, expiresIn) => {
        const enc = encryptionConfigured();
        const value = JSON.stringify({ t: enc ? encryptSecret(token) : token, enc, at: new Date().toISOString(), exp: new Date(Date.now() + expiresIn * 1000).toISOString() });
        await this.prisma.keyValue.upsert({ where: { key: TOKEN_KEY }, create: { key: TOKEN_KEY, value }, update: { value } });
      },
    };
  }

  async maybeRefreshToken() {
    if (!this.client) return;
    try {
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
  }

  // Aynı mesaj kimliği (mid) ikinci kez işlenmez (Meta yeniden deneyebilir).
  private async firstSeen(mid: string) {
    try {
      await this.prisma.keyValue.create({ data: { key: `ig:mid:${mid}`.slice(0, 300), value: "1", expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
      return true;
    } catch (e: any) { if (e?.code === "P2002") return false; throw e; }
  }

  private async send(igsid: string, texts: string[], quickReplies?: object[]) {
    for (let i = 0; i < texts.length; i++) await this.client!.send(igsid, texts[i], i === texts.length - 1 ? quickReplies : undefined);
  }

  async handleMessage(msg: IncomingMessage, now = new Date()) {
    if (!(await this.firstSeen(msg.mid))) return;
    let conv = await this.prisma.igConversation.findUnique({ where: { igsid: msg.igsid } });
    if (!conv) {
      const p = await this.client!.profile(msg.igsid);
      conv = await this.prisma.igConversation.create({ data: { igsid: msg.igsid, username: p?.username || null } });
    }
    await this.prisma.igConversation.update({ where: { igsid: msg.igsid }, data: { lastMid: msg.mid, lastInboundAt: now, messagesIn: { increment: 1 } } });
    const action = decide(conv as any, msg, now);
    const set = (data: Record<string, any>) => this.prisma.igConversation.update({ where: { igsid: msg.igsid }, data });

    switch (action.kind) {
      case "silent": return;
      case "busy": return this.send(msg.igsid, [COPY.busy]);
      case "help": return this.send(msg.igsid, [COPY.help]);
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
        let started: { token: string; leadId: string; auditId?: string };
        try {
          started = await this.publicAudits.submit({
            websiteUrl: action.url.toString(), name: "", email: "", phone: "", company: "", sector: "",
            instagram: conv.username || "", message: `Instagram DM (IGSID ${msg.igsid})`, source: "instagram", locale: "tr",
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
        return this.send(msg.igsid, [COPY.started(domain)]);
      }
    }
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
      const pending = await this.prisma.igConversation.findMany({ where: { state: "auditing" }, orderBy: { updatedAt: "asc" }, take: 20 });
      for (const c of pending) await this.deliver(c, now).catch((e) => this.log.warn(`Sonuç gönderilemedi: ${e.message}`));
    } finally { this.polling = false; }
  }

  private async deliver(c: { igsid: string; publicToken: string | null; domain: string | null; updatedAt: Date }, now: Date) {
    const domain = c.domain || "Siteniz";
    const out = c.publicToken ? await this.publicAudits.poll(c.publicToken, reportBase()) : null;
    let texts: string[], quick: object[] | undefined, next = "idle", score: number | null = null;
    if (out?.status === "processing") {
      if (now.getTime() - c.updatedAt.getTime() < AUDIT_GIVEUP_MS) return;
      texts = [COPY.failed(domain)];
    } else if (out?.status === "completed") {
      const r = (out as any).result;
      score = r.overallScore;
      texts = formatResult({ domain, score, grade: r.grade, steps: r.topOpportunities.map((o: any) => o.title), reportUrl: r.reportUrl });
      quick = YES_NO; next = "result_sent";
    } else if (out?.status === "no_website") texts = [COPY.noWebsite(domain)];
    else texts = [COPY.failed(domain)];

    const claimed = await this.prisma.igConversation.updateMany({ where: { igsid: c.igsid, state: "auditing" }, data: { state: "sending" } });
    if (claimed.count !== 1) return;
    try {
      await this.send(c.igsid, texts, quick);
      await this.prisma.igConversation.update({ where: { igsid: c.igsid }, data: { state: next, publicToken: null, lastScore: score } });
    } catch (e) {
      // 24 saatlik pencere dışına çıkıldıysa vazgeç; aksi halde sonraki turda yeniden dene.
      const giveUp = now.getTime() - c.updatedAt.getTime() > 23 * 3_600_000;
      await this.prisma.igConversation.update({ where: { igsid: c.igsid }, data: giveUp ? { state: "idle", publicToken: null } : { state: "auditing", updatedAt: c.updatedAt } });
      throw e;
    }
  }
}
