import { Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { log, publicMessage } from "../../infrastructure/http/http-hardening.js";
import { clientIp, rateLimited } from "../../infrastructure/http/rate-limit.js";
import { canManage, GrowthManagerService } from "../growth-manager/growth-manager.service.js";
import { isAuthed, sessionUser } from "../growth/lib/auth.js";
import { PayConflict, PayNotFound, PaymentsService } from "./payments.service.js";
import { mockDecide } from "./providers.js";

const UUID = /^[0-9a-f-]{36}$/i;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
// Referrer-Policy "same-origin": belirteçli adres dış sitelere sızmaz, ancak sayfadan yapılan form gönderimlerinde
// tarayıcı Origin başlığını gönderir ("no-referrer" altında Origin: null olur ve CSRF denetimi meşru isteği de reddeder).
const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY" };

export function baseUrl(req: Request) {
  const configured = process.env.PUBLIC_PAYMENT_BASE_URL || process.env.PUBLIC_PORTAL_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  return `${proto}://${String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim()}`;
}
const money = (v: number, c: string) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: c, maximumFractionDigits: 2 }).format(v);

function page(title: string, body: string) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="same-origin"><title>${esc(title)} · Istanbul Marketing</title>
<style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f5f3ef;color:#07111f;display:grid;place-items:center;min-height:100vh;padding:20px;box-sizing:border-box}
.c{width:min(440px,100%);background:#fff;border:1px solid #e6e2da;border-radius:18px;padding:28px;display:grid;gap:14px}.c img{width:150px}h1{margin:0;font-size:22px}p{margin:0;color:#5d6470;line-height:1.5}
.amt{font-size:34px;font-weight:800;letter-spacing:-.02em;color:#07111f}button,.btn{display:block;width:100%;text-align:center;border:0;border-radius:12px;padding:14px;font:inherit;font-weight:700;font-size:16px;background:#07111f;color:#fff;cursor:pointer;text-decoration:none}
.muted{font-size:13px;color:#8a909a}.ok{color:#1f8a4c}.bad{color:#c2341f}.test{background:#fdf1dc;color:#b26a00;font-weight:700;font-size:13px;padding:8px 10px;border-radius:10px}.iban{background:#f5f3ef;border-radius:10px;padding:12px;font-size:14px}</style></head>
<body><div class="c"><img src="/brand/logo-wordmark-on-light.png" alt="istanbul.marketing">${body}</div></body></html>`;
}

// ---------------- Yönetim paneli ----------------
@Controller("api/payments")
export class PaymentsAdminController {
  constructor(private readonly payments: PaymentsService) {}

  private async run(req: Request, res: Response, work: () => Promise<unknown>) {
    if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
    try { return res.json(await work()); }
    catch (e) { return res.status(e instanceof PayNotFound ? 404 : e instanceof PayConflict ? 409 : 400).json({ error: publicMessage(e) }); }
  }

  @Get("config") config(@Req() req: Request, @Res() res: Response) { return this.run(req, res, async () => this.payments.config()); }
  @Post(":paymentId/links") create(@Param("paymentId") id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    return this.run(req, res, async () => { const l = await this.payments.createLink(id, Number(body?.days || 14), sessionUser(req)); return { id: l.id, expiresAt: l.expiresAt, url: `${baseUrl(req)}/odeme/${l.token}` }; });
  }
  @Get(":paymentId/links") links(@Param("paymentId") id: string, @Req() req: Request, @Res() res: Response) { return this.run(req, res, () => this.payments.links(id)); }
  @Post("links/:id/revoke") revoke(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    if (!UUID.test(id)) return res.status(404).json({ error: "Link bulunamadı" });
    return this.run(req, res, () => this.payments.revoke(id));
  }

  // Sağlayıcı dönüşü (tarayıcı iyzico'dan buraya POST ile gelir). Sonuç sunucudan sağlayıcıya sorulur.
  @Post("callback") async callback(@Body() body: any, @Req() req: Request, @Res() res: Response) { return this.finish(String(body?.token || ""), res); }
  @Get("callback") async callbackGet(@Query("token") token: string, @Res() res: Response) { return this.finish(String(token || ""), res); }

  private async finish(token: string, res: Response) {
    try {
      const r = await this.payments.complete(token);
      const ok = r.status === "success";
      return res.redirect(303, r.source === "portal" ? `/portal?tab=odemeler&odeme=${ok ? "basarili" : "basarisiz"}` : `/odeme-sonuc?durum=${ok ? "basarili" : "basarisiz"}`);
    } catch (e: any) {
      log("warn", "payment_callback", { error: e.message });
      return res.redirect(303, "/odeme-sonuc?durum=hata");
    }
  }

  // Yerel test sağlayıcısının sahte ödeme sayfası (yalnızca PAYMENT_PROVIDER=mock ve üretim dışı).
  @Get("mock/:token") mockPage(@Param("token") token: string, @Res() res: Response) {
    if (process.env.PAYMENT_PROVIDER !== "mock" || process.env.NODE_ENV === "production") return res.status(404).send("Bulunamadı");
    const t = esc(token);
    return res.set(HEADERS).type("html").send(page("Test ödeme", `<div class="test">TEST ÖDEME SAYFASI — gerçek kart veya para hareketi yoktur.</div><h1>Test ödeme</h1><p>Bu sayfa iyzico ödeme ekranının yerine geçer.</p>
      <form method="post" action="/api/payments/mock/${t}"><input type="hidden" name="result" value="success"><button>Ödemeyi başarılı say</button></form>
      <form method="post" action="/api/payments/mock/${t}"><input type="hidden" name="result" value="failure"><button style="background:#fff;color:#c2341f;border:1px solid #e6e2da">Kart reddedildi say</button></form>`));
  }
  @Post("mock/:token") mockDecide(@Param("token") token: string, @Body() body: any, @Res() res: Response) {
    if (process.env.PAYMENT_PROVIDER !== "mock" || process.env.NODE_ENV === "production") return res.status(404).send("Bulunamadı");
    if (!mockDecide(token, body?.result === "success" ? "success" : "failure")) return res.status(404).send("Bulunamadı");
    return res.redirect(303, `/api/payments/callback?token=${encodeURIComponent(token)}`);
  }
}

// ---------------- Müşteriye gönderilen ödeme linki ----------------
@Controller()
export class PaymentLinkController {
  constructor(private readonly payments: PaymentsService) {}

  @Get("odeme/:token") async show(@Param("token") token: string, @Req() req: Request, @Res() res: Response) {
    if (rateLimited(`paylink:${clientIp(req)}`, 30)) return res.status(429).send("Çok fazla istek");
    res.set(HEADERS).type("html");
    const link = await this.payments.linkInfo(token).catch(() => null);
    if (!link) return res.status(404).send(page("Ödeme linki", `<h1>Ödeme linki geçersiz</h1><p>Link geçersiz, süresi dolmuş veya iptal edilmiş olabilir. Güncel link için Istanbul Marketing ile iletişime geçin.</p>`));
    const p = link.payment, cfg = this.payments.config();
    if (p.status === "paid") return res.send(page("Ödeme alındı", `<h1 class="ok">Bu ödeme alındı</h1><p>${esc(money(Number(p.amount), p.currency))} tutarındaki ödemeniz için teşekkür ederiz.</p>`));
    const bank = cfg.bank ? `<div class="iban"><b>Havale / EFT</b><br>${esc(cfg.bank.accountName || "")}${cfg.bank.bank ? ` · ${esc(cfg.bank.bank)}` : ""}<br><b>${esc(cfg.bank.iban)}</b><br><span class="muted">Açıklamaya ${esc(p.invoiceNo ? "fatura no: " + p.invoiceNo : "firma adınızı")} yazın.</span></div>` : "";
    return res.send(page("Ödeme", `${cfg.test ? '<div class="test">TEST ORTAMI — gerçek tahsilat yapılmaz.</div>' : ""}<p>${esc(p.customer.name)}</p><div class="amt">${esc(money(Number(p.amount), p.currency))}</div>
      <p>${esc(p.contract?.title || "Istanbul Marketing hizmet bedeli")}${p.invoiceNo ? ` · Fatura ${esc(p.invoiceNo)}` : ""}${p.dueDate ? ` · Son ödeme ${esc(p.dueDate.toLocaleDateString("tr-TR"))}` : ""}</p>
      ${cfg.configured ? `<form method="post" action="/odeme/${esc(token)}"><button>Kartla öde</button></form><p class="muted">Ödeme ${cfg.provider === "iyzico" ? "iyzico" : "ödeme kuruluşunun"} güvenli sayfasında yapılır; kart bilgileriniz Istanbul Marketing'e iletilmez. Taksit seçenekleri ödeme sayfasında gösterilir.</p>` : ""}${bank}`));
  }

  @Post("odeme/:token") async start(@Param("token") token: string, @Req() req: Request, @Res() res: Response) {
    if (rateLimited(`paystart:${clientIp(req)}`, 10)) return res.status(429).send("Çok fazla istek");
    try { const r = await this.payments.startFromLink(token, clientIp(req), baseUrl(req)); return res.redirect(303, r.url); }
    catch (e) { return res.status(e instanceof PayNotFound ? 404 : 409).set(HEADERS).type("html").send(page("Ödeme", `<h1>Ödeme başlatılamadı</h1><p>${esc(publicMessage(e))}</p>`)); }
  }

  @Get("odeme-sonuc") result(@Query("durum") durum: string, @Res() res: Response) {
    res.set(HEADERS).type("html");
    if (durum === "basarili") return res.send(page("Ödeme alındı", `<h1 class="ok">Ödemeniz alındı</h1><p>Teşekkür ederiz. Ödeme kaydınız güncellendi; dekont e-postanıza ödeme kuruluşu tarafından gönderilir.</p>`));
    if (durum === "basarisiz") return res.send(page("Ödeme tamamlanmadı", `<h1 class="bad">Ödeme tamamlanmadı</h1><p>Kartınızdan çekim yapılmadı. Linke geri dönüp tekrar deneyebilir veya havale/EFT ile ödeyebilirsiniz.</p>`));
    return res.send(page("Ödeme", `<h1>Ödeme sonucu doğrulanamadı</h1><p>Kartınızdan çekim yapıldıysa kayıt kısa süre içinde güncellenir. Sorun sürerse Istanbul Marketing ile iletişime geçin.</p>`));
  }
}

// ---------------- Müşteri portalı: ödemeler ve sözleşmeler ----------------
@Controller("api/portal/billing")
export class PortalBillingController {
  constructor(private readonly payments: PaymentsService, private readonly gm: GrowthManagerService) {}

  private cookie(req: Request) { return (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith("im_portal="))?.slice(10) || null; }

  @Get() async billing(@Req() req: Request, @Res() res: Response) {
    const s = await this.gm.session(this.cookie(req)).catch(() => null);
    if (!s) return res.status(401).json({ error: "Oturum gerekli" });
    const org = await this.gm.getOrg(s.orgId);
    return res.json({ ...(await this.payments.billing(org.customerId)), canPay: canManage(s) });
  }

  // Kartla ödeme yalnızca sahip/yönetici rolüyle (önizleme ve izleyici ödeme başlatamaz).
  @Post(":paymentId/checkout") async checkout(@Param("paymentId") id: string, @Req() req: Request, @Res() res: Response) {
    const s = await this.gm.session(this.cookie(req)).catch(() => null);
    if (!s) return res.status(401).json({ error: "Oturum gerekli" });
    if (!canManage(s)) return res.status(403).json({ error: s.preview ? "Önizleme salt okunurdur" : "Ödeme için yönetici veya sahip rolü gerekir" });
    if (rateLimited(`paystart:${clientIp(req)}`, 10)) return res.status(429).json({ error: "Çok fazla deneme" });
    try {
      const org = await this.gm.getOrg(s.orgId);
      return res.json(await this.payments.startFromPortal(org.customerId, id, clientIp(req), baseUrl(req)));
    } catch (e) { return res.status(e instanceof PayNotFound ? 404 : 409).json({ error: publicMessage(e) }); }
  }
}
