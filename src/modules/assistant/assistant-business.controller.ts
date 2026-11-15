import { Controller, Get, Options, Param, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import multer from "multer";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { log } from "../../infrastructure/http/http-hardening.js";
import { clientIp, rateLimited } from "../../infrastructure/http/rate-limit.js";
import { applyCors } from "../audit/public-audit.controller.js";
import { hashToken } from "../sales/sales.service.js";
import { isConversationId } from "./assistant.logic.js";
import { IMAGE_MIMES, MAX_UPLOAD_BYTES, UPLOAD_LIMITS, UUID, detectImageType } from "./business-report.js";
import { AssistantService } from "./assistant.service.js";

// Marka Partneri: görsel yükleme ve iş analizi raporu — herkese açık uçlar.
//   POST /api/public/assistant/:id/upload           multipart (alan: file) → 201 { imageId }
//   GET  /api/public/assistant/:id/upload/:imageId  → görsel baytları (yalnızca o konuşmaya aitse)
//   GET  /api/public/business-report/:token         → rapor JSON'u
// Hatalar { error, code } biçimindedir.

const UPLOAD_WINDOW = 3_600_000;
const REPORT_TOKEN = /^[A-Za-z0-9_-]{43}$/;

const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4, parts: 6 } }).single("file");
const parseUpload = (req: Request, res: Response) => new Promise<void>((resolve, reject) => parser(req as any, res as any, (e: unknown) => (e ? reject(e) : resolve())));

const ERR = {
  not_found: [404, "Bulunamadı"],
  too_large: [413, "Görsel en fazla 5 MB olabilir."],
  bad_type: [400, "Yalnızca PNG, JPEG veya WebP görsel yüklenebilir."],
  limit: [429, "Bu konuşmaya en fazla 8 görsel yüklenebilir."],
  rate_limited: [429, "Çok fazla istek. Lütfen daha sonra tekrar deneyin."],
  unavailable: [503, "Hizmet geçici olarak kullanılamıyor."],
} as const;
const fail = (res: Response, code: keyof typeof ERR) => res.status(ERR[code][0]).json({ error: ERR[code][1], code });

@Controller("api/public/assistant")
export class AssistantUploadController {
  constructor(private readonly assistant: AssistantService, private readonly prisma: PrismaService) {}

  @Options(":id/upload")
  preflight(@Req() req: Request, @Res() res: Response) { applyCors(req, res); return res.status(204).end(); }

  @Options(":id/upload/:imageId")
  preflightImage(@Req() req: Request, @Res() res: Response) { applyCors(req, res); return res.status(204).end(); }

  @Post(":id/upload")
  async upload(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    applyCors(req, res);
    if (rateLimited(`assistant:upload:${clientIp(req)}`, UPLOAD_LIMITS.perIpPerHour, UPLOAD_WINDOW)) return fail(res, "rate_limited");
    if (!isConversationId(id)) return fail(res, "not_found");
    try {
      if (!(await this.assistant.load(id))) return fail(res, "not_found");
      if ((await this.prisma.assistantUpload.count({ where: { conversationId: id } })) >= UPLOAD_LIMITS.perConversation) return fail(res, "limit");
      if (Number(req.headers["content-length"] || 0) > MAX_UPLOAD_BYTES + 65_536) return fail(res, "too_large");
      try { await parseUpload(req, res); } catch (e: any) { return fail(res, e?.code === "LIMIT_FILE_SIZE" ? "too_large" : "bad_type"); }
      const file = (req as any).file as { buffer: Buffer; mimetype: string; size: number } | undefined;
      if (!file?.buffer?.length) return fail(res, "bad_type");
      if (file.size > MAX_UPLOAD_BYTES) return fail(res, "too_large");
      // Bildirilen tür izinli listede olmalı ve dosyanın gerçek baytlarıyla (sihirli bayt) uyuşmalı.
      const real = detectImageType(file.buffer);
      if (!IMAGE_MIMES.includes(file.mimetype as any) || real !== file.mimetype) return fail(res, "bad_type");
      const row = await this.prisma.assistantUpload.create({ data: { conversationId: id, mime: real, bytes: file.size, data: new Uint8Array(file.buffer) }, select: { id: true } });
      return res.status(201).json({ imageId: row.id });
    } catch (error: any) {
      log("error", "assistant_upload", { error: error?.message });
      return fail(res, "unavailable");
    }
  }

  @Get(":id/upload/:imageId")
  async image(@Param("id") id: string, @Param("imageId") imageId: string, @Req() req: Request, @Res() res: Response) {
    applyCors(req, res);
    if (rateLimited(`assistant:img:${clientIp(req)}`, 300, 60_000)) return fail(res, "rate_limited");
    if (!isConversationId(id) || !UUID.test(imageId)) return fail(res, "not_found");
    try {
      const row = await this.prisma.assistantUpload.findFirst({ where: { id: imageId, conversationId: id }, select: { mime: true, data: true } });
      if (!row) return fail(res, "not_found");
      res.set({ "Content-Type": row.mime, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" });
      return res.status(200).end(Buffer.from(row.data));
    } catch (error: any) {
      log("error", "assistant_upload_get", { error: error?.message });
      return fail(res, "unavailable");
    }
  }
}

// Rapor yanıtı: yalnızca ziyaretçiye gösterilen alanlar (iç meta ve bağlantılı kişi bilgisi dönmez).
export function publicReport(row: { kind: string; locale: string; createdAt: Date; data: unknown; title: string; overallScore: number }) {
  const d = (row.data || {}) as any;
  return {
    title: row.title, kind: row.kind, locale: row.locale, createdAt: row.createdAt.toISOString(), overallScore: row.overallScore,
    scoreLabel: d.scoreLabel ?? "", summary: d.summary ?? "", dimensions: d.dimensions ?? [], strengths: d.strengths ?? [], risks: d.risks ?? [],
    audience: d.audience ?? { primary: "" }, competitors: d.competitors ?? [], steps: d.steps ?? [], plan: d.plan ?? { d30: [], d60: [], d90: [] },
    evidenceNotes: d.evidenceNotes ?? [],
  };
}

@Controller("api/public/business-report")
export class PublicBusinessReportController {
  constructor(private readonly prisma: PrismaService) {}

  @Options(":token")
  preflight(@Req() req: Request, @Res() res: Response) { applyCors(req, res); return res.status(204).end(); }

  @Get(":token")
  async get(@Param("token") token: string, @Req() req: Request, @Res() res: Response) {
    applyCors(req, res);
    if (rateLimited(`business-report:${clientIp(req)}`, 60, 60_000)) return fail(res, "rate_limited");
    if (!REPORT_TOKEN.test(token)) return fail(res, "not_found");
    try {
      const row = await this.prisma.businessReport.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!row) return fail(res, "not_found");
      return res.status(200).json(publicReport(row));
    } catch (error: any) {
      log("error", "business_report_get", { error: error?.message });
      return fail(res, "unavailable");
    }
  }
}
