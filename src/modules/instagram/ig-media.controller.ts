import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { isAuthed } from "../growth/lib/auth.js";
import { IgPublisherService } from "./ig-publisher.service.js";
import { contentTypeFor, isValidMediaFile, mediaDir } from "./ig-publisher.logic.js";

// Hikâye görselleri herkese açık: Meta image_url'yi kendisi indirir. Next.js yalnızca /api, /r, /demo, /sunum… yollarını
// backend'e ilettiği için yol /api/public/ig-media/:file (iki+ parça; GrowthController'daki "api/:endpoint" ile çakışmaz).
// Dosya adı katı biçimde doğrulanır ([a-z0-9-]+.(jpg|png|mp4|mov)); dizin dışına çıkış mümkün değildir. Video için
// Range istekleri (206) express sendFile tarafından desteklenir; içerik türü video/mp4 ya da video/quicktime.

const HEADERS = { "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "cross-origin" };

@Controller("api/public/ig-media")
export class IgMediaController {
  @Get(":file")
  file(@Param("file") file: string, @Res() res: Response) {
    if (!isValidMediaFile(file)) return res.status(404).set({ ...HEADERS, "Cache-Control": "no-store" }).type("text/plain").send("Not found");
    res.set({ ...HEADERS, "Cache-Control": "public, max-age=86400" }).type(contentTypeFor(file));
    return res.sendFile(file, { root: mediaDir(), dotfiles: "deny" }, (err?: any) => {
      if (!err || res.headersSent) return;
      res.status(404).set({ "Cache-Control": "no-store" }).type("text/plain").send("Not found");
    });
  }
}

// Panel: hikâye kuyruğu (oturum gerekir).
@Controller("api/growth-audit")
export class IgQueueController {
  constructor(private readonly publisher: IgPublisherService) {}

  @Get("ig-queue")
  async queue(@Req() req: Request, @Res() res: Response) {
    if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
    try { return res.status(200).json(await this.publisher.queue()); }
    catch { return res.status(503).json({ error: "Kuyruk okunamadı" }); }
  }
}
