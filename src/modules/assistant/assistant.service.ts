import Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger } from "@nestjs/common";
import crypto from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { getOne, put } from "../growth/lib/redis.js";
import { normalizeWebsite } from "../audit/safe-fetch.js";
import { PublicAuditError, PublicAuditService, domainOf, slug } from "../audit/public-audit.service.js";
import { extractUrl } from "../instagram/instagram.logic.js";
import { hashToken } from "../sales/sales.service.js";
import {
  type Conversation, type Locale, LIMITS, OUT_OF_SCOPE, TOOL_AUDIT, TOOL_PROFILE, TOOLS,
  auditNotice, isConversationId, mergeProfile, newConversation, profileText, systemPrompt,
} from "./assistant.logic.js";
import { loadKnowledge } from "./knowledge.js";

// Marka Partneri asistanı: konuşmayı yürütür (Claude Haiku 5.5, akışlı yanıt), ücretsiz site analizini araç
// olarak başlatır, marka profilini kaydeder ve firmayı CRM'e aday olarak işler.
//
// Geçmiş yalnızca eklenerek büyür (düşünme bloklarının geçerliliği için mesajlar değiştirilmez/silinmez).
// Model yanıt metniyle birlikte araç çağırdıysa araç sonuçları bir sonraki kullanıcı mesajının başına eklenir;
// böylece kullanıcı ikinci bir model çağrısını beklemez. Metin yoksa ya da araç başarısızsa döngü hemen sürer.

export const ASSISTANT_MODEL = process.env.ASSISTANT_AI_MODEL || "claude-haiku-5-5";
const PRICE = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }; // USD / 1M token (Haiku 5.5, <100K)
const AUDIT_LIMIT = 3, AUDIT_WINDOW = 3_600_000; // site analizi: IP başına saatte 3 (ücretsiz analiz formuyla aynı)

export type AssistantEvent =
  | { type: "conversation"; id: string }
  | { type: "text"; text: string }
  | { type: "audit"; domain: string }
  | { type: "profile"; profile: Record<string, string> }
  | { type: "done"; remaining: number }
  | { type: "error"; message: string; code: string };

export class AssistantError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}

const auditHits = new Map<string, number[]>();
function auditLimited(ip: string, now = Date.now()) {
  const list = (auditHits.get(ip) || []).filter((t) => now - t < AUDIT_WINDOW);
  if (list.length >= AUDIT_LIMIT) return true;
  list.push(now); auditHits.set(ip, list);
  return false;
}

@Injectable()
export class AssistantService {
  private readonly log = new Logger("Assistant");
  private readonly busy = new Set<string>();

  constructor(private readonly prisma: PrismaService, private readonly publicAudits: PublicAuditService) {}

  ipHash(ip: string) { return hashToken(`${process.env.SESSION_SECRET || ""}:assistant:${ip}`); }

  async load(id: string): Promise<Conversation | null> {
    if (!isConversationId(id)) return null;
    const row = await this.prisma.assistantConversation.findUnique({ where: { id }, select: { data: true } });
    return row ? (row.data as unknown as Conversation) : null;
  }

  private async save(c: Conversation) {
    c.updatedAt = new Date().toISOString();
    const firstUser = c.view.find((v) => v.role === "user") as { text: string } | undefined;
    const cols = {
      locale: c.locale, ipHash: c.ipHash || null, leadId: c.leadId, userTurns: c.userTurns, costUsd: c.usage.costUsd,
      company: c.profile.firma?.slice(0, 200) || null, sector: c.profile.sektor?.slice(0, 200) || null,
      auditDomain: c.audit?.domain.slice(0, 255) || null, firstMessage: firstUser?.text.slice(0, 300) || null,
      updatedAt: new Date(c.updatedAt), data: c as unknown as object,
    };
    await this.prisma.assistantConversation.upsert({ where: { id: c.id }, create: { id: c.id, createdAt: new Date(c.createdAt), ...cols }, update: cols });
  }

