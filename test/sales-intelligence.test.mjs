// Milestone 2 (satış zekâsı) testleri: rapor güvenliği, PDF, e-posta taslağı, arama brifi, fırsat durumu.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const load = (p) => import(`../.test-build/modules/${p}.js`).then((m) => m.default ?? m);
const reportModel = await load("sales/report.model");
const reportHtml = await load("sales/report.html");
const reportPdf = await load("sales/report.pdf");
const salesAi = await load("sales/sales-ai");
const salesSvc = await load("sales/sales.service");
const salesCtrl = await load("sales/sales.controller");
const auditSvc = await load("audit/audit.service");
const aiClient = await load("audit/ai-client");

const opp = (id, metricId, extra = {}) => ({
  id, metricIds: [metricId], title: `${metricId} iyileştirilmeli`, problem: "sorun", action: "öneri", service: "SEO", priorityScore: 40, priorityGroup: "high",
  impact: "high", difficulty: "easy", basis: "observed", confidence: 0.9, status: "open", evidence: [{ source: "https://ornek.com/", observation: "robots.txt bulunamadı (HTTP 404)" }], ...extra,
});
const audit = (over = {}) => ({
  id: "a1", leadId: "ornek", status: "completed", scoringVersion: "gs-1.0", overallScore: 62.4, coverage: 0.8, confidence: 0.7, finalUrl: "https://ornek.com/",
  finishedAt: "2026-10-13T10:00:00Z", createdAt: "2026-10-13T09:59:00Z", summary: null,
  categoryScores: [{ id: "search", name: "Arama ve Bulunabilirlik", weight: 20, score: 55, coverage: 1 }, { id: "trust", name: "Güven ve Otorite", weight: 10, score: 40, coverage: 1 }],
  metrics: [
    { metricId: "seo_titles", category: "search", state: "MEASURED", finalScore: 90, evidence: [{ source: "https://ornek.com/", observation: "başlık iyi" }], recommendation: null },
    { metricId: "seo_sitemap_robots", category: "search", state: "MEASURED", finalScore: 50, evidence: [{ source: "robots.txt", observation: "robots.txt bulunamadı" }], recommendation: "robots ekleyin", reviewReason: "İÇ NOT: satış ekibi" },
    { metricId: "brand_value_proposition", category: "brand", state: "UNKNOWN", finalScore: null, evidence: [], recommendation: null },
  ],
  opportunities: [
    opp("o1", "seo_sitemap_robots", { difficulty: "easy" }),
    opp("o2", "conv_tracking_readiness", { difficulty: "medium", service: "Google Ads", evidence: [{ source: "site", observation: "Tespit edilen etiketler: Universal Analytics (eski)" }] }),
    opp("o3", "tech_core_web_vitals", { difficulty: "hard", service: "Web sitesi" }),
    opp("o4", "trust_signals", { status: "dismissed" }),
  ],
  ...over,
});
const lead = { id: "ornek", name: "Örnek <Klinik>", sector: "Diş kliniği", city: "İstanbul", district: "Kadıköy", website: "ornek.com", email: "info@ornek.com", status: "yeni", score: 88, notes: "GİZLİ SATIŞ NOTU", callNote: "sekreter sert", contactName: "Ayşe Yılmaz" };

describe("Müşteri raporu modeli", () => {
  const r = reportModel.buildReport(audit(), lead);
  it("iç satış bilgilerini içermez", () => {
    const json = JSON.stringify(r);
    for (const secret of ["GİZLİ SATIŞ NOTU", "sekreter sert", "İÇ NOT", "Ayşe", "88", "info@ornek.com"]) assert.ok(!json.includes(secret), secret);
  });
  it("gizlenen fırsatı çıkarır, 30/60/90 planı zorluğa göre böler", () => {
    assert.deepEqual(r.opportunities.map((o) => o.title), ["seo_sitemap_robots iyileştirilmeli", "conv_tracking_readiness iyileştirilmeli", "tech_core_web_vitals iyileştirilmeli"]);
    assert.deepEqual(r.roadmap.map((p) => p.items.length), [1, 1, 1]);
    assert.equal(r.roadmap[0].phase, "İlk 30 gün");
  });
  it("yalnızca kanıtlı ve 70 altı metrikleri bulgu, 80+ olanları güçlü yön sayar; eksik veriyi açıklar", () => {
    assert.deepEqual(r.findings.map((f) => f.score), [50]);
    assert.deepEqual(r.strengths.map((s) => s.score), [90]);
    assert.ok(r.limitations[0].includes("1 metrik"));
  });
  it("hizmet önerilerini fırsatlardan türetir", () => {
    assert.deepEqual(r.services.map((s) => s.name).sort(), ["Google Ads", "SEO", "Web sitesi"]);
  });
});

