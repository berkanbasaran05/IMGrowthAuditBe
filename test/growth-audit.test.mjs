// Growth Audit™ birim ve entegrasyon testleri: `npm test` (derlenmiş kod .test-build/ altından okunur).
import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import pg from "pg";

const load = (p) => import(`../.test-build/modules/audit/${p}.js`).then((m) => m.default ?? m);
const scoring = await load("scoring");
const metrics = await load("metrics");
const analyst = await load("ai-analyst");
const opp = await load("opportunities");
const safe = await load("safe-fetch");
const robots = await load("robots");
const extract = await load("extract");
const runner = await load("audit.runner");
const service = await load("audit.service");
const types = await load("audit.types");

const m = (metricId, category, state, score, extra = {}) => ({ metricId, category, weight: 1, method: "deterministic", state, score, confidence: 0.8, evidence: [{ source: "https://ornek.com/", observation: "gözlem" }], reason: "neden", recommendation: "öneri", ...extra });

describe("Growth Score hesaplaması", () => {
  it("UNKNOWN metrikleri sıfır saymaz, değerlendirilen ağırlık üzerinden normalize eder", () => {
    const r = scoring.computeGrowthScore([m("a", "search", "MEASURED", 80), m("b", "search", "UNKNOWN", null)]);
    const search = r.categories.find((c) => c.id === "search");
    assert.equal(search.score, 80);
    assert.equal(search.coverage, 0.5);
    assert.equal(r.overall, 80);
  });

  it("NOT_APPLICABLE metrikler kapsam paydasına girmez", () => {
    const r = scoring.computeGrowthScore([m("a", "trust", "MEASURED", 60), m("b", "trust", "NOT_APPLICABLE", null)]);
    const trust = r.categories.find((c) => c.id === "trust");
    assert.equal(trust.coverage, 1);
    assert.equal(trust.applicable, 1);
  });

  it("kategori ağırlıklarını uygular (Arama %20, Güven %10)", () => {
    const r = scoring.computeGrowthScore([m("a", "search", "MEASURED", 100), m("b", "trust", "MEASURED", 40)]);
    assert.equal(r.overall, 80); // (20*100 + 10*40) / 30
  });

  it("kategori ağırlıklarının toplamı 100", () => {
    assert.equal(types.CATEGORIES.reduce((s, c) => s + c.weight, 0), 100);
  });

  it("FAILED metrik puana girmez ama kapsamı düşürür", () => {
    const r = scoring.computeGrowthScore([m("a", "brand", "MEASURED", 90), m("b", "brand", "FAILED", null)]);
    const brand = r.categories.find((c) => c.id === "brand");
    assert.equal(brand.score, 90);
    assert.equal(brand.coverage, 0.5);
  });

  it("inceleme puanı özgün puanın önüne geçer ve tam güvenle sayılır", () => {
    const r = scoring.computeGrowthScore([m("a", "experience", "ESTIMATED", 30, { reviewerScore: 70, confidence: 0.4 })]);
    const exp = r.categories.find((c) => c.id === "experience");
    assert.equal(exp.score, 70);
    assert.equal(exp.confidence, 1);
  });

  it("güven kapsamla birlikte düşer", () => {
    const full = scoring.computeGrowthScore([m("a", "search", "MEASURED", 80)]);
    const half = scoring.computeGrowthScore([m("a", "search", "MEASURED", 80), m("b", "search", "UNKNOWN", null)]);
    assert.ok(half.confidence < full.confidence);
  });
});

describe("Web sitesi olmayan firma", () => {
  it("doğrulanmış site yoksa NO_VERIFIED_WEBSITE döner, puan uydurmaz", async () => {
    const out = await runner.runAudit({ id: "x", name: "Örnek Klinik", website: "" }, async () => {});
    assert.equal(out.status, "no_verified_website");
    assert.equal(out.score.overall, null);
    assert.equal(out.score.coverage, 0);
    assert.ok(out.metrics.every((x) => x.state === "UNKNOWN" && x.score == null));
    assert.equal(out.opportunities.length, 0);
  });

  it("geçersiz adres de site yok sayılır", async () => {
    const out = await runner.runAudit({ id: "x", name: "Örnek", website: "javascript:alert(1)" }, async () => {});
    assert.equal(out.status, "no_verified_website");
  });
});

