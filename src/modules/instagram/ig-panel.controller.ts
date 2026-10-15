import { Body, CanActivate, Controller, ExecutionContext, Get, HttpException, Injectable, Param, Patch, Post, Query, Req, Res, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { diskStorage } from "multer";
import { isAuthed } from "../growth/lib/auth.js";
import { IgPanelService, PanelError, type Uploads } from "./ig-panel.service.js";
import { MAX_REQUEST_FILE_BYTES, MAX_REQUEST_FILES } from "./ig-panel.logic.js";
import { mediaDir, safeError } from "./ig-publisher.logic.js";

// Panel "Instagram" sekmesi uçları (oturum gerekir). Yol iki+ parçalı: GrowthController'daki "api/:endpoint" ile çakışmaz.

// Yüklemede oturum, dosya belleğe alınmadan önce denetlenir (guard'lar interceptor'lardan önce çalışır).
@Injectable()
export class SessionGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    if (isAuthed(ctx.switchToHttp().getRequest())) return true;
    throw new HttpException({ error: "Giriş gerekli" }, 401);
  }
}

// Yüklemeler belleğe değil IG_MEDIA_DIR/.upload-tmp altına yazılır (Reels 300 MB'a kadar); kalıcı dosya aynı diskte
// bağlanır (link), geçici dosya her durumda silinir. Nokta ile başlayan klasör medya ucundan sunulmaz (ad doğrulaması).
export const uploadTmpDir = () => path.join(mediaDir(), ".upload-tmp");
const uploadInterceptor = FileFieldsInterceptor([{ name: "files", maxCount: 10 }, { name: "image", maxCount: 1 }, { name: "cover", maxCount: 1 }], {
  storage: diskStorage({
    destination: (_req: any, _file: any, cb: any) => { try { const d = uploadTmpDir(); mkdirSync(d, { recursive: true }); cb(null, d); } catch (e) { cb(e); } },
    filename: (_req: any, _file: any, cb: any) => cb(null, `up-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`),
  }),
  limits: { fileSize: MAX_REQUEST_FILE_BYTES, files: MAX_REQUEST_FILES, fields: 12, fieldSize: 16 * 1024 },
});

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

  // multipart: kind (story|image|carousel|reels), caption, scheduledAt ("2026-10-16T11:00" İstanbul), files[] (sırasıyla), cover (Reels, isteğe bağlı).
  // Eski panel alanı "image" da kabul edilir (tek hikâye).
  @Post("queue")
  @UseGuards(SessionGuard)
  @UseInterceptors(uploadInterceptor)
  upload(@Req() req: Request, @Res() res: Response, @UploadedFiles() files: Uploads, @Body() body: any) {
    return this.run(req, res, () => this.svc.create(body, files), "Yüklenemedi");
  }

  // JSON {action: cancel|reschedule|now|retry, scheduledAt?} ya da düzenleme {action: "edit", caption?, scheduledAt?, order?, removeCover?}
  // (düzenleme multipart da olabilir: yeni files[] / cover).
  @Patch("queue/:id")
  @UseGuards(SessionGuard)
  @UseInterceptors(uploadInterceptor)
  update(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: any, @UploadedFiles() files?: Uploads) {
    if (body?.action === "edit") return this.run(req, res, () => this.svc.edit(id, body, files), "Güncellenemedi");
    return this.run(req, res, () => this.svc.update(id, body), "Güncellenemedi");
  }

  @Get("activity")
  activity(@Req() req: Request, @Res() res: Response) {
    return this.run(req, res, () => this.svc.activity(), "Etkinlik okunamadı");
  }
}
