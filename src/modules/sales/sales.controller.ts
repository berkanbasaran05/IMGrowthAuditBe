import { cardInputFromReport, renderCardPng } from "./report.card.js";
import { Body, Controller, Get, Param, Patch, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { publicMessage } from "../../infrastructure/http/http-hardening.js";
import { AuditNotFoundError } from "../audit/audit.service.js";
import { isAuthed, sessionUser } from "../growth/lib/auth.js";
import { renderReportHtml } from "./report.html.js";
import { renderReportPdf } from "./report.pdf.js";
import { SalesService } from "./sales.service.js";
import { clientIp, rateLimited } from "../../infrastructure/http/rate-limit.js";

export { rateLimited };

const UUID = /^[0-9a-f-]{36}$/i;
const fileName = (name: string) => `growth-audit-${name.toLocaleLowerCase("tr").replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" }[c]!)).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}.pdf`;
const SECURITY_HEADERS = {
  "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

// Rapor bağlantısının mutlak adresi: PUBLIC_REPORT_BASE_URL tanımlıysa o, değilse isteğin geldiği adres (Next.js vekili dahil).
export function publicBase(req: Request) {
  if (process.env.PUBLIC_REPORT_BASE_URL) return process.env.PUBLIC_REPORT_BASE_URL.replace(/\/$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return `${proto}://${host}`;
}

async function run(req: Request, res: Response, work: () => Promise<unknown>) {
  if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
  try { return res.status(200).json(await work()); }
  catch (error: any) {
    if (error instanceof AuditNotFoundError) return res.status(404).json({ error: error.message });
    if (error?.retryable) return res.status(503).json({ error: error.message });
    return res.status(400).json({ error: publicMessage(error) });
  }
}

// Panel içi satış zekâsı uçları (oturum gerekir).
@Controller("api/growth-audit")
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Post("audits/:id/reports")
  createLink(@Param("id") id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (!UUID.test(id)) return res.status(404).json({ error: "Denetim bulunamadı" });
    return run(req, res, async () => {
      const link = await this.sales.createLink(id, Number(body?.days || 30), sessionUser(req));
      return { id: link.id, expiresAt: link.expiresAt, url: `${publicBase(req)}/r/${link.token}` };
    });
  }

  @Get("leads/:leadId/reports")
  links(@Param("leadId") leadId: string, @Req() req: Request, @Res() res: Response) { return run(req, res, () => this.sales.links(leadId)); }

  @Post("reports/:id/revoke")
  revoke(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    if (!UUID.test(id)) return res.status(404).json({ error: "Bağlantı bulunamadı" });
    return run(req, res, () => this.sales.revoke(id));
  }

  // İç önizleme ve PDF (bağlantı oluşturmadan).
  @Get("audits/:id/report.html")
  async preview(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    if (!isAuthed(req)) return res.status(401).send("Giriş gerekli");
    if (!UUID.test(id)) return res.status(404).send("Bulunamadı");
    try { res.set(SECURITY_HEADERS).type("html").send(renderReportHtml(await this.sales.reportFor(id), { preview: true, pdfHref: `/api/growth-audit/audits/${id}/report.pdf` })); }
    catch (e: any) { res.status(e instanceof AuditNotFoundError ? 404 : 400).send(String(e.message)); }
  }

  @Get("audits/:id/report.pdf")
  async pdf(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    if (!isAuthed(req)) return res.status(401).send("Giriş gerekli");
    if (!UUID.test(id)) return res.status(404).send("Bulunamadı");
    try {
      const report = await this.sales.reportFor(id);
      res.set({ ...SECURITY_HEADERS, "Content-Disposition": `attachment; filename="${fileName(report.company.name)}"` }).type("pdf").send(await renderReportPdf(report));
    } catch (e: any) { res.status(e instanceof AuditNotFoundError ? 404 : 400).send(String(e.message)); }
  }

  @Post("leads/:leadId/drafts/email")
  email(@Param("leadId") leadId: string, @Req() req: Request, @Res() res: Response) { return run(req, res, () => this.sales.generate(leadId, "email", sessionUser(req))); }

  @Post("leads/:leadId/drafts/call")
  call(@Param("leadId") leadId: string, @Req() req: Request, @Res() res: Response) { return run(req, res, () => this.sales.generate(leadId, "call_brief", sessionUser(req))); }

  @Get("leads/:leadId/drafts")
  drafts(@Param("leadId") leadId: string, @Req() req: Request, @Res() res: Response) { return run(req, res, () => this.sales.drafts(leadId)); }

  @Get("call-briefs")
  callBriefs(@Req() req: Request, @Res() res: Response) { return run(req, res, () => this.sales.callBriefs()); }

  @Patch("drafts/:id")
  update(@Param("id") id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (!UUID.test(id)) return res.status(404).json({ error: "Taslak bulunamadı" });
    return run(req, res, () => this.sales.update(id, body?.content));
  }

  @Post("drafts/:id/apply")
  apply(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    if (!UUID.test(id)) return res.status(404).json({ error: "Taslak bulunamadı" });
    return run(req, res, () => this.sales.apply(id));
  }

  @Post("drafts/:id/discard")
  discard(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    if (!UUID.test(id)) return res.status(404).json({ error: "Taslak bulunamadı" });
    return run(req, res, () => this.sales.discard(id));
  }
}

const NOT_FOUND = `<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Rapor bulunamadı</title><body style="font-family:system-ui;padding:40px;color:#07111f"><h1 style="font-size:22px">Rapor bulunamadı</h1><p>Bağlantı geçersiz, süresi dolmuş veya iptal edilmiş olabilir. Güncel rapor için Istanbul Marketing ile iletişime geçin.</p></body></html>`;

// Müşteriye açık rapor (oturum gerekmez; erişim yalnızca tahmin edilemez belirteçle).
@Controller("r")
export class PublicReportController {
  constructor(private readonly sales: SalesService) {}

  @Get(":token")
  async html(@Param("token") token: string, @Req() req: Request, @Res() res: Response) {
    if (rateLimited(clientIp(req))) return res.status(429).set(SECURITY_HEADERS).send("Çok fazla istek");
    const report = await this.sales.resolve(token, true).catch(() => null);
    if (!report) return res.status(404).set(SECURITY_HEADERS).type("html").send(NOT_FOUND);
    res.set({ ...SECURITY_HEADERS, "Cache-Control": "private, no-store" }).type("html").send(renderReportHtml(report, { pdfHref: `/r/${token}/pdf` }));
  }

  // Instagram DM kartı için skor görseli. Erişim rapor bağlantısıyla aynı belirteçle; görüntülenme sayılmaz.
  @Get(":token/card.png")
  async card(@Param("token") token: string, @Req() req: Request, @Res() res: Response) {
    if (rateLimited(clientIp(req))) return res.status(429).set(SECURITY_HEADERS).send("Çok fazla istek");
    const report = await this.sales.resolve(token, false).catch(() => null);
    if (!report) return res.status(404).set({ ...SECURITY_HEADERS, "Cache-Control": "no-store" }).send("Not found");
    const png = await renderCardPng(cardInputFromReport(report));
    res.set({ ...SECURITY_HEADERS, "Cache-Control": "public, max-age=86400", "X-Robots-Tag": "noindex" }).type("png").send(png);
  }

  @Get(":token/pdf")
  async pdf(@Param("token") token: string, @Req() req: Request, @Res() res: Response) {
    if (rateLimited(clientIp(req))) return res.status(429).set(SECURITY_HEADERS).send("Çok fazla istek");
    const report = await this.sales.resolve(token, false).catch(() => null);
    if (!report) return res.status(404).set(SECURITY_HEADERS).type("html").send(NOT_FOUND);
    res.set({ ...SECURITY_HEADERS, "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="${fileName(report.company.name)}"` }).type("pdf").send(await renderReportPdf(report));
  }
}
