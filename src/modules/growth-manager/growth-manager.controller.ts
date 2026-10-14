import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { publicMessage } from "../../infrastructure/http/http-hardening.js";
import { clientIp, rateLimited } from "../../infrastructure/http/rate-limit.js";
import { isAuthed, sessionUser } from "../growth/lib/auth.js";
import { canManage, GmForbidden, GmNotFound, GrowthManagerService, PortalSession } from "./growth-manager.service.js";

const UUID = /^[0-9a-f-]{36}$/i;
const COOKIE = "im_portal";
const cookieOf = (req: Request) => (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1) || null;
const setCookie = (res: Response, value: string, maxAge: number) => res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);

function fail(res: Response, error: any) {
  if (error instanceof GmNotFound) return res.status(404).json({ error: error.message });
  if (error instanceof GmForbidden) return res.status(403).json({ error: error.message });
  if (error?.retryable) return res.status(503).json({ error: error.message });
  return res.status(400).json({ error: publicMessage(error) });
}

// ---------------- Yönetim paneli (Istanbul Marketing ekibi oturumu) ----------------
@Controller("api/gm")
export class GrowthManagerAdminController {
  constructor(private readonly gm: GrowthManagerService) {}

  private async run(req: Request, res: Response, work: () => Promise<unknown>) {
    if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
    try { return res.status(200).json(await work()); } catch (e) { return fail(res, e); }
  }
  private id(id: string, res: Response) { if (!UUID.test(id)) { res.status(404).json({ error: "Bulunamadı" }); return false; } return true; }

  @Get("organizations") list(@Req() req: Request, @Res() res: Response) { return this.run(req, res, () => this.gm.listOrgs()); }
  @Post("organizations") create(@Body() body: any, @Req() req: Request, @Res() res: Response) { return this.run(req, res, () => this.gm.createOrg(body || {})); }
  @Post("organizations/demo") demo(@Req() req: Request, @Res() res: Response) { return this.run(req, res, () => this.gm.createDemoOrg()); }

  @Get("organizations/:id") get(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    if (!this.id(id, res)) return; return this.run(req, res, async () => ({ ...(await this.gm.getOrg(id)), integrationStatus: await this.gm.integrations(id) }));
  }
  @Post("organizations/:id/users") invite(@Param("id") id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (!this.id(id, res)) return;
    return this.run(req, res, async () => { const r = await this.gm.inviteUser(id, body || {}); return { ...r, url: `${base(req)}/portal/davet?token=${r.token}`, token: undefined }; });
  }
  @Patch("organizations/:id/users/:userId") userStatus(@Param("id") id: string, @Param("userId") userId: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (!this.id(id, res) || !this.id(userId, res)) return;
    return this.run(req, res, () => this.gm.setUserStatus(id, userId, body?.status === "disabled" ? "disabled" : "active"));
  }
  @Post("organizations/:id/run") runNow(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    if (!this.id(id, res)) return;
    return this.run(req, res, async () => {
      const org = await this.gm.getOrg(id), synced: Record<string, unknown> = {};
      for (const i of org.integrations.filter((x) => x.status === "connected")) synced[i.provider] = await this.gm.syncIntegration(i.id).catch((e) => ({ error: e.message }));
      return { synced, analysis: await this.gm.analyze(id), brief: (await this.gm.generateBrief(id, true)).id };
    });
  }
  @Post("organizations/:id/integrations/:provider/connect") connect(@Param("id") id: string, @Param("provider") provider: string, @Req() req: Request, @Res() res: Response) {
    if (!this.id(id, res)) return; return this.run(req, res, () => this.gm.startConnect(id, provider, { kind: "admin", id: sessionUser(req) || "admin" }, "admin"));
  }
  @Get("organizations/:id/integrations/:iid/accounts") accounts(@Param("id") id: string, @Param("iid") iid: string, @Req() req: Request, @Res() res: Response) {
    if (!this.id(id, res) || !this.id(iid, res)) return; return this.run(req, res, () => this.gm.accounts(id, iid));
  }
  @Post("organizations/:id/integrations/:iid/account") account(@Param("id") id: string, @Param("iid") iid: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (!this.id(id, res) || !this.id(iid, res)) return; return this.run(req, res, () => this.gm.selectAccount(id, iid, String(body?.accountId || "")));
  }
  @Post("organizations/:id/integrations/:iid/disconnect") disconnect(@Param("id") id: string, @Param("iid") iid: string, @Req() req: Request, @Res() res: Response) {
    if (!this.id(id, res) || !this.id(iid, res)) return; return this.run(req, res, () => this.gm.disconnect(id, iid));
  }
  // Salt okunur portal önizlemesi (1 saat). Yönetici oturumu gerekir.
  @Post("organizations/:id/preview") async preview(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
    if (!this.id(id, res)) return;
    try { setCookie(res, await this.gm.previewSession(id, sessionUser(req) || "yönetici"), 3600); return res.json({ ok: true, url: "/portal" }); } catch (e) { return fail(res, e); }
  }
}

