import { All, Controller, Get, Param, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import ads from "./api/ads.js";
import demo from "./api/demo.js";
import events from "./api/events.js";
import img from "./api/img.js";
import leads from "./api/leads.js";
import login from "./api/login.js";
import logout from "./api/logout.js";
import publicApi from "./api/public.js";
import radar from "./api/radar.js";
import refs from "./api/refs.js";
import send from "./api/send.js";
import settings from "./api/settings.js";
import tools from "./api/tools.js";

type Handler = (req: Request, res: Response) => unknown;
const handlers: Record<string, Handler> = {
  ads, demo, events, img, leads, login, logout, public: publicApi,
  refs, send, settings, tools, radar,
};

// Express 5'te req.query her erişimde yeniden ayrıştırılan bir okuyucudur; üzerine yazılan alanlar kaybolur.
// Yol parametrelerini eski işleyicilere iletmek için sorgu nesnesi isteğin kendi alanı olarak yeniden tanımlanır.
function withQuery(req: Request, extra: Record<string, string>): Request {
  Object.defineProperty(req, "query", { value: { ...(req.query as Record<string, unknown>), ...extra }, writable: true, configurable: true, enumerable: true });
  return req;
}

@Controller()
export class GrowthController {
  @All("api/track")
  track(@Req() req: Request, @Res() res: Response) {
    return publicApi(withQuery(req, { type: "track" }), res);
  }

  @All("api/domain")
  domain(@Req() req: Request, @Res() res: Response) {
    return publicApi(withQuery(req, { type: "domain" }), res);
  }

  @All("api/:endpoint")
  api(@Param("endpoint") endpoint: string, @Req() req: Request, @Res() res: Response) {
    const handler = handlers[endpoint];
    if (!handler) return res.status(404).json({ error: "Bulunamadı" });
    return handler(req, res);
  }

  @Get("sunum/:slug")
  sunum(@Param("slug") slug: string, @Req() req: Request, @Res() res: Response) {
    return demo(withQuery(req, { slug, page: "sunum" }), res);
  }

  @Get("demo/:slug")
  demoHome(@Param("slug") slug: string, @Req() req: Request, @Res() res: Response) {
    return demo(withQuery(req, { slug }), res);
  }

  @Get("demo/:slug/*page")
  demoPage(@Param("slug") slug: string, @Param("page") page: string | string[], @Req() req: Request, @Res() res: Response) {
    return demo(withQuery(req, { slug, page: Array.isArray(page) ? page.join("/") : page }), res);
  }
}
