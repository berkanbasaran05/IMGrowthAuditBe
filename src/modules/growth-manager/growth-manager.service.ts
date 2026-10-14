import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { getOne } from "../growth/lib/redis.js";
import { buildReport } from "../sales/report.model.js";
import { addDays, latestDate, MetricRow, windowEnding } from "./analytics.js";
import { aiHealthSummary, buildBrief, computeKpis, StoredInsight } from "./brief.js";
import { demoRows } from "./demo.js";
import { DEFAULT_CONFIG, DETECTOR_VERSION, Insight, runDetectors } from "./detectors.js";
import { authorizationUrl, exchangeCode, fetchRows, isProvider, listAccounts, oauthConfigured, Provider, PROVIDERS, refreshAccess, revokeToken } from "./google.js";
import { decryptSecret, encryptionConfigured, encryptSecret, hashPassword, passwordProblem, randomToken, sha256, sign, verify, verifyPassword } from "./security.js";

export class GmNotFound extends Error {}
export class GmForbidden extends Error {}

export type Role = "owner" | "manager" | "viewer";
export interface PortalSession { userId: string | null; orgId: string; role: Role; email: string; name: string | null; preview: boolean }
export interface Actor { kind: "admin" | "portal"; id: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_TTL = 60 * 60 * 12, PREVIEW_TTL = 60 * 60;
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
const dbDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const slugify = (v: string) => v.toLocaleLowerCase("tr").replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" }[c]!)).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "musteri";
export const canManage = (s: PortalSession) => !s.preview && (s.role === "owner" || s.role === "manager");

@Injectable()
export class GrowthManagerService {
  private readonly log = new Logger("GrowthManager");
  constructor(private readonly prisma: PrismaService, private readonly audits: AuditService) {}

  // =================== Yönetici (Istanbul Marketing ekibi) ===================

  async listOrgs() {
    const orgs = await this.prisma.customerOrganization.findMany({ orderBy: { createdAt: "desc" }, include: { integrations: { select: { provider: true, status: true, lastSyncAt: true } }, _count: { select: { users: true } } } });
    const open = await this.prisma.aiInsight.groupBy({ by: ["organizationId"], where: { status: "open" }, _count: true });
    const briefs = await this.prisma.dailyBrief.groupBy({ by: ["organizationId"], _max: { briefDate: true } });
    return orgs.map((o) => ({ ...o, openInsights: open.find((x) => x.organizationId === o.id)?._count ?? 0, lastBrief: briefs.find((b) => b.organizationId === o.id)?._max.briefDate ?? null }));
  }

  async createOrg(input: { name?: string; customerId?: string; leadId?: string }) {
    const name = String(input.name || "").trim().slice(0, 120);
    if (!name) throw new Error("Organizasyon adı gerekli");
    if (input.customerId && !(await this.prisma.customer.findUnique({ where: { id: input.customerId } }))) throw new Error("CRM müşterisi bulunamadı");
    if (input.leadId && !(await getOne("leads", input.leadId))) throw new Error("Firma kaydı bulunamadı");
    let slug = slugify(name);
    if (await this.prisma.customerOrganization.findUnique({ where: { slug } })) slug = `${slug}-${randomToken().slice(0, 5).toLowerCase()}`;
    return this.prisma.customerOrganization.create({ data: { name, slug, customerId: input.customerId || null, leadId: input.leadId || null } });
  }

  async getOrg(id: string) {
    const org = await this.prisma.customerOrganization.findUnique({
      where: { id },
      include: {
        users: { select: { id: true, email: true, name: true, role: true, status: true, lastLoginAt: true, inviteExpiresAt: true, createdAt: true }, orderBy: { createdAt: "asc" } },
        integrations: { select: { id: true, provider: true, status: true, externalAccountId: true, displayName: true, connectedAt: true, lastSyncAt: true, lastError: true }, orderBy: { provider: "asc" } },
      },
    });
    if (!org) throw new GmNotFound("Organizasyon bulunamadı");
    return org;
  }