function base(req: Request) {
  if (process.env.PUBLIC_PORTAL_BASE_URL) return process.env.PUBLIC_PORTAL_BASE_URL.replace(/\/$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  return `${proto}://${String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim()}`;
}

// ---------------- Müşteri portalı ----------------
@Controller("api/portal")
export class PortalController {
  constructor(private readonly gm: GrowthManagerService) {}

  private async run(req: Request, res: Response, work: (s: PortalSession) => Promise<unknown>, opts: { manage?: boolean } = {}) {
    const s = await this.gm.session(cookieOf(req)).catch(() => null);
    if (!s) return res.status(401).json({ error: "Oturum gerekli" });
    if (opts.manage && !canManage(s)) return res.status(403).json({ error: s.preview ? "Önizleme salt okunurdur" : "Bu işlem için yönetici veya sahip rolü gerekir" });
    try { return res.status(200).json(await work(s)); } catch (e) { return fail(res, e); }
  }

  @Post("login") async login(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    const email = String(body?.email || "").toLowerCase();
    // IP başına 15 dakikada 20, aynı e-posta+IP için 5 deneme. Yalnızca e-posta anahtarı kullanılmaz (hedefli kilitlemeyi önler).
    const ip = clientIp(req);
    if (rateLimited(`portal-login:${ip}`, 20, 15 * 60_000) || rateLimited(`portal-login:${email}:${ip}`, 5, 15 * 60_000)) return res.status(429).json({ error: "Çok fazla deneme; 15 dakika sonra tekrar deneyin" });
    try { setCookie(res, await this.gm.login(email, String(body?.password || "")), 60 * 60 * 12); return res.json({ ok: true }); } catch (e) { return fail(res, e); }
  }
  @Post("invite/accept") async accept(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (rateLimited(`portal-invite:${clientIp(req)}`, 10)) return res.status(429).json({ error: "Çok fazla deneme" });
    try { setCookie(res, await this.gm.acceptInvite(String(body?.token || ""), String(body?.password || ""), body?.name), 60 * 60 * 12); return res.json({ ok: true }); } catch (e) { return fail(res, e); }
  }
  @Post("logout") logout(@Res() res: Response) { setCookie(res, "", 0); return res.json({ ok: true }); }

  @Get("me") me(@Req() req: Request, @Res() res: Response) {
    return this.run(req, res, async (s) => { const org = await this.gm.getOrg(s.orgId); return { ...s, canManage: canManage(s), org: { name: org.name, isDemo: org.isDemo } }; });
  }
  @Get("overview") overview(@Req() req: Request, @Res() res: Response) { return this.run(req, res, (s) => this.gm.overview(s.orgId)); }
  @Get("insights") insights(@Req() req: Request, @Res() res: Response) { return this.run(req, res, (s) => this.gm.insights(s.orgId)); }
  @Patch("insights/:id") insight(@Param("id") id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (!UUID.test(id)) return res.status(404).json({ error: "Bulunamadı" });
    return this.run(req, res, (s) => this.gm.setInsightStatus(s.orgId, id, String(body?.status || "")), { manage: true });
  }
  @Get("briefs") briefs(@Req() req: Request, @Res() res: Response) { return this.run(req, res, (s) => this.gm.briefs(s.orgId)); }
  @Get("audit") audit(@Req() req: Request, @Res() res: Response) { return this.run(req, res, (s) => this.gm.auditView(s.orgId)); }
  @Get("actions") actions(@Req() req: Request, @Res() res: Response) { return this.run(req, res, (s) => this.gm.actions(s.orgId)); }
  @Post("actions/:id/decision") decide(@Param("id") id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (!UUID.test(id)) return res.status(404).json({ error: "Bulunamadı" });
    return this.run(req, res, (s) => this.gm.decideAction(s.orgId, id, String(body?.decision || ""), String(body?.note || ""), s.email), { manage: true });
  }
  @Get("integrations") integrations(@Req() req: Request, @Res() res: Response) { return this.run(req, res, (s) => this.gm.integrations(s.orgId)); }
  @Post("integrations/:provider/connect") connect(@Param("provider") provider: string, @Req() req: Request, @Res() res: Response) {
    return this.run(req, res, (s) => this.gm.startConnect(s.orgId, provider, { kind: "portal", id: s.userId! }, "portal"), { manage: true });
  }
  @Get("integrations/:iid/accounts") accounts(@Param("iid") iid: string, @Req() req: Request, @Res() res: Response) {
    if (!UUID.test(iid)) return res.status(404).json({ error: "Bulunamadı" });
    return this.run(req, res, (s) => this.gm.accounts(s.orgId, iid), { manage: true });
  }
  @Post("integrations/:iid/account") account(@Param("iid") iid: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (!UUID.test(iid)) return res.status(404).json({ error: "Bulunamadı" });
    return this.run(req, res, (s) => this.gm.selectAccount(s.orgId, iid, String(body?.accountId || "")), { manage: true });
  }
  @Post("integrations/:iid/disconnect") disconnect(@Param("iid") iid: string, @Req() req: Request, @Res() res: Response) {
    if (!UUID.test(iid)) return res.status(404).json({ error: "Bulunamadı" });
    return this.run(req, res, (s) => this.gm.disconnect(s.orgId, iid), { manage: true });
  }
}

// ---------------- Google OAuth dönüşü ----------------
@Controller("oauth/google")
export class OAuthController {
  constructor(private readonly gm: GrowthManagerService) {}

  @Get("callback") async callback(@Query("code") code: string, @Query("state") state: string, @Query("error") error: string, @Req() req: Request, @Res() res: Response) {
    const back = (ret: string, orgId: string | null, q: string) => res.redirect(302, ret === "admin" && orgId ? `/yonetim/growth-manager?org=${orgId}&${q}` : `/portal?tab=entegrasyonlar&${q}`);
    if (error || !code || !state) return back("portal", null, `baglanti=iptal`);
    try {
      const r = await this.gm.handleCallback(code, state, async (by, orgId) => {
        if (by.startsWith("admin:")) return isAuthed(req);
        const s = await this.gm.session(cookieOf(req)); return !!s && s.orgId === orgId && `portal:${s.userId}` === by && canManage(s);
      });
      return back(r.ret, r.orgId, `baglanti=${r.accounts === 1 ? "tamam" : "hesap-sec"}&entegrasyon=${r.integrationId}`);
    } catch (e: any) {
      return back("portal", null, `baglanti=hata&mesaj=${encodeURIComponent(String(e.message).slice(0, 160))}`);
    }
  }
}
