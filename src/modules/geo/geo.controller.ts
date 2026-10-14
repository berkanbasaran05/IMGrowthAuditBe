import { Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { publicMessage } from "../../infrastructure/http/http-hardening.js";
import { isAuthed } from "../growth/lib/auth.js";
import { GeoService } from "./geo.service.js";

// Harita görünümü için firma konumları (yalnızca panel oturumu).
@Controller("api/geo")
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  private async run(req: Request, res: Response, work: () => Promise<unknown>) {
    if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
    try { return res.json(await work()); } catch (e: any) { return res.status(400).json({ error: publicMessage(e) }); }
  }

  @Get("points") points(@Req() req: Request, @Res() res: Response) { return this.run(req, res, async () => ({ points: await this.geo.all(), status: await this.geo.status() })); }
  @Post("run") start(@Req() req: Request, @Res() res: Response) { return this.run(req, res, async () => this.geo.start()); }
  @Post("reset/:leadId") reset(@Param("leadId") leadId: string, @Req() req: Request, @Res() res: Response) { return this.run(req, res, () => this.geo.reset(String(leadId).slice(0, 120))); }
}
