import { Body, CanActivate, Controller, ExecutionContext, Get, HttpException, Injectable, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { isAuthed } from "../growth/lib/auth.js";
import { IgPanelService, PanelError } from "./ig-panel.service.js";
import { MAX_UPLOAD_BYTES } from "./ig-panel.logic.js";
import { safeError } from "./ig-publisher.logic.js";

// Panel "Instagram" sekmesi uçları (oturum gerekir). Yol iki+ parçalı: GrowthController'daki "api/:endpoint" ile çakışmaz.

// Yüklemede oturum, dosya belleğe alınmadan önce denetlenir (guard'lar interceptor'lardan önce çalışır).
@Injectable()
export class SessionGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    if (isAuthed(ctx.switchToHttp().getRequest())) return true;
    throw new HttpException({ error: "Giriş gerekli" }, 401);
  }
}

@Controller("api/instagram-panel")
export class IgPanelController {
  constructor(private readonly svc: IgPanelService) {}

  private async run(req: Request, res: Response, fn: () => Promise<unknown>, what: string) {
    if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
    res.set("Cache-Control", "no-store");
    try { return res.status(200).json(await fn()); }
    catch (e) {
      if (e instanceof PanelError) return res.status(e.status).json({ error: e.message });
      return res.status(502).json({ error: `${what}: ${safeError(e)}` });
    }
  }

  @Get("overview")
  overview(@Req() req: Request, @Res() res: Response, @Query("refresh") refresh?: string) {
    return this.run(req, res, () => this.svc.overview(refresh === "1"), "Özet okunamadı");
  }

  @Get("media")
  media(@Req() req: Request, @Res() res: Response, @Query("refresh") refresh?: string) {
    return this.run(req, res, () => this.svc.media(refresh === "1"), "Gönderiler okunamadı");
  }

  @Get("queue")
  queue(@Req() req: Request, @Res() res: Response) {
    return this.run(req, res, () => this.svc.queue(), "Kuyruk okunamadı");
  }

  @Post("queue")
  @UseGuards(SessionGuard)
  @UseInterceptors(FileInterceptor("image", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4, fieldSize: 1024 } }))
  upload(@Req() req: Request, @Res() res: Response, @UploadedFile() file: any, @Body() body: any) {
    return this.run(req, res, () => this.svc.upload(file, body?.scheduledAt), "Yüklenemedi");
  }

  @Patch("queue/:id")
  update(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: any) {
    return this.run(req, res, () => this.svc.update(id, body), "Güncellenemedi");
  }

  @Get("activity")
  activity(@Req() req: Request, @Res() res: Response) {
    return this.run(req, res, () => this.svc.activity(), "Etkinlik okunamadı");
  }
}
