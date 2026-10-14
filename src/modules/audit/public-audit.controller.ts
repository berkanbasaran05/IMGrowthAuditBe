import { Body, Controller, Get, Options, Param, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { log } from "../../infrastructure/http/http-hardening.js";
import { clientIp, rateLimited } from "../../infrastructure/http/rate-limit.js";
import { publicBase } from "../sales/sales.controller.js";
import { PublicAuditError, PublicAuditService, publicMessage, validatePublicAuditInput } from "./public-audit.service.js";

// Ücretsiz dijital analiz — herkese açık uçlar (oturum gerekmez). Yol iki parçalıdır; GrowthController'daki
// "api/:endpoint" yakalayıcısıyla çakışmaz. CORS yalnızca PUBLIC_AUDIT_ORIGINS listesindeki kökenlere açılır.

const MAX_BODY = 8_192;
const START_LIMIT = 3, START_WINDOW = 3_600_000; // IP başına saatte 3 başlatma (iletişim bilgisi zorunlu değil)
const POLL_LIMIT = 60, POLL_WINDOW = 60_000; // IP başına dakikada 60 sorgu

export const allowedOrigins = () => (process.env.PUBLIC_AUDIT_ORIGINS || "").split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean);

export function applyCors(req: Request, res: Response) {
  const origin = String(req.headers.origin || "");
  res.set({ Vary: "Origin", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
  if (origin && allowedOrigins().includes(origin)) {
    res.set({ "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" });
  }
}

@Controller("api/public/audit")
export class PublicAuditController {
  constructor(private readonly service: PublicAuditService) {}

  @Options()
  preflight(@Req() req: Request, @Res() res: Response) { applyCors(req, res); return res.status(204).end(); }

  @Options(":token")
  preflightToken(@Req() req: Request, @Res() res: Response) { applyCors(req, res); return res.status(204).end(); }

  @Post()
  async start(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    applyCors(req, res);
    if (Number(req.headers["content-length"] || 0) > MAX_BODY) return res.status(413).json({ error: "İstek çok büyük", code: "too_large" });
    const ip = clientIp(req);
    if (rateLimited(`public-audit:start:${ip}`, START_LIMIT, START_WINDOW)) return res.status(429).json({ error: "Çok fazla istek. Lütfen daha sonra tekrar deneyin.", code: "rate_limited" });
    const parsed = validatePublicAuditInput(body);
    if (!parsed.ok) return res.status(400).json({ error: publicMessage(parsed.code, parsed.locale), code: parsed.code });
    try {
      const { token } = await this.service.submit(parsed.data, ip);
      return res.status(202).json({ token });
    } catch (error: any) {
      if (error instanceof PublicAuditError) return res.status(error.status).json({ error: error.message, code: error.code });
      log("error", "public_audit_start", { error: error?.message });
      return res.status(503).json({ error: parsed.data.locale === "en" ? "Service temporarily unavailable." : "Hizmet geçici olarak kullanılamıyor.", code: "unavailable" });
    }
  }

  @Get(":token")
  async poll(@Param("token") token: string, @Req() req: Request, @Res() res: Response) {
    applyCors(req, res);
    if (rateLimited(`public-audit:poll:${clientIp(req)}`, POLL_LIMIT, POLL_WINDOW)) return res.status(429).json({ error: "Çok fazla istek", code: "rate_limited" });
    try {
      const out = await this.service.poll(token, publicBase(req));
      if (!out) return res.status(404).json({ error: "Bulunamadı", code: "not_found" });
      return res.status(200).json(out);
    } catch (error: any) {
      log("error", "public_audit_poll", { error: error?.message });
      return res.status(503).json({ error: "Hizmet geçici olarak kullanılamıyor.", code: "unavailable" });
    }
  }
}
