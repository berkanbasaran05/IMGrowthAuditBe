import { Body, Controller, Get, Options, Param, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { log } from "../../infrastructure/http/http-hardening.js";
import { clientIp, rateLimited } from "../../infrastructure/http/rate-limit.js";
import { aiConfigured } from "../audit/ai-client.js";
import { PublicAuditService } from "../audit/public-audit.service.js";
import { applyCors } from "../audit/public-audit.controller.js";
import { publicBase } from "../sales/sales.controller.js";
import { LIMITS, type Locale, cleanUserText, isConversationId, publicView } from "./assistant.logic.js";
import { UPLOAD_LIMITS, UUID } from "./business-report.js";
import { AssistantError, type AssistantEvent, AssistantService, DEFAULT_IMAGE_TEXT } from "./assistant.service.js";

// Marka Partneri asistanı — herkese açık uçlar (oturum gerekmez; konuşma kimliği tahmin edilemez bir belirteçtir).
//   POST /api/public/assistant            { id?, text?, event?: "audit_done", locale } → text/event-stream
//   GET  /api/public/assistant/:id        → konuşma görünümü (yeniden yüklemede)
//   GET  /api/public/assistant/:id/audit  → sohbetteki analizin durumu / sonucu
// CORS, ücretsiz analizle aynı köken listesini (PUBLIC_AUDIT_ORIGINS) kullanır.

const MAX_BODY = 8_192;
const POLL_LIMIT = 60, POLL_WINDOW = 60_000;

const MESSAGES: Record<string, Record<Locale, string>> = {
  empty: { tr: "Mesaj boş olamaz.", en: "The message cannot be empty." },
  too_long: { tr: `Mesaj en fazla ${LIMITS.messageChars} karakter olabilir.`, en: `Messages can be at most ${LIMITS.messageChars} characters.` },
  rate_limited: { tr: "Çok fazla mesaj gönderildi. Lütfen biraz sonra tekrar deneyin.", en: "Too many messages. Please try again later." },
  bad_images: { tr: "Görseller geçersiz ya da bu konuşmaya ait değil.", en: "The images are invalid or do not belong to this conversation." },
  unavailable: { tr: "Asistan şu an kullanılamıyor. Lütfen biraz sonra tekrar deneyin.", en: "The assistant is unavailable right now. Please try again shortly." },
};

@Controller("api/public/assistant")
export class AssistantController {
  constructor(private readonly assistant: AssistantService, private readonly publicAudits: PublicAuditService) {}

  @Options()
  preflight(@Req() req: Request, @Res() res: Response) { applyCors(req, res); return res.status(204).end(); }

  @Options(":id")
  preflightId(@Req() req: Request, @Res() res: Response) { applyCors(req, res); return res.status(204).end(); }

  @Options(":id/audit")
  preflightAudit(@Req() req: Request, @Res() res: Response) { applyCors(req, res); return res.status(204).end(); }

  @Post()
  async message(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    applyCors(req, res);
    const b = body && typeof body === "object" ? body : {};
    const locale: Locale = b.locale === "en" ? "en" : "tr";
    const fail = (status: number, code: string, error = MESSAGES[code]?.[locale] ?? MESSAGES.unavailable[locale]) => res.status(status).json({ error, code });
    if (Number(req.headers["content-length"] || 0) > MAX_BODY) return fail(413, "too_long");
    if (!aiConfigured()) return fail(503, "unavailable");
    if (b.id !== undefined && !isConversationId(b.id)) return fail(404, "not_found", locale === "en" ? "Conversation not found." : "Konuşma bulunamadı.");

    const event = b.event === "audit_done" ? "audit_done" as const : undefined;
    let text: string | undefined;
    let images: string[] | undefined;
    if (!event && b.images !== undefined && b.images !== null) {
      if (!Array.isArray(b.images) || b.images.length > UPLOAD_LIMITS.perMessage || !b.images.every((i: unknown) => typeof i === "string" && UUID.test(i))) return fail(400, "bad_images");
      images = [...new Set<string>(b.images)];
      if (images.length && !b.id) return fail(400, "bad_images");
    }
    if (!event) {
      const blank = typeof b.text !== "string" || !b.text.trim();
      if (images?.length && blank) text = DEFAULT_IMAGE_TEXT[locale];
      else {
        const parsed = cleanUserText(b.text);
        if (!parsed.ok) return fail(400, parsed.code!);
        text = parsed.text;
      }
    } else if (!b.id) return fail(400, "empty");
    const ip = clientIp(req);
    if (!event && rateLimited(`assistant:msg:${ip}`, LIMITS.ipPerHour, 3_600_000)) return fail(429, "rate_limited");

    // Akış başlamadan önceki hatalar JSON ile, başladıktan sonrakiler akış olayı olarak döner.
    let open = false;
    const emit = (e: AssistantEvent) => {
      if (!open) {
        res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        res.flushHeaders();
        open = true;
      }
      // Bekleme sırasında vekil sunucuların akışı kesmemesi için yorum satırı (istemci yok sayar).
      res.write(e.type === "ping" ? ": ping\n\n" : `data: ${JSON.stringify(e)}\n\n`);
    };
    try {
      await this.assistant.handle({ id: b.id, text, images, event, locale, ip }, emit, publicBase(req));
    } catch (error: any) {
      const known = error instanceof AssistantError;
      if (!known) log("error", "assistant_message", { error: error?.message });
      const message = known ? (locale === "en" && error.code !== "limit" ? MESSAGES.unavailable.en : error.message) : MESSAGES.unavailable[locale];
      if (!open) return res.status(known ? error.status : 503).json({ error: message, code: known ? error.code : "unavailable" });
      emit({ type: "error", message, code: known ? error.code : "unavailable" });
    }
    return res.end();
  }

  @Get(":id")
  async view(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    applyCors(req, res);
    if (rateLimited(`assistant:poll:${clientIp(req)}`, POLL_LIMIT, POLL_WINDOW)) return res.status(429).json({ error: "Çok fazla istek", code: "rate_limited" });
    const conv = await this.assistant.load(id);
    if (!conv) return res.status(404).json({ error: "Bulunamadı", code: "not_found" });
    return res.status(200).json(publicView(conv));
  }

  @Get(":id/audit")
  async audit(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    applyCors(req, res);
    if (rateLimited(`assistant:poll:${clientIp(req)}`, POLL_LIMIT, POLL_WINDOW)) return res.status(429).json({ error: "Çok fazla istek", code: "rate_limited" });
    const conv = await this.assistant.load(id);
    if (!conv?.audit) return res.status(404).json({ error: "Bulunamadı", code: "not_found" });
    try {
      const out = await this.publicAudits.poll(conv.audit.token, publicBase(req));
      if (!out) return res.status(404).json({ error: "Bulunamadı", code: "not_found" });
      return res.status(200).json({ ...out, domain: conv.audit.domain, notified: conv.audit.notified });
    } catch (error: any) {
      log("error", "assistant_audit_poll", { error: error?.message });
      return res.status(503).json({ error: "Hizmet geçici olarak kullanılamıyor.", code: "unavailable" });
    }
  }
}