  // Davet bağlantısı: belirteç yalnızca özetiyle saklanır, 7 gün geçerlidir ve bir kez gösterilir.
  async inviteUser(orgId: string, input: { email?: string; role?: string; name?: string }) {
    await this.getOrg(orgId);
    const email = String(input.email || "").trim().toLowerCase(), role = (["owner", "manager", "viewer"].includes(String(input.role)) ? input.role : "viewer") as Role;
    if (!EMAIL.test(email)) throw new Error("Geçerli bir e-posta girin");
    const existing = await this.prisma.customerUser.findUnique({ where: { email } });
    if (existing && existing.organizationId !== orgId) throw new Error("Bu e-posta başka bir organizasyonda kayıtlı");
    if (existing?.status === "active") throw new Error("Kullanıcı zaten aktif");
    const token = randomToken();
    const data = { name: String(input.name || "").trim().slice(0, 120) || null, role, status: "invited", inviteTokenHash: sha256(token), inviteExpiresAt: new Date(Date.now() + 7 * 86_400_000) };
    const user = existing
      ? await this.prisma.customerUser.update({ where: { id: existing.id }, data })
      : await this.prisma.customerUser.create({ data: { organizationId: orgId, email, ...data } });
    return { userId: user.id, email, role, token, expiresAt: data.inviteExpiresAt };
  }

  async setUserStatus(orgId: string, userId: string, status: "active" | "disabled") {
    const r = await this.prisma.customerUser.updateMany({ where: { id: userId, organizationId: orgId, status: { not: "invited" } }, data: { status, sessionVersion: { increment: 1 } } });
    if (!r.count) throw new GmNotFound("Kullanıcı bulunamadı");
    return { ok: true };
  }

  // Yönetici önizlemesi: salt okunur, 1 saatlik portal oturumu (destek ve doğrulama için).
  async previewSession(orgId: string, adminUser: string) {
    const org = await this.getOrg(orgId);
    return sign("portal", { pv: 1, org: org.id, by: adminUser, exp: Math.floor(Date.now() / 1000) + PREVIEW_TTL });
  }

  async createDemoOrg() {
    const org = await this.prisma.customerOrganization.create({ data: { name: "Demo Diş Kliniği", slug: `demo-${randomToken().slice(0, 6).toLowerCase()}`, isDemo: true } });
    for (const provider of Object.keys(PROVIDERS) as Provider[]) {
      await this.prisma.customerIntegration.create({ data: { organizationId: org.id, provider, status: "demo", displayName: "DEMO VERİ", connectedAt: new Date(), lastSyncAt: new Date() } });
    }
    await this.saveRows(org.id, demoRows(addDays(today(), -1)));
    await this.analyze(org.id);
    await this.generateBrief(org.id, true);
    return org;
  }

  // =================== Portal kimlik doğrulama ===================

  async login(emailRaw: string, password: string) {
    const email = String(emailRaw || "").trim().toLowerCase();
    const user = EMAIL.test(email) ? await this.prisma.customerUser.findUnique({ where: { email }, include: { organization: true } }) : null;
    // Hesap kilidi yalnızca yönetici tarafından konulmuşsa uygulanır; başarısız denemeler hesabı kilitlemez
    // (aksi halde herkes bilinen bir e-postayı kilitleyebilirdi). Kaba kuvvete karşı denetleyicide hız sınırı vardır.
    const locked = user?.lockedUntil && user.lockedUntil > new Date();
    const ok = verifyPassword(String(password || ""), user?.passwordHash); // kullanıcı olmasa da aynı maliyet
    if (!user || locked || !ok || user.status !== "active" || user.organization.status !== "active") {
      if (user && !locked && !ok) {
        const failed = user.failedLogins + 1;
        await this.prisma.customerUser.update({ where: { id: user.id }, data: { failedLogins: failed } });
      }
      throw new GmForbidden(locked ? "Hesap geçici olarak kilitli; Istanbul Marketing ekibiyle iletişime geçin" : "E-posta veya parola hatalı");
    }
    await this.prisma.customerUser.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    return this.sessionToken(user);
  }

