// Milestone 3 (AI Growth Manager) testleri: dedektörler, gürültü eşikleri, izleme/performans ayrımı,
// brif, AI özet doğrulaması, şifreleme, parola, imza, Google yanıt ayrıştırıcıları, konum ayrıştırma.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const load = (p) => import(`../.test-build/modules/${p}.js`).then((m) => m.default ?? m);
const det = await load("growth-manager/detectors");
const an = await load("growth-manager/analytics");
const brief = await load("growth-manager/brief");
const sec = await load("growth-manager/security");
const google = await load("growth-manager/google");
const demo = await load("growth-manager/demo");
const geo = await load("geo/geo.service");

const END = "2026-10-12";
// 28 günlük Ads hesabı verisi üretir; son 7 gün için ayrı değerler verilebilir.
function ads({ cost = 1000, clicks = 100, conv = 8, lastCost, lastClicks, lastConv, days = 28 } = {}) {
  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const last = i < 7, date = an.addDays(END, -i);
    rows.push({ source: "google_ads", date, dimensionType: "account", dimensionKey: "account", metrics: { cost: last && lastCost != null ? lastCost : cost, clicks: last && lastClicks != null ? lastClicks : clicks, conversions: last && lastConv != null ? lastConv : conv, impressions: 1000 } });
  }
  return rows;
}
const ga = (sessions, keyEvents, lastKeyEvents) => Array.from({ length: 28 }, (_, k) => ({ source: "ga4", date: an.addDays(END, -k), dimensionType: "account", dimensionKey: "account", metrics: { sessions, keyEvents: k < 7 && lastKeyEvents != null ? lastKeyEvents : keyEvents } }));
const byDetector = (list, d) => list.filter((x) => x.detector === d);

describe("Analiz yardımcıları", () => {
  it("iki oran z-testi büyük ve küçük farkları ayırt eder", () => {
    assert.ok(an.significant(an.twoProportionZ(30, 1000, 80, 1000)));
    assert.ok(!an.significant(an.twoProportionZ(78, 1000, 80, 1000)));
  });
  it("pencereler önceki dönemle çakışmaz", () => {
    const w = an.windowEnding(END, 7), p = an.previousWindow(w, 7);
    assert.equal(w.start, "2026-10-06"); assert.equal(p.end, "2026-10-05"); assert.equal(p.start, "2026-09-29");
  });
});

describe("Para kaçağı dedektörü", () => {
  it("dalgalanma küçükse içgörü üretmez", () => {
    const out = det.detectMoneyLeaks(ads({ lastCost: 1050, lastConv: 7.6 }));
    assert.equal(out.length, 0);
  });
  it("harcama artıp dönüşüm anlamlı düşerse performans sorunu bildirir ve varsayımlarıyla tutar tahmin eder", () => {
    const out = det.detectMoneyLeaks(ads({ lastCost: 1400, lastClicks: 130, lastConv: 3 }));
    const [i] = byDetector(out, "ads_spend_up_conversions_down");
    assert.ok(i, JSON.stringify(out.map((x) => x.detector)));
    assert.equal(i.category, "performance");
    assert.ok(i.estimatedImpact && i.estimatedImpact.type === "money" && i.estimatedImpact.high > 0);
    assert.ok(i.assumptions.length > 0);
    assert.ok(i.evidence.length >= 3);
  });
  it("dönüşüm sıfıra düşüp GA4 hedef olayları sabitse izleme sorunu der ve parasal tahmin yapmaz", () => {
    const out = det.detectMoneyLeaks([...ads({ lastCost: 1300, lastConv: 0 }), ...ga(500, 20)]);
    const [i] = byDetector(out, "ads_spend_up_conversions_down");
    assert.equal(i.category, "tracking");
    assert.equal(i.estimatedImpact, null);
  });
  it("hiç dönüşüm yoksa harcamayı israf saymaz; izleme eksikliği olarak bildirir", () => {
    const out = det.detectMoneyLeaks(ads({ conv: 0 }));
    const [i] = byDetector(out, "ads_tracking_missing");
    assert.equal(i.category, "tracking");
    assert.equal(i.severity, "critical");
    assert.equal(i.estimatedImpact, null);
    assert.equal(byDetector(out, "ads_campaign_no_conversions").length, 0);
  });
  it("atfedilebilir dönüşümü olmayan kampanya için 'kayıp' değil 'risk altındaki tutar' der", () => {
    const rows = [...ads(), ...Array.from({ length: 14 }, (_, k) => ({ source: "google_ads", date: an.addDays(END, -k), dimensionType: "campaign", dimensionKey: "9", dimensionLabel: "Görüntülü", metrics: { cost: 300, clicks: 50, conversions: 0 } }))];
    const [i] = byDetector(det.detectMoneyLeaks(rows), "ads_campaign_no_conversions");
    assert.ok(i);
    assert.match(i.estimatedImpact.basis, /kayıp değil/);
    assert.match(i.explanation, /kanıtlamaz/);
  });
});