  // Yeni kullanıcı mesajı ya da analiz bitti bildirimi. Olaylar emit ile akış halinde ön yüze gider.
  async handle(req: { id?: string; text?: string; event?: "audit_done"; locale: Locale; ip: string }, emit: (e: AssistantEvent) => void, baseUrl: string) {
    let conv = req.id ? await this.load(req.id) : null;
    if (req.id && !conv) throw new AssistantError("not_found", "Konuşma bulunamadı.", 404);
    if (!conv) {
      if (req.event) throw new AssistantError("not_found", "Konuşma bulunamadı.", 404);
      conv = newConversation(req.locale, this.ipHash(req.ip));
    }
    if (this.busy.has(conv.id)) throw new AssistantError("busy", "Önceki yanıt henüz tamamlanmadı.", 409);
    this.busy.add(conv.id);
    try {
      let content: Anthropic.ContentBlockParam[];
      if (req.event === "audit_done") {
        if (!conv.audit || conv.audit.notified) throw new AssistantError("no_audit", "Bekleyen analiz yok.", 409);
        const poll = await this.publicAudits.poll(conv.audit.token, baseUrl);
        if (!poll || poll.status === "processing") throw new AssistantError("not_ready", "Analiz henüz bitmedi.", 409);
        conv.audit.notified = true;
        content = [{ type: "text", text: auditNotice(poll, conv.audit.domain, conv.locale) }];
      } else {
        if (conv.userTurns >= LIMITS.userTurns) throw new AssistantError("limit", "Bu konuşmanın mesaj sınırı doldu. Ekibimizle WhatsApp'tan devam edebilirsiniz.", 429);
        conv.userTurns += 1;
        conv.view.push({ role: "user", text: req.text! });
        content = [{ type: "text", text: req.text! }];
      }
      if (!req.id) emit({ type: "conversation", id: conv.id });
      const before = { messages: conv.messages.length, view: conv.view.length - (req.event ? 0 : 1), pending: conv.pending, turns: conv.userTurns - (req.event ? 0 : 1) };
      try {
        await this.run(conv, content, emit, req.ip);
      } catch (error) {
        // Model hiç yanıt vermeden hata: tur geri alınır (kullanıcı aynı mesajı yeniden gönderebilir).
        if (!conv.messages.slice(before.messages).some((m) => m.role === "assistant")) {
          conv.messages.length = before.messages; conv.view.length = before.view; conv.pending = before.pending; conv.userTurns = before.turns;
          if (req.event && conv.audit) conv.audit.notified = false;
          if (req.id) await this.save(conv);
        } else {
          this.parkToolResults(conv);
          await this.save(conv);
        }
        throw error;
      }
      this.parkToolResults(conv);
      await this.save(conv);
      this.syncLead(conv).catch((e) => this.log.warn(`CRM kaydı güncellenemedi: ${e?.message}`));
      emit({ type: "done", remaining: Math.max(0, LIMITS.userTurns - conv.userTurns) });
    } finally {
      this.busy.delete(conv.id);
    }
  }

  // Geçmiş, yanıtı beklenen araç sonuçlarıyla bitiyorsa bunlar bir sonraki kullanıcı mesajına aktarılır
  // (art arda iki kullanıcı mesajı oluşmasın).
  private parkToolResults(conv: Conversation) {
    const last = conv.messages[conv.messages.length - 1];
    if (last?.role === "user" && Array.isArray(last.content) && last.content.every((b: any) => b.type === "tool_result")) {
      conv.messages.pop();
      conv.pending = [...(last.content as Anthropic.ToolResultBlockParam[]), ...conv.pending];
    }
  }

  private async run(conv: Conversation, content: Anthropic.ContentBlockParam[], emit: (e: AssistantEvent) => void, ip: string) {
    conv.messages.push({ role: "user", content: [...conv.pending, ...content] });
    conv.pending = [];
    const system = systemPrompt(await loadKnowledge());
    const client = new Anthropic({ timeout: 90_000, maxRetries: 2 });
    const hadAudit = !!conv.audit;
    let said = "";
    const say = (t: string) => { said += t; emit({ type: "text", text: t }); };

    try {
      for (let step = 0; step < LIMITS.loopSteps; step++) {
        if (said && !/\n\n$/.test(said)) say("\n\n");
        const before = said;
        const stream = client.messages.stream({
          model: ASSISTANT_MODEL,
          max_tokens: LIMITS.maxTokens,
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          tools: TOOLS,
          output_config: { effort: "low" },
          messages: conv.messages,
        });
        stream.on("text", (delta) => say(delta));
        const msg = await stream.finalMessage();
        conv.messages.push({ role: "assistant", content: msg.content });
        this.addUsage(conv, msg.usage);

        if (msg.stop_reason === "refusal") { if (said === before) say(OUT_OF_SCOPE[conv.locale]); break; }
        const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        if (!uses.length) break;

        const results: Anthropic.ToolResultBlockParam[] = [];
        let failed = false;
        for (const use of uses) {
          const r = await this.runTool(conv, use, emit, ip);
          results.push({ type: "tool_result", tool_use_id: use.id, content: r.text, ...(r.ok ? {} : { is_error: true }) });
          if (!r.ok) failed = true;
        }
        const wroteText = said.slice(before.length).trim().length > 0;
        if (wroteText && !failed && msg.stop_reason === "tool_use") { conv.pending = results; break; }
        conv.messages.push({ role: "user", content: results });
      }
    } finally {
      const text = said.trim();
      if (text) conv.view.push({ role: "assistant", text });
      // Analiz kartı, analizi başlatan yanıtın altında görünür (ön yüzdeki canlı sırayla aynı).
      if (!hadAudit && conv.audit) conv.view.push({ role: "audit", domain: conv.audit.domain });
    }
    if (!said.trim()) {
      const fallback = conv.locale === "en" ? "Sorry, I couldn't answer that just now. Please try again." : "Şu an yanıt veremedim. Lütfen tekrar deneyin.";
      say(fallback);
      conv.view.push({ role: "assistant", text: fallback });
    }
  }

