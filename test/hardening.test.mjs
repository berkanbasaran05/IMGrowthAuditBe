// Milestone 4 (sağlamlaştırma) testleri: yapılandırma doğrulama, günlük maskeleme, CSRF Origin denetimi,
// güvenilir istemci IP'si, veri saklama politikası, görsel vekili imzası, Prisma saat dilimi regresyonu.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

const load = (p) => import(`../.test-build/${p}.js`).then((m) => m.default ?? m);
const cfg = await load("infrastructure/config");
const http = await load("infrastructure/http/http-hardening");
const rl = await load("infrastructure/http/rate-limit");
const ret = await load("modules/ops/retention.service");

const strong = { NODE_ENV: "production", DATABASE_URL: "postgres://x", SESSION_SECRET: "s".repeat(40), ADMIN_USER: "yonetici", ADMIN_PASSWORD: "Cok-Guclu-Parola-2026" };

describe("Yapılandırma doğrulama", () => {
  it("üretimde güçlü ayarlarla hata vermez", () => assert.deepEqual(cfg.validateConfig(strong).errors, []));
  it("üretimde zayıf veya örnek değerleri hata sayar", () => {
    const r = cfg.validateConfig({ ...strong, ADMIN_PASSWORD: "guclu-bir-sifre", SESSION_SECRET: "kisa" });
    assert.equal(r.errors.length, 2);
  });
  it("geliştirmede aynı sorunlar yalnızca uyarıdır", () => {
    const r = cfg.validateConfig({ ...strong, NODE_ENV: "development", ADMIN_PASSWORD: "kisa" });
    assert.equal(r.errors.length, 0);
    assert.ok(r.warnings.some((w) => /ADMIN_PASSWORD/.test(w)));
  });
  it("geçersiz şifreleme anahtarını ve anahtarsız OAuth'u reddeder", () => {
    assert.ok(cfg.validateConfig({ ...strong, INTEGRATION_ENCRYPTION_KEY: "abc" }).errors.some((e) => /32 bayt/.test(e)));
    assert.ok(cfg.validateConfig({ ...strong, GOOGLE_OAUTH_CLIENT_ID: "a", GOOGLE_OAUTH_CLIENT_SECRET: "b", GOOGLE_OAUTH_REDIRECT_URI: "c" }).errors.some((e) => /INTEGRATION_ENCRYPTION_KEY/.test(e)));
  });
});

describe("Günlük maskeleme", () => {
  it("rapor belirteci, davet ve OAuth parametreleri günlüğe düşmez", () => {
    assert.equal(http.redactUrl("/r/abcDEF123_-xyz/pdf"), "/r/[gizli]/pdf");
    assert.equal(http.redactUrl("/portal/davet?token=SECRET&x=1"), "/portal/davet?token=[gizli]&x=1");
    assert.equal(http.redactUrl("/oauth/google/callback?code=C&state=S"), "/oauth/google/callback?code=[gizli]&state=[gizli]");
    assert.equal(http.redactUrl("/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=V&hub_verify_token=V&hub.challenge=1"), "/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=[gizli]&hub_verify_token=[gizli]&hub.challenge=1");
    assert.equal(http.redactUrl("/api/img?u=https%3A%2F%2Fa&s=SIG"), "/api/img?u=https%3A%2F%2Fa&s=[gizli]");
  });
});

describe("CSRF Origin denetimi", () => {
  const run = (req) => { let passed = false; const res = { code: 0, status(c) { this.code = c; return this; }, json() { return this; } }; http.sameOriginGuard({ originalUrl: "/api/x", headers: {}, ...req }, res, () => { passed = true; }); return { passed, code: res.code }; };
  const cookie = "im_session=abc";
  it("oturum çerezli yazma isteği yabancı kökenden gelirse reddedilir", () => assert.equal(run({ method: "POST", headers: { cookie, origin: "https://kotu.example", host: "panel.example" } }).code, 403));
  it("aynı kökenden gelen istek geçer", () => assert.ok(run({ method: "POST", headers: { cookie, origin: "https://panel.example", host: "127.0.0.1:3001", "x-forwarded-host": "panel.example" } }).passed));
  it("çerezsiz veya okuma isteklerine dokunmaz", () => {
    assert.ok(run({ method: "POST", headers: { origin: "https://kotu.example", host: "panel.example" } }).passed);
    assert.ok(run({ method: "GET", headers: { cookie, origin: "https://kotu.example", host: "panel.example" } }).passed);
  });
  it("Origin yoksa Referer'a bakar; bozuk değer reddedilir", () => {
    assert.equal(run({ method: "PATCH", headers: { cookie: "im_portal=x", referer: "https://kotu.example/a", host: "panel.example" } }).code, 403);
    assert.equal(run({ method: "DELETE", headers: { cookie, origin: "bozuk", host: "panel.example" } }).code, 403);
  });
  it("ALLOWED_ORIGINS ile izin verilen köken geçer", () => {
    process.env.ALLOWED_ORIGINS = "https://customer.istanbul.marketing";
    assert.ok(run({ method: "POST", headers: { cookie, origin: "https://customer.istanbul.marketing", host: "backend:3001" } }).passed);
    delete process.env.ALLOWED_ORIGINS;
  });
});