describe("Metrik kataloğu", () => {
  it("yaklaşık 30 metrik, benzersiz kimlik, her metrikte rubrik", () => {
    const ids = metrics.METRICS.map((x) => x.id);
    assert.ok(ids.length >= 30 && ids.length <= 36, `metrik sayısı ${ids.length}`);
    assert.equal(new Set(ids).size, ids.length);
    for (const def of metrics.METRICS) {
      assert.ok(def.rubric.length > 10, def.id);
      assert.ok(def.method === "ai" || typeof def.evaluate === "function", `${def.id} değerlendirme yöntemi`);
    }
    for (const c of types.CATEGORIES) assert.ok(metrics.METRICS.filter((x) => x.category === c.id).length >= 5, c.id);
  });

  it("AI metrikleri teknik ölçüm içermez", () => {
    for (const def of metrics.AI_METRICS) assert.ok(!["technology"].includes(def.category), def.id);
  });
});

describe("AI analist çıktı doğrulaması", () => {
  const urls = ["https://ornek.com/", "https://ornek.com/iletisim"];
  const base = (over = {}) => ({
    metrics: metrics.AI_METRICS.map((d) => ({ metricId: d.id, assessable: true, score: 60, confidence: 0.95, evidence: [{ source: "https://ornek.com/", observation: "Ana sayfada hedef kitle belirtilmemiş" }], reason: "Gerekçe metni", recommendation: "Öneri", ...over })),
    summary: { headline: "Özet", strengths: [], weaknesses: [], narrative: "Anlatım" },
  });

  it("şemaya uyan çıktı kabul edilir; güven 0.9 ile sınırlanır", () => {
    const parsed = analyst.AnalystOutput.parse(base());
    const results = analyst.toMetricResults(parsed, urls, "test-model");
    assert.ok(results.every((r) => r.state === "ESTIMATED" && r.score === 60 && r.confidence === 0.9 && r.modelVersion === "test-model"));
  });

  it("aralık dışı puan şema doğrulamasından geçmez", () => {
    assert.equal(analyst.AnalystOutput.safeParse(base({ score: 150 })).success, false);
    assert.equal(analyst.AnalystOutput.safeParse(base({ metricId: "uydurma_metrik" })).success, false);
  });

  it("taranmamış kaynağa dayanan kanıt reddedilir (FAILED)", () => {
    const parsed = analyst.AnalystOutput.parse(base({ evidence: [{ source: "https://baska-site.com/", observation: "uydurma gözlem" }] }));
    const results = analyst.toMetricResults(parsed, urls, "m");
    assert.ok(results.every((r) => r.state === "FAILED" && r.score == null));
  });

  it("assessable=false olan metrik UNKNOWN olur, sıfır puan almaz", () => {
    const parsed = analyst.AnalystOutput.parse(base({ assessable: false, score: 0, confidence: 0 }));
    assert.ok(analyst.toMetricResults(parsed, urls, "m").every((r) => r.state === "UNKNOWN" && r.score == null));
  });

  it("eksik dönen metrik FAILED işaretlenir", () => {
    const out = base(); out.metrics = out.metrics.slice(1);
    const results = analyst.toMetricResults(analyst.AnalystOutput.parse(out), urls, "m");
    assert.equal(results[0].state, "FAILED");
  });

  it("AI anahtarı yoksa AI metrikleri UNKNOWN kalır ve çağrı yapılmaz", async () => {
    const saved = { k: process.env.ANTHROPIC_API_KEY, t: process.env.ANTHROPIC_AUTH_TOKEN };
    delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_AUTH_TOKEN;
    const run = await analyst.runAnalyst({ lead: { id: "x", name: "x" }, crawl: { pages: [{ url: "https://ornek.com/" }] }, pagespeed: {} });
    Object.assign(process.env, saved.k ? { ANTHROPIC_API_KEY: saved.k } : {}, saved.t ? { ANTHROPIC_AUTH_TOKEN: saved.t } : {});
    assert.ok(run.results.every((r) => r.state === "UNKNOWN"));
    assert.equal(run.usage, null);
  });
});