  async acceptInvite(token: string, password: string, name?: string) {
    const user = /^[A-Za-z0-9_-]{40,64}$/.test(String(token)) ? await this.prisma.customerUser.findUnique({ where: { inviteTokenHash: sha256(token) } }) : null;
    if (!user || user.status !== "invited" || !user.inviteExpiresAt || user.inviteExpiresAt < new Date()) throw new GmForbidden("Davet bağlantısı geçersiz veya süresi dolmuş");
    const problem = passwordProblem(String(password || "")); if (problem) throw new Error(problem);
    const updated = await this.prisma.customerUser.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(password), status: "active", inviteTokenHash: null, inviteExpiresAt: null, name: String(name || "").trim().slice(0, 120) || user.name, lastLoginAt: new Date(), sessionVersion: { increment: 1 } },
    });
    return this.sessionToken(updated);
  }

  private sessionToken(user: { id: string; organizationId: string; sessionVersion: number }) {
    return sign("portal", { uid: user.id, org: user.organizationId, sv: user.sessionVersion, exp: Math.floor(Date.now() / 1000) + SESSION_TTL });
  }

  async session(cookieValue: string | null): Promise<PortalSession | null> {
    const p = verify<{ uid?: string; org: string; sv?: number; pv?: number; by?: string }>("portal", cookieValue);
    if (!p) return null;
    const org = await this.prisma.customerOrganization.findUnique({ where: { id: p.org } });
    if (!org || org.status === "closed") return null;
    if (p.pv) return { userId: null, orgId: org.id, role: "viewer", email: `${p.by || "yönetici"} (önizleme)`, name: "Istanbul Marketing önizleme", preview: true };
    const user = p.uid ? await this.prisma.customerUser.findUnique({ where: { id: p.uid } }) : null;
    if (!user || user.organizationId !== org.id || user.status !== "active" || user.sessionVersion !== p.sv) return null;
    return { userId: user.id, orgId: org.id, role: user.role as Role, email: user.email, name: user.name, preview: false };
  }

  // =================== Entegrasyonlar ===================

  async integrations(orgId: string) {
    const rows = await this.prisma.customerIntegration.findMany({ where: { organizationId: orgId }, include: { syncs: { orderBy: { startedAt: "desc" }, take: 1 } } });
    return (Object.keys(PROVIDERS) as Provider[]).map((provider) => {
      const r = rows.find((x) => x.provider === provider);
      return {
        provider, name: PROVIDERS[provider].name, configured: oauthConfigured(provider) && encryptionConfigured(),
        id: r?.id ?? null, status: r?.status ?? "not_connected", account: r?.displayName || r?.externalAccountId || null,
        connectedAt: r?.connectedAt ?? null, lastSyncAt: r?.lastSyncAt ?? null, lastError: r?.lastError ?? null, lastSync: r?.syncs[0] ? { status: r.syncs[0].status, rows: r.syncs[0].rows, at: r.syncs[0].startedAt } : null,
      };
    }).concat([{ provider: "crm" as any, name: "CRM", configured: false, id: null, status: "coming_soon", account: null, connectedAt: null, lastSyncAt: null, lastError: null, lastSync: null }]);
  }

  async startConnect(orgId: string, providerRaw: string, actor: Actor, ret: "portal" | "admin") {
    if (!isProvider(providerRaw)) throw new GmNotFound("Bilinmeyen entegrasyon");
    const org = await this.getOrg(orgId);
    if (org.isDemo) throw new Error("Demo organizasyona gerçek hesap bağlanamaz");
    if (!oauthConfigured(providerRaw)) throw new Error(`${PROVIDERS[providerRaw].name} bağlantısı sunucuda yapılandırılmamış (Google OAuth${providerRaw === "google_ads" ? " ve geliştirici belirteci" : ""} gerekli)`);
    if (!encryptionConfigured()) throw new Error("INTEGRATION_ENCRYPTION_KEY tanımlı değil; belirteçler güvenle saklanamaz");
    const state = sign("oauth", { org: orgId, provider: providerRaw, by: `${actor.kind}:${actor.id}`, ret, nonce: randomToken().slice(0, 16), exp: Math.floor(Date.now() / 1000) + 600 });
    return { url: authorizationUrl(providerRaw, state) };
  }

  // OAuth dönüşü: "state" imzası ve süresi doğrulanır, başlatan kişinin oturumu hâlâ geçerli olmalıdır.
  async handleCallback(code: string, stateRaw: string, actorMatches: (by: string, orgId: string) => Promise<boolean>) {
    const state = verify<{ org: string; provider: Provider; by: string; ret: "portal" | "admin" }>("oauth", stateRaw);
    if (!state || !isProvider(state.provider)) throw new GmForbidden("Bağlantı isteği geçersiz veya süresi dolmuş");
    if (!(await actorMatches(state.by, state.org))) throw new GmForbidden("Bağlantıyı başlatan oturum doğrulanamadı");
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) throw new Error("Google kalıcı erişim belirteci vermedi; bağlantıyı yeniden deneyin");
    const integration = await this.prisma.customerIntegration.upsert({
      where: { organizationId_provider: { organizationId: state.org, provider: state.provider } },
      create: { organizationId: state.org, provider: state.provider, status: "pending", encryptedCredentials: encryptSecret(tokens.refresh_token), scopes: tokens.scope || PROVIDERS[state.provider].scope, connectedBy: state.by, connectedAt: new Date() },
      update: { status: "pending", encryptedCredentials: encryptSecret(tokens.refresh_token), scopes: tokens.scope || PROVIDERS[state.provider].scope, connectedBy: state.by, connectedAt: new Date(), lastError: null, consecutiveFailures: 0, externalAccountId: null, displayName: null, updatedAt: new Date() },
    });
    const accounts = await listAccounts(state.provider, tokens.access_token).catch(() => []);
    if (accounts.length === 1) await this.selectAccount(state.org, integration.id, accounts[0].id, accounts);
    return { ret: state.ret, orgId: state.org, integrationId: integration.id, provider: state.provider, accounts: accounts.length };
  }

  private async integrationFor(orgId: string, integrationId: string) {
    const i = await this.prisma.customerIntegration.findFirst({ where: { id: integrationId, organizationId: orgId } });
    if (!i) throw new GmNotFound("Entegrasyon bulunamadı");
    return i;
  }
  private async accessToken(i: { encryptedCredentials: string | null }) {
    if (!i.encryptedCredentials) throw new Error("Entegrasyonun erişim yetkisi yok; yeniden bağlayın");
    return refreshAccess(decryptSecret(i.encryptedCredentials));
  }

  async accounts(orgId: string, integrationId: string) {
    const i = await this.integrationFor(orgId, integrationId);
    if (!isProvider(i.provider)) throw new Error("Bu entegrasyon hesap seçimi desteklemiyor");
    return listAccounts(i.provider, await this.accessToken(i));
  }

  async selectAccount(orgId: string, integrationId: string, accountId: string, known?: { id: string; name: string }[]) {
    const i = await this.integrationFor(orgId, integrationId);
    const list = known || (await this.accounts(orgId, integrationId));
    const account = list.find((a) => a.id === accountId);
    if (!account) throw new Error("Seçilen hesaba bu bağlantıyla erişilemiyor");
    await this.prisma.customerIntegration.update({ where: { id: i.id }, data: { externalAccountId: account.id, displayName: account.name.slice(0, 200), status: "connected", updatedAt: new Date() } });
    void this.syncIntegration(i.id).then(() => this.analyze(orgId)).catch((e) => this.log.warn(`İlk eşitleme başarısız: ${e.message}`));
    return { ok: true, account };
  }

  async disconnect(orgId: string, integrationId: string) {
    const i = await this.integrationFor(orgId, integrationId);
    if (i.encryptedCredentials) { try { await revokeToken(decryptSecret(i.encryptedCredentials)); } catch { /* belirteç zaten geçersiz olabilir */ } }
    // Veri saklama: bağlantı kaldırılınca o kaynaktan çekilen metrikler de silinir.
    await this.prisma.$transaction([
      this.prisma.metricDaily.deleteMany({ where: { organizationId: orgId, source: i.provider } }),
      this.prisma.customerIntegration.update({ where: { id: i.id }, data: { status: "disconnected", encryptedCredentials: null, externalAccountId: null, displayName: null, updatedAt: new Date() } }),
    ]);
    return { ok: true };
  }

  async syncIntegration(integrationId: string) {
    const i = await this.prisma.customerIntegration.findUnique({ where: { id: integrationId } });
    if (!i || i.status === "demo" || !i.externalAccountId || !isProvider(i.provider)) return { skipped: true };
    const lag = i.provider === "search_console" ? 3 : 1; // Search Console verisi ~2-3 gün gecikmelidir
    const end = addDays(today(), -lag);
    const sync = await this.prisma.integrationSync.create({ data: { integrationId, status: "running", rangeStart: dbDate(addDays(end, -55)), rangeEnd: dbDate(end) } });
    try {
      const rows = await fetchRows(i.provider, await this.accessToken(i), i.externalAccountId, end);
      await this.saveRows(i.organizationId, rows);
      await this.prisma.$transaction([
        this.prisma.integrationSync.update({ where: { id: sync.id }, data: { status: "success", rows: rows.length, finishedAt: new Date() } }),
        this.prisma.customerIntegration.update({ where: { id: i.id }, data: { lastSyncAt: new Date(), lastError: null, consecutiveFailures: 0, status: "connected", updatedAt: new Date() } }),
      ]);
      return { rows: rows.length };
    } catch (error: any) {
      const failures = i.consecutiveFailures + 1;
      await this.prisma.$transaction([
        this.prisma.integrationSync.update({ where: { id: sync.id }, data: { status: "failed", error: String(error.message).slice(0, 500), finishedAt: new Date() } }),
        this.prisma.customerIntegration.update({ where: { id: i.id }, data: { lastError: String(error.message).slice(0, 500), consecutiveFailures: failures, status: failures >= 3 ? "error" : i.status, updatedAt: new Date() } }),
      ]);
      throw error;
    }
  }

  async saveRows(orgId: string, rows: MetricRow[]) {
    for (let i = 0; i < rows.length; i += 400) {
      const chunk = rows.slice(i, i + 400), values: unknown[] = [];
      const tuples = chunk.map((r, j) => {
        values.push(orgId, r.source, r.date, r.dimensionType, r.dimensionKey.slice(0, 300), r.dimensionLabel?.slice(0, 300) ?? null, JSON.stringify(r.metrics));
        const b = j * 7;
        return `($${b + 1}::uuid,$${b + 2},$${b + 3}::date,$${b + 4},$${b + 5},$${b + 6},$${b + 7}::jsonb,now())`;
      });
      await this.prisma.$executeRawUnsafe(`INSERT INTO metric_daily(organization_id,source,date,dimension_type,dimension_key,dimension_label,metrics,updated_at) VALUES ${tuples.join(",")}
        ON CONFLICT(organization_id,source,date,dimension_type,dimension_key) DO UPDATE SET metrics=EXCLUDED.metrics, dimension_label=EXCLUDED.dimension_label, updated_at=now()`, ...values);
    }
  }

  async rows(orgId: string, days = 70): Promise<MetricRow[]> {
    const since = dbDate(addDays(today(), -days));
    const data = await this.prisma.metricDaily.findMany({ where: { organizationId: orgId, date: { gte: since } } });
    return data.map((r) => ({ source: r.source, date: isoDate(r.date), dimensionType: r.dimensionType, dimensionKey: r.dimensionKey, dimensionLabel: r.dimensionLabel, metrics: r.metrics as any }));
  }

  // =================== Analiz, içgörüler ve eylem önerileri ===================

  private async latestAuditFor(leadId: string | null) {
    if (!leadId) return null;
    const row = await this.prisma.growthAudit.findFirst({ where: { leadId, status: "completed" }, orderBy: { createdAt: "desc" }, select: { id: true } });
    return row ? this.audits.getAudit(row.id) : null;
  }

  async analyze(orgId: string) {
    const org = await this.getOrg(orgId);
    const rows = await this.rows(orgId);
    const audit = await this.latestAuditFor(org.leadId);
    const found = runDetectors(rows, { ...DEFAULT_CONFIG, currency: org.currency }, audit ? {
      id: audit.id, finishedAt: audit.finishedAt ? new Date(audit.finishedAt).toISOString() : undefined,
      opportunities: (audit.opportunities as any[]).filter((o) => o.status === "open" || o.status === "accepted").map((o) => ({ id: o.id, title: o.title, action: o.action, priorityGroup: o.priorityGroup, priorityScore: o.priorityScore, confidence: Number(o.confidence), service: o.service })),
    } : null);
    const existing = await this.prisma.aiInsight.findMany({ where: { organizationId: orgId } });
    const seen = new Set<string>();
    let created = 0, updated = 0;
    for (const f of found) {
      seen.add(f.fingerprint);
      const cur = existing.find((e) => e.fingerprint === f.fingerprint);
      const data = { kind: f.kind, detector: f.detector, category: f.category, severity: f.severity, title: f.title, explanation: f.explanation, evidence: f.evidence as any, assumptions: f.assumptions as any,
        confidence: f.confidence, estimatedImpact: (f.estimatedImpact ?? undefined) as any, suggestedAction: f.suggestedAction, priority: f.priority, periodStart: dbDate(f.periodStart), periodEnd: dbDate(f.periodEnd), updatedAt: new Date() };
      if (!cur) {
        const row = await this.prisma.aiInsight.create({ data: { organizationId: orgId, fingerprint: f.fingerprint, ...data } });
        await this.prisma.actionProposal.create({ data: { organizationId: orgId, insightId: row.id, actionType: "manual_task", title: f.title, description: f.suggestedAction, evidence: f.evidence as any } });
        created++;
      } else if (cur.status === "dismissed" && Date.now() - cur.updatedAt.getTime() < 14 * 86_400_000) {
        continue; // kullanıcı gizlediyse 14 gün tekrar gösterilmez
      } else {
        await this.prisma.aiInsight.update({ where: { id: cur.id }, data: { ...data, status: cur.status === "acknowledged" ? "acknowledged" : "open" } });
        updated++;
      }
    }
    // Koşulu artık görülmeyen açık içgörüler "geçerliliğini yitirdi" olur (veri varken).
    const expired = rows.length ? await this.prisma.aiInsight.updateMany({ where: { organizationId: orgId, status: { in: ["open", "acknowledged"] }, fingerprint: { notIn: [...seen] } }, data: { status: "expired", updatedAt: new Date() } }) : { count: 0 };
    return { detectorVersion: DETECTOR_VERSION, found: found.length, created, updated, expired: expired.count };
  }

  async generateBrief(orgId: string, force = false) {
    const org = await this.getOrg(orgId), date = today();
    const existing = await this.prisma.dailyBrief.findUnique({ where: { organizationId_briefDate: { organizationId: orgId, briefDate: dbDate(date) } } });
    if (existing && !force) return existing;
    const [rows, insights] = await Promise.all([this.rows(orgId), this.prisma.aiInsight.findMany({ where: { organizationId: orgId, status: { in: ["open", "acknowledged"] } } })]);
    const connected = org.integrations.filter((i) => i.status === "connected" || i.status === "demo").map((i) => i.provider);
    const content = buildBrief({ date, rows, insights: insights.map(toInsight), currency: org.currency, demo: org.isDemo, connectedSources: connected });
    const ai = await aiHealthSummary(content, org.name).catch(() => null);
    if (ai) content.health.summary = ai.summary;
    const data = { content: content as any, source: ai ? "ai" : "rules", model: ai?.usage?.model ?? null, usage: (ai?.usage ? { ai: ai.usage } : {}) as any };
    return this.prisma.dailyBrief.upsert({ where: { organizationId_briefDate: { organizationId: orgId, briefDate: dbDate(date) } }, create: { organizationId: orgId, briefDate: dbDate(date), ...data }, update: data });
  }

  // =================== Portal okuma uçları (her sorgu organizationId ile sınırlıdır) ===================

  async overview(orgId: string) {
    const org = await this.getOrg(orgId);
    const rows = await this.rows(orgId, 40);
    const { kpis, dataThrough } = computeKpis(rows);
    const series: Record<string, { date: string; value: number }[]> = {};
    const add = (key: string, source: string, metric: string) => {
      const end = latestDate(rows, source); if (!end) return;
      const w = windowEnding(end, 28);
      series[key] = rows.filter((r) => r.source === source && r.dimensionType === "account" && r.date >= w.start && r.date <= w.end).sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ date: r.date, value: Number(r.metrics[metric]) || 0 }));
    };
    add("adsCost", "google_ads", "cost"); add("adsConversions", "google_ads", "conversions"); add("sessions", "ga4", "sessions"); add("keyEvents", "ga4", "keyEvents"); add("organicClicks", "search_console", "clicks");
    const alerts = await this.prisma.aiInsight.findMany({ where: { organizationId: orgId, status: "open", severity: "critical" }, orderBy: { priority: "desc" }, take: 5 });
    const counts = await this.prisma.aiInsight.groupBy({ by: ["kind", "severity"], where: { organizationId: orgId, status: { in: ["open", "acknowledged"] } }, _count: true });
    return {
      org: { id: org.id, name: org.name, isDemo: org.isDemo, currency: org.currency }, dataThrough, kpis, series,
      alerts: alerts.map(publicInsight), counts: counts.map((c) => ({ kind: c.kind, severity: c.severity, count: c._count })),
      growthScore: await this.growthScore(org.leadId), integrations: await this.integrations(orgId),
    };
  }

  private async growthScore(leadId: string | null) {
    if (!leadId) return null;
    const history = await this.prisma.growthAudit.findMany({ where: { leadId, status: "completed" }, orderBy: { createdAt: "asc" }, select: { id: true, overallScore: true, coverage: true, finishedAt: true, categoryScores: true } });
    const last = history[history.length - 1];
    return last ? { score: last.overallScore == null ? null : Number(last.overallScore), coverage: Number(last.coverage), date: last.finishedAt, categories: last.categoryScores, history: history.map((h) => ({ date: h.finishedAt, score: h.overallScore == null ? null : Number(h.overallScore) })) } : null;
  }

  async insights(orgId: string) {
    const rows = await this.prisma.aiInsight.findMany({ where: { organizationId: orgId, status: { not: "expired" } }, orderBy: [{ priority: "desc" }, { detectedAt: "desc" }], take: 100 });
    return rows.map(publicInsight);
  }

  async setInsightStatus(orgId: string, id: string, status: string) {
    if (!["open", "acknowledged", "resolved", "dismissed"].includes(status)) throw new Error("Geçersiz durum");
    const r = await this.prisma.aiInsight.updateMany({ where: { id, organizationId: orgId }, data: { status, updatedAt: new Date() } });
    if (!r.count) throw new GmNotFound("İçgörü bulunamadı");
    return { ok: true };
  }

  async briefs(orgId: string) {
    const list = await this.prisma.dailyBrief.findMany({ where: { organizationId: orgId }, orderBy: { briefDate: "desc" }, take: 30 });
    return { latest: list[0] ? { ...list[0], briefDate: isoDate(list[0].briefDate) } : null, history: list.map((b) => ({ id: b.id, date: isoDate(b.briefDate), status: (b.content as any)?.health?.status })) };
  }

  async auditView(orgId: string) {
    const org = await this.getOrg(orgId);
    if (!org.leadId) return { linked: false };
    const audit = await this.latestAuditFor(org.leadId);
    const lead = await getOne("leads", org.leadId);
    if (!audit || !lead) return { linked: true, report: null, history: [] };
    const report = buildReport(audit, { name: org.name, sector: lead.sector, city: lead.city, district: lead.district, website: lead.website });
    const completed = (audit.opportunities as any[]).filter((o) => o.status === "done").map((o) => ({ title: o.title.replace(/ iyileştirilmeli$/, ""), action: o.action }));
    return { linked: true, report, completed, history: (await this.growthScore(org.leadId))?.history || [] };
  }

  async actions(orgId: string) {
    return this.prisma.actionProposal.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  // V1: onay yalnızca kayıt altına alınır; dış hesaplarda değişiklik yapılmaz. Yürütme ekibin manuel işidir.
  async decideAction(orgId: string, id: string, decision: string, note: string, by: string) {
    if (!["approve", "reject"].includes(decision)) throw new Error("Geçersiz karar");
    const r = await this.prisma.actionProposal.updateMany({
      where: { id, organizationId: orgId, status: "proposed" },
      data: { status: decision === "approve" ? "approved" : "rejected", decidedBy: by.slice(0, 160), decidedAt: new Date(), decisionNote: note.slice(0, 1000) || null, executionResult: decision === "approve" ? ({ mode: "manual", note: "Dış sistemde otomatik değişiklik yapılmadı; Istanbul Marketing ekibi uygulayacak." } as any) : undefined },
    });
    if (!r.count) throw new GmNotFound("Bekleyen öneri bulunamadı");
    return { ok: true };
  }

  // =================== Zamanlanmış işler ===================

  async dueIntegrations() {
    return this.prisma.customerIntegration.findMany({ where: { status: "connected", externalAccountId: { not: null }, OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: new Date(Date.now() - 6 * 3_600_000) } }], organization: { status: "active" } }, select: { id: true, organizationId: true } });
  }
  async orgsNeedingBrief() {
    const orgs = await this.prisma.customerOrganization.findMany({ where: { status: "active" }, select: { id: true } });
    const done = await this.prisma.dailyBrief.findMany({ where: { briefDate: dbDate(today()) }, select: { organizationId: true } });
    return orgs.filter((o) => !done.some((d) => d.organizationId === o.id)).map((o) => o.id);
  }
}

function toInsight(r: any): StoredInsight {
  return { id: r.id, status: r.status, kind: r.kind, detector: r.detector, category: r.category, severity: r.severity, title: r.title, explanation: r.explanation, evidence: r.evidence, assumptions: r.assumptions,
    confidence: Number(r.confidence), estimatedImpact: r.estimatedImpact, suggestedAction: r.suggestedAction, fingerprint: r.fingerprint, periodStart: isoDate(r.periodStart), periodEnd: isoDate(r.periodEnd), priority: r.priority } as StoredInsight;
}
export function publicInsight(r: any) {
  const { organizationId, fingerprint, ...rest } = r;
  return { ...rest, confidence: Number(r.confidence), periodStart: isoDate(r.periodStart), periodEnd: isoDate(r.periodEnd) };
}
export type { Insight };