describe("Büyüme fırsatı dedektörü", () => {
  const rows = demo.demoRows(END);
  const out = det.detectGrowthOpportunities(rows);
  it("demo veride beklenen fırsatları bulur", () => {
    for (const d of ["gsc_low_ctr_queries", "gsc_striking_distance", "ads_budget_limited", "ga4_low_converting_pages"]) assert.ok(byDetector(out, d).length, d);
  });
  it("tahminler aralık olarak ve dayanağıyla verilir; para olmayan fırsatlarda para birimi yoktur", () => {
    for (const i of out.filter((x) => x.estimatedImpact)) {
      assert.ok(i.estimatedImpact.low <= i.estimatedImpact.high);
      assert.ok(i.estimatedImpact.basis.length > 5);
      if (i.estimatedImpact.type !== "money") assert.equal(i.estimatedImpact.currency, undefined);
    }
  });
  it("Growth Audit fırsatlarını yalnızca kritik/yüksek öncelikte taşır", () => {
    const o = det.detectGrowthOpportunities([], undefined, { id: "a1", opportunities: [{ id: "1", title: "A iyileştirilmeli", action: "x", priorityGroup: "low", priorityScore: 5, confidence: 0.9, service: null }] });
    assert.equal(o.length, 0);
    const p = det.detectGrowthOpportunities([], undefined, { id: "a1", opportunities: [{ id: "1", title: "A iyileştirilmeli", action: "x", priorityGroup: "critical", priorityScore: 60, confidence: 0.8, service: null }] });
    assert.equal(p[0].detector, "growth_audit_priorities");
  });
  it("içgörüler parmak iziyle tekilleşir ve öncelik 0-100 aralığındadır", () => {
    const all = det.runDetectors(rows);
    assert.equal(new Set(all.map((x) => x.fingerprint)).size, all.length);
    assert.ok(all.every((x) => x.priority >= 0 && x.priority <= 100));
  });
});