describe("Büyüme fırsatları", () => {
  const scored = (id, score, state = "MEASURED", extra = {}) => ({ ...m(id, metrics.METRIC_BY_ID.get(id).category, state, score, extra), weight: metrics.METRIC_BY_ID.get(id).weight, method: metrics.METRIC_BY_ID.get(id).method });

  it("öncelik Etki × Güven × Kolaylık ile sıralanır", () => {
    const list = opp.buildOpportunities([scored("conv_tracking_readiness", 0), scored("seo_headings", 20), scored("tech_core_web_vitals", 20)]);
    assert.equal(list[0].metricIds[0], "conv_tracking_readiness"); // yüksek etki + kolay
    assert.ok(list.every((o, i) => i === 0 || list[i - 1].priorityScore >= o.priorityScore));
    assert.ok(list.every((o) => o.priorityScore >= 0 && o.priorityScore <= 100));
  });

  it("eşik üzerindeki, kanıtsız veya puansız metrikten fırsat üretmez", () => {
    const list = opp.buildOpportunities([scored("seo_titles", 90), scored("seo_headings", 10, "MEASURED", { evidence: [] }), scored("seo_meta_descriptions", null, "UNKNOWN")]);
    assert.equal(list.length, 0);
  });

  it("ölçülmüş bulgu 'observed', tahmini bulgu 'hypothesis' olarak ayrılır", () => {
    const [a] = opp.buildOpportunities([scored("conv_lead_capture", 20)]);
    const [b] = opp.buildOpportunities([scored("dx_cta_visibility", 20, "ESTIMATED")]);
    assert.equal(a.basis, "observed");
    assert.equal(b.basis, "hypothesis");
  });

  it("finansal etki alanı üretmez", () => {
    const [a] = opp.buildOpportunities([scored("conv_lead_capture", 20)]);
    assert.ok(!Object.keys(a).some((k) => /revenue|roi|loss|gelir/i.test(k)));
  });
});

describe("SSRF koruması", () => {
  it("özel ve ayrılmış adresleri engeller", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.5.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1",
      // Güvenlik incelemesi regresyonu: URL ayrıştırıcının ürettiği onaltılık IPv4 eşlenmiş/gömülü IPv6 biçimleri
      "::ffff:7f00:1", "::ffff:a9fe:a9fe", "[::ffff:7f00:1]", "::7f00:1", "64:ff9b::a9fe:a9fe", "2002:7f00:1::", "fe80::1%en0"]) assert.equal(safe.isBlockedAddress(ip), true, ip);
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(safe.isBlockedAddress(ip), false, ip);
  });

  it("yerel ad, standart dışı port ve kimlik bilgili adresi reddeder", async () => {
    for (const u of ["http://localhost/", "http://127.0.0.1/", "http://[::1]/", "https://ornek.com:8080/", "https://kullanici:sifre@ornek.com/", "http://metadata.internal/", "file:///etc/passwd"]) {
      await assert.rejects(safe.assertPublicUrl(new URL(u)), safe.FetchBlockedError, u);
    }
  });

  it("web sitesi adresini normalize eder", () => {
    assert.equal(safe.normalizeWebsite("ornek.com")?.toString(), "https://ornek.com/");
    assert.equal(safe.normalizeWebsite("ftp://ornek.com"), null);
    assert.equal(safe.normalizeWebsite("yerel"), null);
  });
});

describe("robots.txt", () => {
  const txt = "User-agent: *\nDisallow: /admin\nAllow: /admin/public\nCrawl-delay: 2\n\nUser-agent: imgrowthauditbot\nDisallow: /ozel\n\nSitemap: https://ornek.com/sitemap.xml";
  it("kendi grubumuzu tercih eder ve en uzun kuralı uygular", () => {
    const own = robots.parseRobots(txt, "imgrowthauditbot");
    assert.equal(robots.isAllowed(own, "/ozel/sayfa"), false);
    assert.equal(robots.isAllowed(own, "/admin"), true); // kendi grubumuzda /admin kuralı yok
    const star = robots.parseRobots(txt, "baskabot");
    assert.equal(robots.isAllowed(star, "/admin/x"), false);
    assert.equal(robots.isAllowed(star, "/admin/public/x"), true);
    assert.equal(star.crawlDelay, 2);
    assert.deepEqual(own.sitemaps, ["https://ornek.com/sitemap.xml"]);
  });
  it("Disallow: / tüm siteyi kapatır", () => {
    assert.equal(robots.isAllowed(robots.parseRobots("User-agent: *\nDisallow: /", "x"), "/"), false);
  });
});

