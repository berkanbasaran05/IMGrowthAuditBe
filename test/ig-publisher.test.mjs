// Zamanlanmış Instagram hikâyeleri: dosya adı doğrulama, zamanlama (İstanbul), yayın akışı (sahte fetch), hata/yeniden deneme, görsel ucu.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const load = (p) => import(`../.test-build/modules/${p}.js`).then((m) => m.default ?? m);
const L = await load("instagram/ig-publisher.logic");
const { IgClient } = await load("instagram/instagram.client");
const { IgPublisherService } = await load("instagram/ig-publisher.service");
const { IgMediaController, IgQueueController } = await load("instagram/ig-media.controller");

const dir = mkdtempSync(path.join(os.tmpdir(), "ig-media-"));
writeFileSync(path.join(dir, "story-20261016-1100-a.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
writeFileSync(path.join(dir, "story-x.png"), Buffer.from([0x89, 0x50]));
process.env.IG_MEDIA_DIR = dir;
process.env.PUBLIC_REPORT_BASE_URL = "https://customer.istanbul.marketing/";

describe("Dosya adı ve adres", () => {
  it("yalnızca [a-z0-9-]+.(jpg|png) kabul edilir", () => {
    for (const ok of ["a.jpg", "story-20261016-1100-kapak.jpg", "x-1.png"]) assert.equal(L.isValidMediaFile(ok), true, ok);
    for (const bad of ["../etc/passwd", "..%2Fa.jpg", "A.jpg", "a.jpeg", "a.JPG", "a.jpg.exe", ".jpg", "a b.jpg", "a/b.jpg", "a\\b.jpg", "a.jpg\n", "", null, "a".repeat(101) + ".jpg"]) assert.equal(L.isValidMediaFile(bad), false, String(bad));
  });
  it("görsel adresi /api/public/ig-media altında, taban PUBLIC_REPORT_BASE_URL", () => {
    assert.equal(L.mediaUrl("a.jpg"), "https://customer.istanbul.marketing/api/public/ig-media/a.jpg");
    assert.equal(L.mediaUrl("a.jpg", {}), "https://customer.istanbul.marketing/api/public/ig-media/a.jpg");
    assert.throws(() => L.mediaUrl("../a.jpg"));
    assert.equal(L.contentTypeFor("a.png"), "image/png");
    assert.equal(L.contentTypeFor("a.jpg"), "image/jpeg");
  });
  it("kaynak adından güvenli hedef ad üretilir", () => {
    const at = L.zonedToUtc("2026-10-16T11:00", "Europe/Istanbul");
    assert.equal(L.storyFileName("/x/Hikâye Şablon 01.PNG", at, "Europe/Istanbul"), "story-20261016-1100-hikaye-sablon-01.jpg");
    assert.equal(L.isValidMediaFile(L.storyFileName("???.png", at, "Europe/Istanbul")), true);
  });
  it("hata metninden belirteçler ayıklanır", () => {
    const s = L.safeError(new Error("x access_token=IGAAabcdefghijklmnop123 Bearer IGAAzzzzzzzzzzzzzzzz " + "q".repeat(80)));
    assert.ok(!/IGAA|qqqq/.test(s)); assert.match(s, /access_token=\*\*\*/);
  });
});

describe("Zamanlama (Europe/Istanbul)", () => {
  it("11:00 İstanbul = 08:00 UTC; her gün aynı saat", () => {
    const t = L.scheduleTimes("2026-10-16T11:00", 3, 24, "Europe/Istanbul");
    assert.deepEqual(t.map((d) => d.toISOString()), ["2026-10-16T08:00:00.000Z", "2026-10-17T08:00:00.000Z", "2026-10-18T08:00:00.000Z"]);
    assert.equal(L.formatInZone(t[2], "Europe/Istanbul"), "2026-10-18 11:00");
  });
  it("ay sonu taşması ve 12 saatlik aralık", () => {
    const t = L.scheduleTimes("2026-10-31T23:00", 2, 12, "Europe/Istanbul");
    assert.deepEqual(t.map((d) => L.formatInZone(d, "Europe/Istanbul")), ["2026-10-31 23:00", "2026-11-01 11:00"]);
  });
  it("yaz saati olan dilimde duvar saati korunur", () => {
    const t = L.scheduleTimes("2026-10-24T11:00", 2, 24, "Europe/Berlin"); // 25 Ekim'de CEST → CET
    assert.deepEqual(t.map((d) => d.toISOString()), ["2026-10-24T09:00:00.000Z", "2026-10-25T10:00:00.000Z"]);
  });
  it("geçersiz girdiler reddedilir", () => {
    assert.throws(() => L.zonedToUtc("16.10.2026 11:00", "Europe/Istanbul"));
    assert.throws(() => L.zonedToUtc("2026-10-16T11:00", "Mars/Olympus"));
    assert.throws(() => L.scheduleTimes("2026-10-16T11:00", 1, 0, "Europe/Istanbul"));
  });
  it("yeniden deneme planı: 5 dk, 15 dk, sonra failed", () => {
    const now = new Date("2026-10-16T08:00:00Z");
    assert.deepEqual(L.retryPlan(1, now), { status: "queued", nextAttemptAt: new Date("2026-10-16T08:05:00Z") });
    assert.deepEqual(L.retryPlan(2, now), { status: "queued", nextAttemptAt: new Date("2026-10-16T08:15:00Z") });
    assert.deepEqual(L.retryPlan(3, now), { status: "failed", nextAttemptAt: null });
  });
});

// Sahte fetch: graph.instagram.com yanıtları sırayla; istekler kaydedilir.
function fakeFetch(handlers) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
    const h = handlers.find((x) => x.match(url, init));
    const r = h ? (typeof h.reply === "function" ? h.reply(calls.length) : h.reply) : { status: 500, body: { error: { code: 1, message: "beklenmeyen" } } };
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  return { fetcher, calls };
}
const CFG = { appSecret: "s", verifyToken: "v", accessToken: "tok-secret", accountId: "1784", version: "v25.0" };

function publisher(handlers) {
  const { fetcher, calls } = fakeFetch(handlers);
  const rows = new Map();
  const prisma = { igScheduledPost: { update: async ({ where, data }) => Object.assign(rows.get(where.id), data) } };
  const svc = new IgPublisherService(prisma, { client: new IgClient(CFG, null, fetcher) });
  const sleeps = [];
  svc.sleep = async (ms) => { sleeps.push(ms); };
  const add = (over = {}) => { const r = { id: "p1", fileName: "story-20261016-1100-a.jpg", containerId: null, attempts: 1, scheduledAt: new Date(), status: "publishing", ...over }; rows.set(r.id, r); return r; };
  return { svc, calls, rows, add, sleeps };
}
const isPost = (suffix) => (url, init) => init.method === "POST" && url.endsWith(suffix);
const isGet = (part) => (url, init) => (init.method || "GET") === "GET" && url.includes(part);

describe("Yayın akışı (sahte fetch)", () => {
  it("kapsayıcı → durum (IN_PROGRESS → FINISHED) → media_publish", async () => {
    let n = 0;
    const p = publisher([
      { match: isPost("/1784/media"), reply: { status: 200, body: { id: "c1" } } },
      { match: isGet("/c1?fields=status_code"), reply: () => ({ status: 200, body: { status_code: ++n < 2 ? "IN_PROGRESS" : "FINISHED" } }) },
      { match: isPost("/1784/media_publish"), reply: { status: 200, body: { id: "m9" } } },
    ]);
    const row = p.add();
    assert.equal(await p.svc.processRow(row), "published");
    const [create, , , pub] = p.calls;
    assert.equal(create.url, "https://graph.instagram.com/v25.0/1784/media");
    assert.deepEqual(create.body, { image_url: "https://customer.istanbul.marketing/api/public/ig-media/story-20261016-1100-a.jpg", media_type: "STORIES" });
    assert.equal(create.auth, "Bearer tok-secret");
    assert.ok(!create.url.includes("tok-secret"), "belirteç adreste yok");
    assert.deepEqual(pub.body, { creation_id: "c1" });
    assert.deepEqual([row.status, row.mediaId, row.containerId, row.error], ["published", "m9", "c1", null]);
    assert.ok(row.publishedAt instanceof Date);
    assert.equal(p.sleeps.length, 2);
  });

  it("kapsayıcı hatası: yeniden kuyruğa (gecikmeli), 3. denemede failed; hata metninde belirteç yok", async () => {
    const p = publisher([{ match: isPost("/1784/media"), reply: { status: 400, body: { error: { code: 9004, error_subcode: 2207052, message: "Media download failed access_token=tok-secret" } } } }]);
    const now = new Date("2026-10-16T08:00:00Z");
    const row = p.add({ attempts: 1 });
    assert.equal(await p.svc.processRow(row, now), "queued");
    assert.equal(row.status, "queued");
    assert.equal(row.nextAttemptAt.toISOString(), "2026-10-16T08:05:00.000Z");
    assert.match(row.error, /Hikâye kapsayıcısı başarısız \(400, kod 9004\/2207052/);
    assert.ok(!row.error.includes("tok-secret"));
    row.attempts = 3;
    assert.equal(await p.svc.processRow(row, now), "failed");
    assert.equal(row.nextAttemptAt, null);
  });

  it("kapsayıcı ERROR → kapsayıcı temizlenir ve yeniden denenir", async () => {
    const p = publisher([
      { match: isPost("/1784/media"), reply: { status: 200, body: { id: "c2" } } },
      { match: isGet("/c2?"), reply: { status: 200, body: { status_code: "ERROR", status: "Error: unsupported format" } } },
    ]);
    const row = p.add();
    assert.equal(await p.svc.processRow(row), "queued");
    assert.equal(row.containerId, null);
    assert.match(row.error, /Kapsayıcı ERROR: Error: unsupported format/);
  });

  it("~2 dk içinde hazır olmazsa kapsayıcı saklanır; sonraki denemede FINISHED ise yalnızca yayınlanır", async () => {
    let ready = false;
    const p = publisher([
      { match: isPost("/1784/media"), reply: { status: 200, body: { id: "c3" } } },
      { match: isGet("/c3?"), reply: () => ({ status: 200, body: { status_code: ready ? "FINISHED" : "IN_PROGRESS" } }) },
      { match: isPost("/1784/media_publish"), reply: { status: 200, body: { id: "m3" } } },
    ]);
    const row = p.add();
    assert.equal(await p.svc.processRow(row), "queued");
    assert.equal(row.containerId, "c3");
    assert.equal(p.sleeps.reduce((a, b) => a + b, 0), L.STATUS_POLL_DELAYS_MS.reduce((a, b) => a + b, 0));
    assert.ok(p.sleeps.reduce((a, b) => a + b, 0) <= 130_000);
    ready = true;
    const before = p.calls.filter((c) => c.url.endsWith("/1784/media")).length;
    assert.equal(await p.svc.processRow({ ...row, attempts: 2 }), "published");
    assert.equal(p.calls.filter((c) => c.url.endsWith("/1784/media")).length, before, "yeni kapsayıcı açılmadı");
    assert.equal(row.mediaId, "m3");
  });

  it("önceki denemede yayınlanmışsa (PUBLISHED) yinelenmez", async () => {
    const p = publisher([{ match: isGet("/c4?"), reply: { status: 200, body: { status_code: "PUBLISHED" } } }]);
    const row = p.add({ containerId: "c4" });
    assert.equal(await p.svc.processRow(row), "published");
    assert.ok(!p.calls.some((c) => c.method === "POST"));
  });

  it("PNG ya da eksik dosya: Meta'ya gitmeden doğrudan failed", async () => {
    const p = publisher([]);
    const png = p.add({ id: "p2", fileName: "story-x.png" });
    assert.equal(await p.svc.processRow(png), "failed");
    assert.match(png.error, /JPEG/);
    const missing = p.add({ id: "p3", fileName: "yok.jpg" });
    assert.equal(await p.svc.processRow(missing), "failed");
    assert.match(missing.error, /Dosya bulunamadı/);
    assert.equal(p.calls.length, 0);
  });

  it("tick: Instagram yapılandırması yoksa hiçbir şey yapmaz", async () => {
    let touched = false;
    const svc = new IgPublisherService(new Proxy({}, { get: () => { touched = true; } }), { client: null });
    await svc.tick();
    assert.equal(touched, false);
  });
});

describe("Görsel ucu ve kuyruk", () => {
  const res = () => ({ code: 200, headers: {}, body: null, sent: null, headersSent: false,
    status(c) { this.code = c; return this; }, set(h) { Object.assign(this.headers, h); return this; }, type(t) { this.headers["Content-Type"] = t; return this; },
    send(b) { this.body = b; return this; }, json(b) { this.body = b; return this; },
    sendFile(file, opts, cb) { this.sent = { file, opts }; cb?.(); return this; } });
  it("geçersiz adlar 404, geçerli ad IG_MEDIA_DIR kökünden doğru tür ve önbellekle gönderilir", () => {
    const c = new IgMediaController();
    for (const bad of ["../.env", "..", "a.jpeg", "A.jpg", "%2e%2e.jpg"]) { const r = res(); c.file(bad, r); assert.equal(r.code, 404, bad); assert.equal(r.sent, null); }
    const r = res(); c.file("story-20261016-1100-a.jpg", r);
    assert.deepEqual(r.sent, { file: "story-20261016-1100-a.jpg", opts: { root: dir, dotfiles: "deny" } });
    assert.equal(r.headers["Content-Type"], "image/jpeg");
    assert.equal(r.headers["Cache-Control"], "public, max-age=86400");
    const p = res(); c.file("story-x.png", p); assert.equal(p.headers["Content-Type"], "image/png");
  });
  it("dosya yoksa 404", () => {
    const r = res(); r.sendFile = function (f, o, cb) { cb(Object.assign(new Error("ENOENT"), { status: 404 })); return this; };
    new IgMediaController().file("yok.jpg", r);
    assert.equal(r.code, 404);
  });
  it("kuyruk ucu oturum ister", async () => {
    const r = res();
    await new IgQueueController({ queue: async () => ({ items: [] }) }).queue({ headers: {} }, r);
    assert.equal(r.code, 401);
  });
});