describe("Hız sınırı ve istemci IP'si", () => {
  it("IP, istemcinin gönderdiği X-Forwarded-For'dan değil trust proxy ile hesaplanan req.ip'ten alınır", () => {
    assert.equal(rl.clientIp({ ip: "203.0.113.5", headers: { "x-forwarded-for": "1.2.3.4" } }), "203.0.113.5");
  });
  it("pencere içinde sınırı aşan istek engellenir", () => {
    const k = `t-${Date.now()}`;
    for (let i = 0; i < 3; i++) assert.equal(rl.rateLimited(k, 3), false);
    assert.equal(rl.rateLimited(k, 3), true);
  });
});

describe("Veri saklama politikası", () => {
  it("varsayılanlar ve ortam değişkeniyle geçersiz kılma; 7 günden kısa süre kabul edilmez", () => {
    const p = ret.retentionPolicy({ RETENTION_SCREENSHOTS_DAYS: "30", RETENTION_REPORT_LINKS_DAYS: "2", RETENTION_METRICS_DAYS: "abc" });
    assert.equal(p.screenshots, 30);
    assert.equal(p.reportLinks, ret.RETENTION_DEFAULTS.reportLinks);
    assert.equal(p.metrics, ret.RETENTION_DEFAULTS.metrics);
  });
  it("kesim tarihi doğru hesaplanır", () => assert.equal(ret.cutoff(10, Date.UTC(2026, 9, 13)).toISOString(), "2026-10-03T00:00:00.000Z"));
});

describe("Görsel vekili", () => {
  it("imzasız adresi reddeder (açık vekil değildir)", async () => {
    process.env.SESSION_SECRET ||= "x".repeat(40);
    const mod = await import("../.test-build/modules/growth/api/img.js");
    const img = mod.default?.default ?? mod.default; // CJS'de varsayılan dışa aktarım iç içe gelir
    const res = { code: 0, status(c) { this.code = c; return this; }, end() { return this; }, json() { return this; } };
    await img({ query: { u: "https://ornek.com/a.png", s: "yanlis" }, headers: {} }, res);
    assert.equal(res.code, 403);
  });
});

// Regresyon: Prisma pg adaptörü saat dilimi eki olmadan yazınca veritabanı saat dilimi kadar kayma oluyordu.
const DB = process.env.DATABASE_URL;
describe("Prisma zaman damgası (veritabanı)", { skip: !DB && "DATABASE_URL yok" }, () => {
  let prisma;
  after(async () => { await prisma?.keyValue.deleteMany({ where: { key: { startsWith: "test:tz:" } } }); await prisma?.$disconnect(); });
  it("Redis uyumluluk katmanında sayaç (INCR/DECR) çalışır — günlük e-posta limiti ve hız sınırları buna dayanır", async () => {
    const mod = await import("../.test-build/modules/growth/lib/redis.js"), redis = mod.redis ?? mod.default.redis;
    const key = `test:tz:incr:${Date.now()}`;
    assert.equal(await redis("INCR", key), 1);
    assert.equal(await redis("INCR", key), 2);
    assert.equal(await redis("DECR", key), 1);
  });
  it("yazılan zaman, veritabanı now() ile aynı anı gösterir", async () => {
    const { PrismaService } = await import("../.test-build/infrastructure/prisma/prisma.service.js");
    prisma = new PrismaService();
    const key = `test:tz:${Date.now()}`;
    await prisma.keyValue.create({ data: { key, value: "x", expiresAt: new Date() } });
    const [row] = await prisma.$queryRawUnsafe(`SELECT abs(extract(epoch FROM expires_at - now()))::float8 AS diff FROM key_values WHERE key = $1`, key);
    assert.ok(row.diff < 60, `kayma ${row.diff} sn`);
  });
});