describe("Günlük brif", () => {
  const rows = demo.demoRows(END);
  const insights = det.runDetectors(rows).map((x, k) => ({ ...x, id: `i${k}`, status: "open" }));
  const b = brief.buildBrief({ date: "2026-10-13", rows, insights, currency: "TRY", demo: true, connectedSources: ["google_ads", "ga4", "search_console"] });
  it("en fazla üç eylem, her biri gerekçeli", () => {
    assert.ok(b.actions.length <= 3 && b.actions.length > 0);
    assert.ok(b.actions.every((a) => a.reason && a.action));
  });
  it("yalnızca kayda değer değişimleri listeler", () => {
    assert.ok(b.changes.every((c) => /\(\+|\(−/.test(c.text)));
    const quiet = brief.buildBrief({ date: "2026-10-13", rows: ads({ lastCost: 1020 }), insights: [], currency: "TRY", demo: false, connectedSources: ["google_ads"] });
    assert.equal(quiet.changes.length, 0);
    assert.equal(quiet.health.status, "good");
  });
  it("veri kaynağı yoksa rakam uydurmaz", () => {
    const empty = brief.buildBrief({ date: "2026-10-13", rows: [], insights: [], currency: "TRY", demo: false, connectedSources: [] });
    assert.equal(empty.kpis.length, 0);
    assert.match(empty.health.summary, /bağlı bir veri kaynağı yok/);
    assert.equal(empty.missingSources.length, 3);
  });
  it("AI özeti verilmeyen sayı veya yasak iddia içerirse reddedilir", () => {
    const facts = JSON.stringify({ changes: ["Reklam harcaması ₺13.125 → ₺17.640 (+%34)"] });
    assert.equal(brief.summaryGrounded("Harcama ₺17.640'a çıktı (+%34).", facts), true);
    assert.equal(brief.summaryGrounded("Harcama ₺25.000'e çıktı.", facts), false);
    assert.equal(brief.summaryGrounded("Satışlarınızı garanti ediyoruz.", facts), false);
  });
});

describe("Güvenlik", () => {
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.PORTAL_SESSION_SECRET = "test-portal-secret";
  it("entegrasyon belirteci şifrelenir ve geri çözülür; değiştirilmiş veri reddedilir", () => {
    const sealed = sec.encryptSecret("1//refresh-token");
    assert.ok(!sealed.includes("refresh-token"));
    assert.equal(sec.decryptSecret(sealed), "1//refresh-token");
    const parts = sealed.split("."); parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA");
    assert.throws(() => sec.decryptSecret(parts.join(".")));
  });
  it("parola scrypt ile özetlenir ve doğrulanır", () => {
    const h = sec.hashPassword("DogruParola123");
    assert.ok(h.startsWith("scrypt$"));
    assert.equal(sec.verifyPassword("DogruParola123", h), true);
    assert.equal(sec.verifyPassword("YanlisParola123", h), false);
    assert.equal(sec.verifyPassword("herhangi", null), false);
    assert.ok(sec.passwordProblem("kisa1"));
    assert.equal(sec.passwordProblem("yeterinceuzun1"), null);
  });
  it("imzalı oturum: amaç ayrımı, süre ve kurcalama kontrolü", () => {
    const t = sec.sign("portal", { uid: "u1", exp: Math.floor(Date.now() / 1000) + 60 });
    assert.equal(sec.verify("portal", t).uid, "u1");
    assert.equal(sec.verify("oauth", t), null, "farklı amaç için geçersiz olmalı");
    assert.equal(sec.verify("portal", t.replace(/^./, (c) => (c === "e" ? "f" : "e"))), null);
    assert.equal(sec.verify("portal", sec.sign("portal", { uid: "u1", exp: 1 })), null, "süresi dolmuş");
  });
});

describe("Google yanıt ayrıştırıcıları", () => {
  it("Google Ads kampanya satırlarını mikro birimden çevirir ve hesap toplamı üretir", () => {
    const rows = google.parseAdsCampaignRows([
      { segments: { date: "2026-10-01" }, campaign: { id: "1", name: "A", status: "ENABLED" }, metrics: { impressions: "100", clicks: "10", costMicros: "2500000", conversions: 1.5, conversionsValue: 300, searchBudgetLostImpressionShare: 0.25 } },
      { segments: { date: "2026-10-01" }, campaign: { id: "2", name: "B" }, metrics: { clicks: "5", costMicros: "500000" } },
    ]);
    const acc = rows.find((r) => r.dimensionType === "account");
    assert.equal(acc.metrics.cost, 3); assert.equal(acc.metrics.clicks, 15); assert.equal(acc.metrics.conversions, 1.5);
    assert.equal(rows.find((r) => r.dimensionKey === "1").metrics.budgetLostIs, 0.25);
  });
  it("GA4 ve Search Console yanıtlarını ortak biçime çevirir", () => {
    const g = google.parseGa4Daily({ rows: [{ dimensionValues: [{ value: "20261001" }], metricValues: [{ value: "120" }, { value: "4" }, { value: "70" }] }] });
    assert.deepEqual(g[0], { source: "ga4", date: "2026-10-01", dimensionType: "account", dimensionKey: "account", metrics: { sessions: 120, keyEvents: 4, engagedSessions: 70 } });
    const q = google.parseGscQueries({ rows: [{ keys: ["diş kliniği"], clicks: 3, impressions: 400, position: 4.2 }] }, END);
    assert.equal(q[0].dimensionType, "query_28d"); assert.equal(q[0].metrics.impressions, 400);
  });
  it("yalnızca okuma kapsamları istenir", () => {
    for (const p of Object.values(google.PROVIDERS)) assert.ok(/readonly|adwords/.test(p.scope));
    assert.ok(google.PROVIDERS.ga4.scope.endsWith("readonly") && google.PROVIDERS.search_console.scope.endsWith("readonly"));
  });
});

describe("Harita konumları", () => {
  it("radar kaydı ve Google Maps bağlantısındaki koordinatı okur, sorgu bağlantısından adres çıkarır", () => {
    assert.deepEqual(geo.pointFromLead({ location: { lat: 41.0, lon: 29.0 } }), { lat: 41, lon: 29 });
    assert.deepEqual(geo.pointFromLead({ mapsUrl: "https://www.google.com/maps/place/X/@37.06,37.38,17z" }), { lat: 37.06, lon: 37.38 });
    assert.equal(geo.pointFromLead({ location: { lat: 0, lon: 0 } }), null);
    assert.equal(geo.addressQuery({ mapsUrl: "https://www.google.com/maps/search/?api=1&query=Ada%20Mobilya%20Şehitkamil%20Gaziantep" }), "Ada Mobilya Şehitkamil Gaziantep");
  });
});