describe("HTML çıkarımı", () => {
  const html = `<!doctype html><html lang="tr"><head><title>Kadıköy Diş Kliniği | Örnek</title>
    <meta name="viewport" content="width=device-width"><meta name="description" content="Kısa açıklama">
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Dentist","name":"Örnek"}</script></head>
    <body><header><nav><a href="/">Ana sayfa</a><a href="/iletisim">İletişim</a></nav></header>
    <h1>Gülüşünüz için</h1><a href="https://facebook.com/ornek">Facebook Sayfamız</a><a href="tel:+902161234567">Hemen Arayın</a>
    <form><label for="ad">Ad</label><input id="ad" required><input name="tel" placeholder="Telefon"><button>Gönder</button></form>
    <img src="a.jpg"><img src="b.jpg" alt="klinik"><p>Kadıköy Caferağa Mah. Moda Cad. No: 5</p></body></html>`;
  const page = extract.extractPage(html, "https://ornek.com/", { status: 200, bytes: html.length, fetchMs: 10, isHome: true });
  it("temel SEO ve dönüşüm sinyallerini çıkarır", () => {
    assert.equal(page.title, "Kadıköy Diş Kliniği | Örnek");
    assert.deepEqual(page.jsonLdTypes, ["Dentist"]);
    assert.ok(page.trackers.includes("Google Analytics 4"));
    assert.deepEqual(page.forms, [{ fields: 2, required: 1, labelled: 2, hasSubmit: true }]);
    assert.equal(page.imagesWithoutAlt, 1);
    assert.ok(page.addressHints.length > 0);
  });
  it("CTA tespitinde 'Facebook' içindeki 'book' sayılmaz, Türkçe büyük harf doğru eşleşir", () => {
    assert.ok(page.ctas.includes("Hemen Arayın"));
    assert.ok(page.ctas.includes("İletişim"));
    assert.ok(!page.ctas.includes("Facebook Sayfamız"));
  });
});

describe("Kuyruk yeniden deneme politikası", () => {
  const fake = () => { const calls = []; return { calls, prisma: { growthAudit: { update: async (q) => { calls.push(q); return q; } } } }; };
  it("geçici hata ve hak varsa geri çekilmeyle yeniden kuyruğa alır", async () => {
    const { calls, prisma } = fake();
    await new service.AuditService(prisma).fail("id", "zaman aşımı", { attempts: 1, maxAttempts: 3, retryable: true });
    assert.equal(calls[0].data.status, "queued");
    assert.ok(calls[0].data.nextAttemptAt > new Date(Date.now() + 25_000));
  });
  it("hak bittiğinde veya hata kalıcıysa failed olur", async () => {
    const a = fake(), b = fake();
    await new service.AuditService(a.prisma).fail("id", "x", { attempts: 3, maxAttempts: 3, retryable: true });
    await new service.AuditService(b.prisma).fail("id", "x", { attempts: 1, maxAttempts: 3, retryable: false });
    assert.equal(a.calls[0].data.status, "failed");
    assert.equal(b.calls[0].data.status, "failed");
  });
});

describe("API yetkilendirmesi", () => {
  it("oturum olmadan 401 döner ve servisi çağırmaz", async () => {
    const { AuditController } = await import("../.test-build/modules/audit/audit.controller.js");
    let called = false;
    const ctrl = new AuditController({ summary: async () => { called = true; return []; } });
    const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await ctrl.summary({ headers: {} }, res);
    assert.equal(res.code, 401);
    assert.equal(called, false);
  });
});

// Veritabanı varsa: kısmi benzersiz indeksin aynı firma için ikinci aktif denetimi engellediğini doğrular.
const DB = process.env.DATABASE_URL;
describe("Eşzamanlı denetim engeli (veritabanı)", { skip: !DB && "DATABASE_URL yok" }, () => {
  const pool = DB ? new pg.Pool({ connectionString: DB }) : null;
  const lead = `test-lead-${Date.now()}`;
  after(async () => { await pool?.query("DELETE FROM growth_audits WHERE lead_id = $1", [lead]); await pool?.end(); });
  it("aynı firma için ikinci queued/running kayıt reddedilir, tamamlanmış kayıt engellemez", async () => {
    await pool.query("INSERT INTO growth_audits(lead_id, status, scoring_version) VALUES ($1, 'completed', 'gs-1.0')", [lead]);
    await pool.query("INSERT INTO growth_audits(lead_id, status, scoring_version) VALUES ($1, 'queued', 'gs-1.0')", [lead]);
    await assert.rejects(pool.query("INSERT INTO growth_audits(lead_id, status, scoring_version) VALUES ($1, 'running', 'gs-1.0')", [lead]), /growth_audits_one_active_per_lead/);
  });
  it("geçersiz durum ve aralık dışı puan kısıtlarla reddedilir", async () => {
    await assert.rejects(pool.query("INSERT INTO growth_audits(lead_id, status, scoring_version) VALUES ($1, 'bilinmeyen', 'gs-1.0')", [lead]));
    await assert.rejects(pool.query("INSERT INTO growth_audits(lead_id, status, scoring_version, overall_score) VALUES ($1, 'completed', 'gs-1.0', 120)", [lead]));
  });
});