describe("Güvenlik incelemesi düzeltmeleri", () => {
  it("URL ayrıştırılmış IPv6 eşlenmiş adres hedefi reddedilir", async () => {
    const safe = await load("modules/audit/safe-fetch");
    await assert.rejects(safe.assertPublicUrl(new URL("http://[::ffff:127.0.0.1]/")), safe.FetchBlockedError);
    await assert.rejects(safe.assertPublicUrl(new URL("http://[::ffff:169.254.169.254]/latest/meta-data/")), safe.FetchBlockedError);
  });
  it("iç hata ayrıntısı kullanıcıya gösterilmez, doğrulama mesajı gösterilir", () => {
    assert.match(http.publicMessage(Object.assign(new Error("Invalid `prisma.x.findMany()` invocation"), { name: "PrismaClientKnownRequestError", code: "P2002" })), /Sorun sürerse/);
    assert.match(http.publicMessage(new TypeError("Cannot read properties of undefined")), /Sorun sürerse/);
    assert.equal(http.publicMessage(new Error("Geçerli bir e-posta girin")), "Geçerli bir e-posta girin");
  });
  it("sağlayıcı kontrolü prototip anahtarlarını kabul etmez", async () => {
    const google = await load("modules/growth-manager/google");
    assert.equal(google.isProvider("constructor"), false);
    assert.equal(google.isProvider("toString"), false);
    assert.equal(google.isProvider("ga4"), true);
  });
  it("yönetici parolası değişince eski oturum geçersiz olur", async () => {
    const saved = { s: process.env.SESSION_SECRET, u: process.env.ADMIN_USER, p: process.env.ADMIN_PASSWORD };
    Object.assign(process.env, { SESSION_SECRET: "x".repeat(40), ADMIN_USER: "yonetici", ADMIN_PASSWORD: "Ilk-Parola-2026!" });
    const mod = await import("../.test-build/modules/growth/lib/auth.js"), auth = mod.default?.isAuthed ? mod.default : mod;
    const cookie = auth.sessionCookie("yonetici").split(";")[0];
    assert.equal(auth.isAuthed({ headers: { cookie } }), true);
    process.env.ADMIN_PASSWORD = "Yeni-Parola-2026!";
    assert.equal(auth.isAuthed({ headers: { cookie } }), false);
    Object.assign(process.env, { SESSION_SECRET: saved.s ?? "", ADMIN_USER: saved.u ?? "", ADMIN_PASSWORD: saved.p ?? "" });
  });
  it("makine belirteci tekil firma kaydını düzenleyemez", async () => {
    process.env.INGEST_TOKEN = "t".repeat(40);
    const mod = await import("../.test-build/modules/growth/api/leads.js"), leads = mod.default?.default ?? mod.default;
    const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
    await leads({ method: "PATCH", headers: { authorization: `Bearer ${"t".repeat(40)}` }, body: { id: "x", patch: { email: "saldirgan@example.com" } } }, res);
    assert.equal(res.code, 403);
  });
});

describe("Express 5 uyumluluğu", () => {
  it("/sunum/:slug ve /api/track yol bilgisini eski işleyicilere iletir (req.query okuyucusu yazmayı yutmaz)", async () => {
    const { GrowthController } = await import("../.test-build/modules/growth/growth.controller.js");
    const ctrl = new GrowthController();
    // Express 5 gibi: query her erişimde yeni nesne döndüren bir okuyucu
    const makeReq = () => { const req = { method: "GET", headers: {}, body: {} }; Object.defineProperty(req, "query", { get: () => ({ preview: "0" }), configurable: true }); return req; };
    const req = makeReq();
    const res = { status() { return this; }, send() { return this; }, json() { return this; }, end() { return this; }, setHeader() {}, redirect() { return this; }, set() { return this; }, type() { return this; } };
    await ctrl.sunum("ornek-firma", req, res).catch(() => {});
    assert.equal(req.query.slug, "ornek-firma");
    assert.equal(req.query.page, "sunum");
    assert.equal(req.query.preview, "0", "mevcut sorgu parametreleri korunur");
  });
});

