import { Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { log } from "../../infrastructure/http/http-hardening.js";
import { InstagramService } from "./instagram.service.js";
import { igConfig, verifyChallenge, verifySignature } from "./instagram.logic.js";

// Meta webhook uçları. Yol iki parçalıdır; GrowthController'daki "api/:endpoint" yakalayıcısıyla çakışmaz.
// POST imzası ham gövde üzerinden doğrulanır (main.ts: rawBody: true). Yanıt hemen 200 döner, işlem arka planda yapılır.

@Controller("api/instagram")
export class InstagramController {
  constructor(private readonly service: InstagramService) {}

  @Get("webhook")
  verify(@Req() req: Request, @Res() res: Response) {
    const cfg = igConfig();
    const challenge = cfg ? verifyChallenge(req.query as any, cfg.verifyToken) : null;
    if (!challenge) return res.status(403).send("Forbidden");
    return res.status(200).type("text/plain").send(challenge);
  }

  @Post("webhook")
  receive(@Req() req: Request & { rawBody?: Buffer }, @Res() res: Response) {
    const cfg = igConfig();
    if (!cfg) return res.status(404).json({ error: "Instagram botu kapalı" });
    if (!verifySignature(req.rawBody, req.headers["x-hub-signature-256"], cfg.appSecret)) {
      log("warn", "instagram_bad_signature", {});
      return res.status(401).json({ error: "Geçersiz imza" });
    }
    res.status(200).send("EVENT_RECEIVED");
    setImmediate(() => { this.service.handleWebhook(req.body).catch((e) => log("error", "instagram_webhook", { error: e?.message })); });
  }
}
