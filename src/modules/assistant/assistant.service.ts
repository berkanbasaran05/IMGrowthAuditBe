import Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger } from "@nestjs/common";
import crypto from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { getOne, put } from "../growth/lib/redis.js";
import { normalizeWebsite } from "../audit/safe-fetch.js";
import { PublicAuditError, PublicAuditService, domainOf, slug } from "../audit/public-audit.service.js";
import { extractUrl } from "../instagram/instagram.logic.js";
import { hashToken } from "../sales/sales.service.js";
import { rateLimited } from "../../infrastructure/http/rate-limit.js";
import {
  type Conversation, type Locale, type ViewItem, LIMITS, OUT_OF_SCOPE, TOOL_AUDIT, TOOL_PROFILE, TOOL_REPORT, TOOLS,
  auditNotice, isConversationId, mergeProfile, newConversation, profileText, systemPrompt,
} from "./assistant.logic.js";
import { REPORT_LIMITS, UUID, gatherEvidence, generateReport, parseReportInput } from "./business-report.js";
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
  | { type: "report_started"; kind: string; title: string }
  | { type: "report"; token: string; title: string; kind: string; score: number }
  | { type: "ping" }
  | { type: "done"; remaining: number }
  | { type: "error"; message: string; code: string };

export const DEFAULT_IMAGE_TEXT: Record<Locale, string> = { tr: "Görselleri paylaştım.", en: "I've shared images." };
const HISTORY_IMAGES = 6; // modele her turda gönderilen en son görsel sayısı
const IMG_MARK = /^\[IMG:([0-9a-f-]{36})\]$/;

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
  async handle(req: { id?: string; text?: string; images?: string[]; event?: "audit_done"; locale: Locale; ip: string }, emit: (e: AssistantEvent) => void, baseUrl: string) {
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
        const images = [...new Set(req.images || [])];
        if (images.length) {
          if (images.length > 4 || !images.every((i) => UUID.test(i))) throw new AssistantError("bad_images", "Görseller geçersiz.", 400);
          const found = await this.prisma.assistantUpload.count({ where: { id: { in: images }, conversationId: conv.id } });
          if (found !== images.length) throw new AssistantError("bad_images", "Görsellerden biri bu konuşmaya ait değil.", 400);
        }
        conv.userTurns += 1;
        const text = req.text || (images.length ? DEFAULT_IMAGE_TEXT[conv.locale] : "");
        conv.view.push({ role: "user", text, ...(images.length ? { images } : {}) });
        // Geçmişe görselin kendisi değil işaretçisi yazılır; model çağrısında gerçek görsel eklenir (hydrate).
        content = [...images.map((id) => ({ type: "text" as const, text: `[IMG:${id}]` })), { type: "text", text }];
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

  // Geçmişteki görsel işaretçilerini gerçek görsel bloklarına çevirir (en son HISTORY_IMAGES görsel); kimlik metni kalır.
  private async hydrate(messages: Anthropic.MessageParam[], cache: Map<string, Anthropic.ImageBlockParam | null>): Promise<Anthropic.MessageParam[]> {
    const ids: string[] = [];
    for (const m of messages) if (m.role === "user" && Array.isArray(m.content)) for (const b of m.content as any[]) { const id = b.type === "text" && IMG_MARK.exec(b.text)?.[1]; if (id) ids.push(id); }
    if (!ids.length) return messages;
    const wanted = ids.slice(-HISTORY_IMAGES).filter((id) => !cache.has(id));
    if (wanted.length) {
      const rows = await this.prisma.assistantUpload.findMany({ where: { id: { in: wanted } }, select: { id: true, mime: true, data: true } });
      for (const id of wanted) {
        const r = rows.find((x) => x.id === id);
        cache.set(id, r ? { type: "image", source: { type: "base64", media_type: r.mime as "image/png", data: Buffer.from(r.data).toString("base64") } } : null);
      }
    }
    const shown = new Set(ids.slice(-HISTORY_IMAGES));
    return messages.map((m) => {
      if (m.role !== "user" || !Array.isArray(m.content)) return m;
      return { ...m, content: (m.content as any[]).flatMap((b) => {
        const id = b.type === "text" ? IMG_MARK.exec(b.text)?.[1] : null;
        if (!id) return [b];
        const img = shown.has(id) ? cache.get(id) : null;
        return img ? [img, { type: "text", text: `[Görsel kimliği: ${id}]` }] : [{ type: "text", text: `[Görsel kimliği: ${id} — artık gösterilemiyor]` }];
      }) };
    });
  }

  private async run(conv: Conversation, content: Anthropic.ContentBlockParam[], emit: (e: AssistantEvent) => void, ip: string) {
    conv.messages.push({ role: "user", content: [...conv.pending, ...content] });
    conv.pending = [];
    const system = systemPrompt(await loadKnowledge());
    const client = new Anthropic({ timeout: 90_000, maxRetries: 2 });
    const hadAudit = !!conv.audit;
    const newReports: ViewItem[] = [];
    const imgCache = new Map<string, Anthropic.ImageBlockParam | null>();
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
          messages: await this.hydrate(conv.messages, imgCache),
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
          const r = await this.runTool(conv, use, emit, ip, newReports);
          results.push({ type: "tool_result", tool_use_id: use.id, content: r.text, ...(r.ok ? {} : { is_error: true }) });
          if (!r.ok) failed = true;
        }
        const wroteText = said.slice(before.length).trim().length > 0;
        // İş analizi aracı döngüyü her zaman sürdürür: model raporu gördükten sonra konuşmalı.
        const mustContinue = uses.some((u) => u.name === TOOL_REPORT);
        if (wroteText && !failed && !mustContinue && msg.stop_reason === "tool_use") { conv.pending = results; break; }
        conv.messages.push({ role: "user", content: results });
      }
    } finally {
      const text = said.trim();
      if (text) conv.view.push({ role: "assistant", text });
      // Analiz kartı, analizi başlatan yanıtın altında görünür (ön yüzdeki canlı sırayla aynı).
      if (!hadAudit && conv.audit) conv.view.push({ role: "audit", domain: conv.audit.domain });
      conv.view.push(...newReports);
    }
    if (!said.trim()) {
      const fallback = conv.locale === "en" ? "Sorry, I couldn't answer that just now. Please try again." : "Şu an yanıt veremedim. Lütfen tekrar deneyin.";
      say(fallback);
      conv.view.push({ role: "assistant", text: fallback });
    }
  }

  private async runTool(conv: Conversation, use: Anthropic.ToolUseBlock, emit: (e: AssistantEvent) => void, ip: string, newReports: ViewItem[] = []): Promise<{ ok: boolean; text: string }> {
    const input = (use.input && typeof use.input === "object" ? use.input : {}) as Record<string, unknown>;
    if (use.name === TOOL_PROFILE) {
      conv.profile = mergeProfile(conv.profile, input);
      emit({ type: "profile", profile: conv.profile as Record<string, string> });
      return { ok: true, text: "Kaydedildi." };
    }
    if (use.name === TOOL_REPORT) return this.runReport(conv, input, emit, ip, newReports);
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

  // İş analizi raporu: kanıt topla, görselleri yükle, tek model çağrısı, kaydet. Hata durumunda is_error sonucu döner.
  private async runReport(conv: Conversation, raw: Record<string, unknown>, emit: (e: AssistantEvent) => void, ip: string, newReports: ViewItem[]): Promise<{ ok: boolean; text: string }> {
    const parsed = parseReportInput(raw);
    if (!parsed.ok) return { ok: false, text: parsed.error };
    const input = parsed.input!;
    if ((conv.reports?.length || 0) >= REPORT_LIMITS.perConversation) return { ok: false, text: "Bu konuşmada en fazla 3 rapor hazırlanabilir ve sınıra ulaşıldı. Kullanıcıya bunu söyle; ekibimizle WhatsApp'tan devam edebileceğini ekle." };
    if (rateLimited(`assistant:report:${ip}`, REPORT_LIMITS.perIpPerDay, 86_400_000)) return { ok: false, text: "Bu bağlantıdan bugün çok fazla rapor istendi; yarın tekrar denenebilir. Kullanıcıya bunu söyle ve konuşmaya devam et." };

    emit({ type: "report_started", kind: input.tur, title: input.baslik });
    const ping = setInterval(() => emit({ type: "ping" }), 10_000);
    try {
      const rows = input.gorseller.length
        ? await this.prisma.assistantUpload.findMany({ where: { id: { in: input.gorseller }, conversationId: conv.id }, select: { id: true, mime: true, data: true } })
        : [];
      const images = rows.map((r) => ({ mime: r.mime, data: Buffer.from(r.data) }));
      const signal = AbortSignal.timeout(130_000);
      const evidence = await gatherEvidence(input.baglantilar, signal);
      if (input.gorseller.length && !images.length) evidence.notes.push("Belirtilen görseller bulunamadı.");
      const res = await generateReport({ input, evidence, images, knowledge: await loadKnowledge(), locale: conv.locale });
      if (res.usage) {
        conv.usage.inputTokens += res.usage.inputTokens; conv.usage.outputTokens += res.usage.outputTokens;
        conv.usage.costUsd = Math.round((conv.usage.costUsd + res.usage.costUsd) * 1e6) / 1e6;
      }
      if (!res.ok || !res.data) {
        this.log.warn(`İş analizi üretilemedi: ${res.code} ${res.reason}`);
        return { ok: false, text: "Rapor şu an hazırlanamadı (geçici hata). Kullanıcıdan kısaca özür dile ve daha sonra tekrar denemesini ya da ekibe yazmasını söyle." };
      }
      const report = res.data;
      const token = crypto.randomBytes(32).toString("base64url");
      const createdAt = new Date();
      await this.prisma.businessReport.create({
        data: {
          tokenHash: hashToken(token), conversationId: conv.id, leadId: conv.leadId, kind: input.tur, title: report.title.slice(0, 200),
          overallScore: report.overallScore, locale: conv.locale, createdAt,
          data: { ...report, meta: { model: res.usage?.model, costUsd: res.usage?.costUsd, inputTokens: res.usage?.inputTokens, outputTokens: res.usage?.outputTokens, links: input.baglantilar.length, images: images.length } } as unknown as object,
        },
      });
      (conv.reports ||= []).push({ token, title: report.title, kind: input.tur, score: report.overallScore, createdAt: createdAt.toISOString(), costUsd: res.usage?.costUsd });
      newReports.push({ role: "report", token, title: report.title, kind: input.tur, score: report.overallScore });
      emit({ type: "report", token, title: report.title, kind: input.tur, score: report.overallScore });
      const data = { baslik: report.title, puan: report.overallScore, derece: report.scoreLabel, ilk_adimlar: report.steps.slice(0, 3).map((s) => s.title), okunamayanlar: report.evidenceNotes.filter((n) => /okunamad|açılamad|bulunamad|erişilemed/i.test(n)).slice(0, 3) };
      return { ok: true, text: `${JSON.stringify(data)}\nRaporun tamamı kullanıcının ekranında kart olarak görünüyor; özetle, en önemli 2-3 noktayı ve İstanbul Marketing'in çözümünü anlat, bağlantı yazma.${conv.locale === "en" ? " Reply in English." : ""}` };
    } catch (e: any) {
      this.log.error(`İş analizi hatası: ${e?.message}`);
      return { ok: false, text: "Rapor şu an hazırlanamadı (geçici hata). Kullanıcıdan kısaca özür dile ve daha sonra tekrar denemesini ya da ekibe yazmasını söyle." };
    } finally {
      clearInterval(ping);
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
      assistant: { conversationId: conv.id, profile: p, userTurns: conv.userTurns, reports: conv.reports?.length || 0, updatedAt: conv.updatedAt, costUsd: conv.usage.costUsd },
    };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    await put("leads", conv.leadId, next);
  }
}