describe("Rapor çıktıları", () => {
  const r = reportModel.buildReport(audit(), lead);
  it("HTML tüm dinamik değerleri kaçışlar ve arama motoruna kapalıdır", () => {
    const html = reportHtml.renderReportHtml(r, { pdfHref: "/r/x/pdf" });
    assert.ok(html.includes("Örnek &lt;Klinik&gt;"));
    assert.ok(!html.includes("<Klinik>"));
    assert.ok(html.includes('content="noindex, nofollow"'));
  });
  it("PDF üretir (Türkçe yazı tipi gömülü)", async () => {
    const buf = await reportPdf.renderReportPdf(r);
    assert.equal(buf.subarray(0, 4).toString(), "%PDF");
    assert.ok(buf.length > 10_000);
    assert.ok(buf.includes("PlusJakartaSans"));
  });
});

describe("Rapor bağlantısı güvenliği", () => {
  const fakePrisma = (link) => ({ auditReport: { findUnique: async () => link, update: async () => link } });
  const svc = (link) => { const s = new salesSvc.SalesService(fakePrisma(link), {}); s.reportFor = async () => ({ ok: true }); return s; };
  const token = "A".repeat(43);
  it("belirteç yalnızca özetiyle eşleşir", () => {
    assert.equal(salesSvc.hashToken(token).length, 64);
    assert.notEqual(salesSvc.hashToken(token), token);
  });
  it("geçerli bağlantı raporu döndürür", async () => {
    assert.deepEqual(await svc({ id: "1", auditId: "a", revokedAt: null, expiresAt: new Date(Date.now() + 60_000) }).resolve(token, true), { ok: true });
  });
  it("süresi dolmuş, iptal edilmiş veya biçimi bozuk belirteç reddedilir", async () => {
    assert.equal(await svc({ id: "1", auditId: "a", revokedAt: null, expiresAt: new Date(Date.now() - 1) }).resolve(token, true), null);
    assert.equal(await svc({ id: "1", auditId: "a", revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }).resolve(token, true), null);
    assert.equal(await svc(null).resolve(token, true), null);
    assert.equal(await svc({}).resolve("../../etc", true), null);
  });
  it("herkese açık uç hız sınırı uygular", () => {
    const ip = `test-${Date.now()}`;
    for (let i = 0; i < 30; i++) assert.equal(salesCtrl.rateLimited(ip, 30), false);
    assert.equal(salesCtrl.rateLimited(ip, 30), true);
  });
  it("oturum olmadan iç uçlar 401 döner", async () => {
    const ctrl = new salesCtrl.SalesController({ createLink: async () => { throw new Error("çağrılmamalı"); } });
    const res = { code: 0, status(c) { this.code = c; return this; }, json() { return this; } };
    await ctrl.createLink("00000000-0000-0000-0000-000000000000", {}, { headers: {} }, res);
    assert.equal(res.code, 401);
  });
});

