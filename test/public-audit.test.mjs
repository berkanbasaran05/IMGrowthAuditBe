// Ücretsiz dijital analiz (herkese açık form) testleri: doğrulama, firma birleştirme, controller, CORS, hız sınırı.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const load = (p) => import(`../.test-build/modules/${p}.js`).then((m) => m.default ?? m);
const svc = await load("audit/public-audit.service");
const ctrl = await load("audit/public-audit.controller");
const aiClient = await load("audit/ai-client");

const valid = { websiteUrl: "ornekklinik.com", name: "Ayşe Yılmaz", email: "AYSE@ornek.com", phone: "", company: "Örnek Klinik", source: "instagram", locale: "tr", website_hp: "", consent: true };
const fakeRes = () => ({ code: 0, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set(h) { Object.assign(this.headers, h); return this; }, end() { return this; } });
const fakeReq = (over = {}) => ({ headers: { origin: "https://istanbul.marketing" }, ip: `10.0.0.${Math.floor(Math.random() * 250)}`, ...over });

describe("Herkese açık form doğrulaması", () => {
  it("geçerli girdiyi temizler", () => {
    const r = svc.validatePublicAuditInput(valid);
    assert.equal(r.ok, true);
    assert.equal(r.data.websiteUrl, "https://ornekklinik.com/");
    assert.equal(r.data.email, "ayse@ornek.com");
    assert.equal(r.data.source, "instagram");
  });
  it("bal küpü, onay, iletişim ve URL kurallarını uygular", () => {
    const code = (over) => svc.validatePublicAuditInput({ ...valid, ...over }).code;
    assert.equal(code({ website_hp: "bot" }), "spam");
    assert.equal(code({ consent: undefined }), "consent_required");
    assert.equal(code({ consent: "true" }), "consent_required");
    assert.equal(svc.validatePublicAuditInput({ websiteUrl: "ornek.com", consent: true }).ok, true); // yalnızca URL yeterli
    assert.equal(code({ email: "yanlis" }), "invalid_email");
    assert.equal(code({ email: "", phone: "abc" }), "invalid_phone");
    assert.equal(code({ websiteUrl: "javascript:alert(1)" }), "invalid_url");
    assert.equal(code({ websiteUrl: "localhost" }), "invalid_url");
  });
  it("İngilizce mesaj döner, bilinmeyen kaynak 'web' sayılır", () => {
    const r = svc.validatePublicAuditInput({ ...valid, locale: "en", consent: false });
    assert.equal(svc.publicMessage(r.code, r.locale), "Please accept the privacy notice.");
    assert.equal(svc.validatePublicAuditInput({ ...valid, source: "x" }).data.source, "web");
  });
});

describe("Firma kaydı birleştirme", () => {
  const input = svc.validatePublicAuditInput({ ...valid, phone: "0532 000 00 00", message: "Teklif istiyorum" }).data;
  it("yeni kayıt: durum yeni, gelen talep alanları dolu", () => {
    const l = svc.mergeInbound(null, input, "ornekklinik.com", new Date("2026-10-14T10:00:00Z"));
    assert.equal(l.status, "yeni");
    assert.equal(l.name, "Örnek Klinik");
    assert.equal(l.contactName, "Ayşe Yılmaz");
    assert.equal(l.inbound, true);
    assert.equal(l.inboundSource, "instagram");
    assert.equal(l.inboundMessage, "Teklif istiyorum");
    assert.equal(l.inboundHistory.length, 1);
  });
  it("var olan kayıtta ekibin alanlarını ezmez, geçmişe ekler", () => {
    const cur = { name: "Eski Ad", status: "gorusuldu", email: "ekip@ornek.com", notes: "not", inboundHistory: [{ at: "x" }] };
    const l = svc.mergeInbound(cur, input, "ornekklinik.com");
    assert.equal(l.name, "Eski Ad");
    assert.equal(l.status, "gorusuldu");
    assert.equal(l.email, "ekip@ornek.com");
    assert.equal(l.phone, "0532 000 00 00");
    assert.equal(l.notes, "not");
    assert.equal(l.inboundHistory.length, 2);
  });
  it("alan adı karşılaştırması www ve şemadan bağımsızdır", () => {
    assert.equal(svc.domainOf("http://www.OrnekKlinik.com/iletisim"), "ornekklinik.com");
    const only = svc.validatePublicAuditInput({ websiteUrl: "ornek.com", consent: true }).data;
    const l = svc.mergeInbound(null, only, "ornek.com");
    assert.equal(l.name, "ornek.com"); assert.equal(l.inbound, true); assert.ok(!("contactName" in l) && !("email" in l));
    assert.equal(svc.slug("Örnek Diş Kliniği"), "ornek-dis-klinigi");
  });
  it("rapor belirteci sorgu belirtecinden kararlı türetilir ve rapor biçimine uyar", () => {
    const t = "a".repeat(43);
    assert.equal(svc.reportTokenFor(t), svc.reportTokenFor(t));
    assert.notEqual(svc.reportTokenFor(t), svc.reportTokenFor("b".repeat(43)));
    assert.match(svc.reportTokenFor(t), /^[A-Za-z0-9_-]{40,64}$/);
  });
});