describe("Ödeme sağlayıcısı (iyzico)", () => {
  const load2 = (p) => import(`../.test-build/modules/payments/${p}.js`);
  it("yanıt imzası iyzico'nun resmi örnek kodundaki yöntemle aynı hesaplanır", async () => {
    const { iyzicoSignature, signatureValid } = await load2("providers");
    const utils = (await import("iyzipay/lib/utils.js")).default;
    const fields = ["SUCCESS", "12345", "TRY", "basket-1", "conv-1", "100.0", "100.0", "tok"];
    assert.equal(iyzicoSignature(fields, "gizli"), utils.calculateHmacSHA256Signature(fields, "gizli"));
    assert.equal(signatureValid(iyzicoSignature(fields, "gizli"), fields, "gizli"), true);
  });
  it("yanlış anahtar, değiştirilmiş alan veya biçimi bozuk imza reddedilir", async () => {
    const { iyzicoSignature, signatureValid } = await load2("providers");
    const fields = ["SUCCESS", "1", "TRY", "b", "c", "100.0", "100.0", "t"], sig = iyzicoSignature(fields, "gizli");
    assert.equal(signatureValid(sig, fields, "baska-anahtar"), false);
    assert.equal(signatureValid(sig, ["SUCCESS", "1", "TRY", "b", "c", "1.0", "100.0", "t"], "gizli"), false, "tutar değişirse reddedilir");
    for (const bad of [undefined, null, "", "xyz", 123, "g".repeat(64)]) assert.equal(signatureValid(bad, fields, "gizli"), false);
  });
  it("ödeme isteği tutarı iki ondalıkla, tek sepet kalemiyle ve ödeme sonucunun döneceği adresle kurar", async () => {
    const { iyzicoRequest } = await load2("providers");
    const r = iyzicoRequest({ conversationId: "c-1", amount: 12500, currency: "TRY", description: "Aylık yönetim", callbackUrl: "https://x.example/api/payments/callback", buyer: { id: "u1", name: "Ayşe Yılmaz Demir", email: "a@b.co", phone: null, ip: "1.2.3.4" } }, { identityNumber: "11111111111", installments: [1, 2, 3] });
    assert.equal(r.price, "12500.00"); assert.equal(r.paidPrice, "12500.00");
    assert.equal(r.buyer.name, "Ayşe Yılmaz"); assert.equal(r.buyer.surname, "Demir");
    assert.equal(r.basketItems.length, 1); assert.equal(r.basketItems[0].price, "12500.00");
    assert.equal(r.callbackUrl, "https://x.example/api/payments/callback"); assert.deepEqual(r.enabledInstallments, [1, 2, 3]);
  });
  it("yerel test sağlayıcısı üretimde etkinleşmez", async () => {
    const { paymentProvider } = await load2("providers");
    assert.equal(paymentProvider({ PAYMENT_PROVIDER: "mock", NODE_ENV: "production" }), null);
    assert.equal(paymentProvider({ PAYMENT_PROVIDER: "mock", NODE_ENV: "development" })?.name, "mock");
    assert.equal(paymentProvider({}), null);
  });
});

describe("Ödeme sayfaları ve CSRF uyumu", () => {
  it("ödeme sayfaları 'same-origin' yönlendiren politikası kullanır (no-referrer, form gönderimlerinde Origin: null üretip meşru isteği engellerdi)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/modules/payments/payments.controller.ts", import.meta.url), "utf8");
    assert.match(src, /"Referrer-Policy": "same-origin"/);
    assert.doesNotMatch(src, /"Referrer-Policy": "no-referrer"/);
  });
  it("Origin: null ile gelen çerezli yazma isteği hâlâ reddedilir (güvenlik gevşetilmedi)", () => {
    let passed = false; const res = { code: 0, status(c) { this.code = c; return this; }, json() { return this; } };
    http.sameOriginGuard({ method: "POST", originalUrl: "/api/x", headers: { cookie: "im_portal=x", origin: "null", host: "panel.example" } }, res, () => { passed = true; });
    assert.equal(res.code, 403); assert.equal(passed, false);
  });
});