  private async runTool(conv: Conversation, use: Anthropic.ToolUseBlock, emit: (e: AssistantEvent) => void, ip: string): Promise<{ ok: boolean; text: string }> {
    const input = (use.input && typeof use.input === "object" ? use.input : {}) as Record<string, unknown>;
    if (use.name === TOOL_PROFILE) {
      conv.profile = mergeProfile(conv.profile, input);
      emit({ type: "profile", profile: conv.profile as Record<string, string> });
      return { ok: true, text: "Kaydedildi." };
    }
    if (use.name !== TOOL_AUDIT) return { ok: false, text: `Bilinmeyen araç: ${use.name}` };

    if (conv.audit) return { ok: false, text: `Bu konuşmada ${conv.audit.domain} için zaten bir analiz yapıldı; yeni analiz başlatılamaz. Kullanıcıya bunu kısaca söyle.` };
    const raw = String(input.adres ?? "").trim().slice(0, 300);
    const url = normalizeWebsite(raw) || extractUrl(raw);
    if (!url || !/\.[a-z]{2,24}$/i.test(url.hostname)) return { ok: false, text: "Geçerli bir web sitesi adresi değil. Kullanıcıdan adresi doğru yazmasını iste (ör. firmaniz.com)." };
    if (auditLimited(ip)) return { ok: false, text: "Bu bağlantıdan çok fazla analiz başlatıldı; bir saat sonra tekrar denenebilir. Kullanıcıya bunu söyle ve konuşmaya devam et." };

    const p = conv.profile;
    try {
      const started = await this.publicAudits.submit({
        websiteUrl: url.toString(), name: "", email: "", phone: "", company: p.firma || "", sector: p.sektor || "", instagram: "",
        message: `Marka asistanı${profileText(p) ? ` · ${profileText(p)}` : ""}`.slice(0, 1000), source: "assistant", locale: conv.locale,
      }, ip, { createdBy: "assistant" });
      const domain = domainOf(url.toString()) || url.hostname;
      conv.audit = { token: started.token, domain, leadId: started.leadId, notified: false };
      conv.leadId = started.leadId;
      conv.profile = mergeProfile(conv.profile, { web_sitesi: domain });
      emit({ type: "audit", domain });
      return { ok: true, text: `Analiz başladı (${domain}). 1-3 dakika sürer; sonuç hazır olunca otomatik bildirim gelecek.` };
    } catch (e: any) {
      if (e instanceof PublicAuditError) return { ok: false, text: `Analiz başlatılamadı: ${e.message} Kullanıcıya kısaca bildir.` };
      this.log.error(`Analiz başlatılamadı: ${e?.message}`);
      return { ok: false, text: "Analiz şu an başlatılamadı (geçici hata). Kullanıcıya daha sonra tekrar denemesini ya da ekibe yazmasını söyle." };
    }
  }

  private addUsage(conv: Conversation, u: Anthropic.Usage) {
    const read = u.cache_read_input_tokens || 0, write = u.cache_creation_input_tokens || 0;
    conv.usage.inputTokens += u.input_tokens + read + write;
    conv.usage.outputTokens += u.output_tokens;
    conv.usage.cacheReadTokens += read;
    conv.usage.costUsd = Math.round((conv.usage.costUsd + (u.input_tokens * PRICE.input + read * PRICE.cacheRead + write * PRICE.cacheWrite + u.output_tokens * PRICE.output) / 1_000_000) * 1e6) / 1e6;
  }

  // Firmayı CRM'e işler: analiz yapıldıysa o kayda profil eklenir; yapılmadıysa firma adı öğrenilip en az iki mesaj
  // yazıldığında yeni aday oluşturulur. Ekibin girdiği dolu alanların üzerine yazılmaz.
  async syncLead(conv: Conversation) {
    const p = conv.profile;
    if (!conv.leadId) {
      if (!p.firma || conv.userTurns < 2) return;
      let id = slug(p.firma) || "firma";
      if (await getOne("leads", id)) id = `${id.slice(0, 100)}-${crypto.randomBytes(3).toString("hex")}`;
      const at = new Date().toISOString();
      await put("leads", id, { name: p.firma, status: "yeni", source: "gelen", foundAt: at.slice(0, 10), inbound: true, inboundSource: "assistant", inboundAt: at, inboundLocale: conv.locale });
      conv.leadId = id;
      await this.save(conv);
    }
    const lead = await getOne("leads", conv.leadId);
    if (!lead) return;
    const fill = (k: string, v?: string) => (lead[k] ? lead[k] : v || undefined);
    const next: Record<string, any> = {
      ...lead,
      sector: fill("sector", p.sektor),
      // Not, ekip elle değiştirmediyse (asistanın yazdığı notsa) her konuşmada güncel profille yenilenir.
      inboundMessage: !lead.inboundMessage || /^Marka asistanı/.test(lead.inboundMessage)
        ? `Marka asistanı${profileText(p) ? ` · ${profileText(p)}` : ""}`.slice(0, 1000) : lead.inboundMessage,
      assistant: { conversationId: conv.id, profile: p, userTurns: conv.userTurns, updatedAt: conv.updatedAt, costUsd: conv.usage.costUsd },
    };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    await put("leads", conv.leadId, next);
  }
}
