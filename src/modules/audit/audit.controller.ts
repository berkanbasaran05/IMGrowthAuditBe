import { Body, Controller, Get, Param, Patch, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { publicMessage } from "../../infrastructure/http/http-hardening.js";
import { isAuthed, sessionUser } from "../growth/lib/auth.js";
import { AuditConflictError, AuditNotFoundError, AuditService } from "./audit.service.js";

// Growth Audit™ API'si (yalnızca panel oturumu). Yollar en az iki parçalıdır; böylece
// GrowthController'daki "api/:endpoint" yakalayıcısıyla çakışmaz.

const UUID = /^[0-9a-f-]{36}$/i;

@Controller("api/growth-audit")
export class AuditController {
  constructor(private readonly audits: AuditService) {}

  private async run(req: Request, res: Response, work: () => Promise<unknown>, okStatus = 200) {
    if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
    try { return res.status(okStatus).json(await work()); }
    catch (error: any) {
      if (error instanceof AuditConflictError) return res.status(409).json({ error: error.message, auditId: error.auditId });
      if (error instanceof AuditNotFoundError) return res.status(404).json({ error: error.message });
      if (/DATABASE_URL/.test(String(error?.message))) return res.status(503).json({ error: "Veritabanı bağlı değil" });
      return res.status(400).json({ error: publicMessage(error) });
    }
  }

  @Get("summary")
  summary(@Req() req: Request, @Res() res: Response) { return this.run(req, res, () => this.audits.summary()); }

  @Get("definitions")
  definitions(@Req() req: Request, @Res() res: Response) { return this.run(req, res, async () => this.audits.definitions()); }

  @Get("leads/:leadId")
  forLead(@Param("leadId") leadId: string, @Req() req: Request, @Res() res: Response) { return this.run(req, res, () => this.audits.forLead(leadId)); }

  @Post("leads/:leadId")
  start(@Param("leadId") leadId: string, @Req() req: Request, @Res() res: Response) {
    return this.run(req, res, () => this.audits.start(leadId, sessionUser(req)), 202);
  }

  @Get("audits/:id")
  audit(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    if (!UUID.test(id)) return res.status(404).json({ error: "Denetim bulunamadı" });
    return this.run(req, res, () => this.audits.getAudit(id));
  }

  @Post("audits/:id/metrics/:metricId/review")
  review(@Param("id") id: string, @Param("metricId") metricId: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (!UUID.test(id)) return res.status(404).json({ error: "Denetim bulunamadı" });
    const score = body?.score === null || body?.score === "" || body?.score === undefined ? null : Number(body.score);
    return this.run(req, res, () => this.audits.review(id, String(metricId).slice(0, 60), score, String(body?.reason || ""), sessionUser(req)));
  }

  @Patch("opportunities/:id")
  opportunity(@Param("id") id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (!UUID.test(id)) return res.status(404).json({ error: "Fırsat bulunamadı" });
    return this.run(req, res, () => this.audits.setOpportunityStatus(id, String(body?.status || "")));
  }
}