describe("Herkese açık controller", () => {
  process.env.PUBLIC_AUDIT_ORIGINS = "https://istanbul.marketing, http://localhost:3000";
  it("izinli kökene CORS başlığı verir, diğerine vermez", () => {
    const a = fakeRes(); ctrl.applyCors(fakeReq(), a);
    assert.equal(a.headers["Access-Control-Allow-Origin"], "https://istanbul.marketing");
    const b = fakeRes(); ctrl.applyCors(fakeReq({ headers: { origin: "https://kotu.example" } }), b);
    assert.equal(b.headers["Access-Control-Allow-Origin"], undefined);
  });
  it("geçersiz gövdede 400 döner ve servisi çağırmaz", async () => {
    const c = new ctrl.PublicAuditController({ submit: async () => { throw new Error("çağrılmamalı"); } });
    const res = fakeRes();
    await c.start({ ...valid, consent: false }, fakeReq(), res);
    assert.equal(res.code, 400);
    assert.equal(res.body.code, "consent_required");
  });
  it("geçerli istekte 202 ve yalnızca belirteç döner", async () => {
    const c = new ctrl.PublicAuditController({ submit: async () => ({ token: "t".repeat(43), leadId: "gizli-firma", isNew: true }) });
    const res = fakeRes();
    await c.start(valid, fakeReq(), res);
    assert.equal(res.code, 202);
    assert.deepEqual(res.body, { token: "t".repeat(43) });
  });
  it("büyük gövdeyi 413 ile reddeder", async () => {
    const c = new ctrl.PublicAuditController({});
    const res = fakeRes();
    await c.start(valid, fakeReq({ headers: { "content-length": "50000" } }), res);
    assert.equal(res.code, 413);
  });
  it("IP başına saatte 5 başlatmaya izin verir", async () => {
    const c = new ctrl.PublicAuditController({ submit: async () => ({ token: "x".repeat(43) }) });
    const req = fakeReq({ ip: "203.0.113.77" });
    const codes = [];
    for (let i = 0; i < 6; i++) { const res = fakeRes(); await c.start(valid, req, res); codes.push(res.code); }
    assert.deepEqual(codes, [202, 202, 202, 429, 429, 429]);
  });
  it("bilinmeyen belirteçte 404 döner", async () => {
    const c = new ctrl.PublicAuditController({ poll: async () => null });
    const res = fakeRes();
    await c.poll("yok", fakeReq(), res);
    assert.equal(res.code, 404);
  });
});

describe("Sorgu yanıtı", () => {
  const token = "p".repeat(43);
  const prisma = (audit, req = {}) => ({
    publicAuditRequest: { findUnique: async () => ({ id: "r1", auditId: "a1", reportId: null, locale: "tr", ...req }), update: async () => ({}) },
    growthAudit: { findUnique: async () => audit },
    auditReport: { create: async (q) => { prisma.created = q.data; return { id: "l1" }; } },
  });
  it("tamamlanmış denetimde puan, kategori, en fazla 3 fırsat ve rapor bağlantısı döner; iç alanları döndürmez", async () => {
    const p = prisma({
      id: "a1", leadId: "ornek", status: "completed", overallScore: "62.4", progress: 100, stage: null,
      categoryScores: [{ id: "search", name: "Arama ve Bulunabilirlik", score: 55.2 }],
      summary: { headline: "Başlık", narrative: "Anlatı" },
      opportunities: [{ metricIds: ["seo_sitemap_robots"], title: "SEO iyileştirilmeli", problem: "robots.txt yok", service: "SEO", priorityScore: 40, confidence: 0.9 }],
    });
    const out = await new svc.PublicAuditService(p, {}).poll(token, "https://panel.example");
    assert.equal(out.status, "completed");
    assert.equal(out.result.overallScore, 62);
    assert.deepEqual(out.result.categories, [{ key: "search", label: "Google'da bulunma", score: 55 }]);
    assert.equal(out.result.summary, "Başlık\n\nAnlatı");
    assert.deepEqual(out.result.topOpportunities, [{ title: "Google'a sitenizi tanıtan dosyalar eksik", why: "Bu dosyalar Google'ın tüm sayfalarınızı bulmasını hızlandırır.", recommendedService: "SEO" }]);
    assert.equal(out.result.grade, "Geliştirilebilir");
    assert.equal(out.result.reportUrl, `https://panel.example/r/${svc.reportTokenFor(token)}`);
    assert.ok(!JSON.stringify(out).includes("priorityScore"));
  });
  it("devam eden ve web sitesi doğrulanamayan durumları sade döner", async () => {
    const run = await new svc.PublicAuditService(prisma({ status: "running", progress: 40, stage: "Tarama" }), {}).poll(token, "");
    assert.deepEqual(run, { status: "processing", progress: 40, stage: "Tarama" });
    const nw = await new svc.PublicAuditService(prisma({ status: "no_verified_website", opportunities: [] }), {}).poll(token, "");
    assert.equal(nw.status, "no_website");
    assert.equal(await new svc.PublicAuditService(prisma(null), {}).poll("kisa", ""), null);
  });
});

describe("AI modeli", () => {
  it("varsayılan model Claude Haiku 5.5; sunucu yedeği yalnızca destekleyen modellerde", () => {
    if (!process.env.AUDIT_AI_MODEL) assert.equal(aiClient.AI_MODEL, "claude-haiku-5-5");
    assert.equal(aiClient.supportsServerFallback("claude-haiku-5-5"), false);
    assert.equal(aiClient.supportsServerFallback("claude-opus-5-5"), true);
  });
});