describe("Kişiselleştirilmiş e-posta", () => {
  const a = audit(), f = salesAi.findingsOf(a);
  it("yalnızca kanıtlı, gizlenmemiş fırsatları kullanır; ölçülmüş bulgular önce gelir", () => {
    assert.ok(!f.some((x) => x.id === "o4"));
    assert.ok(f.every((x) => x.source));
  });
  it("şablon taslak 2-3 gözlem, görüşme daveti içerir ve yasak iddia içermez", () => {
    const d = salesAi.templateEmail(lead, a, f);
    assert.ok(d.observations.length >= 2 && d.observations.length <= 3);
    assert.ok(/15 dakikalık bir görüşme/.test(d.body));
    assert.equal(aiClient.findBannedClaim(d.subject + d.body), null);
    assert.ok(d.body.startsWith("Merhaba Ayşe,"));
  });
  it("site haritası cümlesi kanıta göre kurulur (site haritası varsa 'yok' demez)", () => {
    const only = salesAi.findingsOf(audit({ opportunities: [opp("x", "seo_sitemap_robots", { evidence: [{ source: "robots.txt", observation: "robots.txt bulunamadı (HTTP 404)" }, { source: "https://ornek.com/sitemap.xml", observation: "Site haritasında 18 URL" }] })] }));
    assert.ok(/robots\.txt dosyası bulunmuyor/.test(only[0].text));
    assert.ok(!/site haritası bulunmuyor/i.test(only[0].text));
  });
  it("AI çıktısında doğrulanmamış bulgu veya garanti iddiası reddedilir", () => {
    const base = { subject: "Konu metni", greeting: "Merhaba", intro: "Sitenizi inceledik ve not aldık.", valueProposition: "Birlikte çalışabiliriz diye düşünüyoruz.", meetingInvite: "15 dakikalık görüşme uygun mu?" };
    assert.equal(salesAi.validateEmail({ ...base, observations: [{ findingId: "o1", text: "robots.txt yok, eklenmeli." }, { findingId: "o2", text: "GA4 etiketi görünmüyor." }] }, f), null);
    assert.match(salesAi.validateEmail({ ...base, observations: [{ findingId: "uydurma", text: "rakipleriniz önde" }, { findingId: "o1", text: "robots.txt yok" }] }, f), /doğrulanmış bulgulara/);
    assert.match(salesAi.validateEmail({ ...base, intro: "Satışlarınızı garanti ediyoruz.", observations: [{ findingId: "o1", text: "robots.txt yok, eklenmeli." }, { findingId: "o2", text: "GA4 etiketi görünmüyor." }] }, f), /Doğrulanamayan/);
  });
  it("AI yapılandırılmamışsa şablona düşer ve hiçbir şey göndermez", async () => {
    const saved = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    const g = await salesAi.generateEmail(lead, a);
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
    assert.equal(g.source, "template");
    assert.ok(g.content.subject && g.content.body);
  });
  it("yasak iddia listesi tipik spam/abartı ifadelerini yakalar", () => {
    for (const t of ["%100 sonuç", "Ciro kaybediyorsunuz", "son fırsat", "sektör ortalamasının altında", "3 kat artış"]) assert.ok(aiClient.findBannedClaim(t), t);
    assert.equal(aiClient.findBannedClaim("Sitenizde GA4 etiketi görünmüyor."), null);
  });
});

describe("Arama brifi", () => {
  it("skor özeti, en fazla 3 doğrulanmış sorun, geçmiş ve aşamaya göre sonraki adım içerir", () => {
    const a = audit(), b = salesAi.templateCallBrief({ ...lead, status: "iletisim", seq: { log: [{ date: "2026-10-01", label: "İlk mail gönderildi" }] }, callLog: [{ at: "2026-10-02T10:00:00Z", r: "sekreter" }] }, a, salesAi.findingsOf(a));
    assert.match(b.scoreSummary, /62\/100/);
    assert.match(b.scoreSummary, /Güven ve Otorite \(40\)/);
    assert.ok(b.topIssues.length <= 3 && b.topIssues.length > 0);
    assert.match(b.historySummary, /İlk mail gönderildi/);
    assert.match(b.historySummary, /sekreter yönlendirdi/);
    assert.match(b.nextAction, /Önceki e-postaya/);
    assert.match(b.opening, /Ayşe Yılmaz ile görüşebilir miyim/);
  });
  it("puanı olmayan denetimde puan uydurmaz", () => {
    const b = salesAi.templateCallBrief(lead, audit({ overallScore: null, opportunities: [] }), []);
    assert.match(b.scoreSummary, /hesaplanamadı/);
  });
});

describe("Fırsat durumu", () => {
  it("geçersiz durumu reddeder, geçerli durumu kaydeder", async () => {
    const calls = [];
    const s = new auditSvc.AuditService({ growthOpportunity: { updateMany: async (q) => { calls.push(q); return { count: 1 }; } } });
    await assert.rejects(s.setOpportunityStatus("id", "silindi"), /Geçersiz durum/);
    assert.deepEqual(await s.setOpportunityStatus("id", "done"), { ok: true, id: "id", status: "done" });
    assert.equal(calls[0].data.status, "done");
  });
});
