// Panel "Instagram" sekmesi: alan normalizasyonu, zamanlama/eylem planı, oturum zorunluluğu, profil/medya (sahte fetch),
// yükleme (JPEG, boyut, tarih) ve kuyruk eylemleri (sahte Prisma).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

process.env.SESSION_SECRET ||= "x".repeat(40);
process.env.ADMIN_PASSWORD ||= "Test-Parola-2026!";
const dir = mkdtempSync(path.join(os.tmpdir(), "ig-panel-"));
process.env.IG_MEDIA_DIR = dir;

const load = (p) => import(`../.test-build/modules/${p}.js`).then((m) => m.default ?? m);
const L = await load("instagram/ig-panel.logic");
const { IgClient } = await load("instagram/instagram.client");
const { IgPanelService, PanelError } = await load("instagram/ig-panel.service");
const { IgPanelController, SessionGuard } = await load("instagram/ig-panel.controller");
const auth = await load("growth/lib/auth");
const cookie = auth.sessionCookie("test").split(";")[0];

const CFG = { appSecret: "s", verifyToken: "v", accessToken: "tok-secret", accountId: "1784", version: "v25.0" };
function fakeFetch(handler) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, auth: init.headers?.Authorization });
    const r = handler(url, calls.length) || { status: 500, body: { error: { code: 1, message: "beklenmeyen" } } };
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  return { fetcher, calls };
}

function fakePrisma(rows = []) {
  const posts = new Map(rows.map((r) => [r.id, { ...r }]));
  const match = (r, where) => Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "in" in v ? v.in.includes(r[k]) : r[k] === v));
  return {
    posts,
    igScheduledPost: {
      count: async () => posts.size,
      findMany: async () => [...posts.values()],
      findUnique: async ({ where }) => posts.get(where.id) ?? null,
      create: async ({ data }) => { const r = { id: "00000000-0000-4000-8000-00000000000a", attempts: 0, ...data }; posts.set(r.id, r); return r; },
      updateMany: async ({ where, data }) => { let count = 0; for (const r of posts.values()) if (match(r, where)) { Object.assign(r, data); count++; } return { count }; },
    },
    igConversation: { findMany: async ({ select }) => (select?.leadId && !select.igsid ? [{ leadId: "l1" }, { leadId: "l1" }] : [{ igsid: "1234567890", username: "ayse", state: "handoff", domain: "a.com", leadId: "l1", updatedAt: new Date() }]) },
    igCommentEvent: { count: async () => 4, findMany: async () => [{ commentId: "c1", mediaId: "m1", username: "<b>x</b>", action: "audit_started", handledAt: new Date() }] },
    publicAuditRequest: { count: async ({ where }) => (where.leadId.in.join() === "l1" ? 2 : -1) },
    hashValue: { findMany: async () => [
      { value: JSON.stringify({ inboundWantsContact: true, inboundWantsContactVia: "instagram", inboundWantsContactAt: new Date().toISOString() }) },
      { value: JSON.stringify({ inboundWantsContact: true, inboundWantsContactVia: "instagram", inboundWantsContactAt: "2020-01-01T00:00:00Z" }) },
      { value: "bozuk" },
    ] },
  };
}
const svcWith = (handler, rows) => {
  const f = fakeFetch(handler);
  const prisma = fakePrisma(rows);
  return { svc: new IgPanelService(prisma, { client: handler ? new IgClient(CFG, null, f.fetcher) : null }), calls: f.calls, prisma };
};
const res = () => ({ code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set(k, v) { this.headers[k] = v; return this; } });

describe("Normalizasyon ve kurallar", () => {
  it("profil ve medya: yalnızca https adresler, alanlar kırpılır", () => {
    const p = L.normalizeProfile({ user_id: 1784, username: "im", profile_picture_url: "javascript:alert(1)", website: "https://istanbul.marketing", followers_count: 12, biography: "x".repeat(400) });
    assert.equal(p.id, "1784"); assert.equal(p.picture, null); assert.equal(p.website, "https://istanbul.marketing"); assert.equal(p.followers, 12); assert.equal(p.biography.length, 300);
    const v = L.normalizeMedia({ id: "9", media_type: "VIDEO", media_url: "https://cdn/v.mp4", thumbnail_url: "https://cdn/t.jpg", permalink: "data:text/html,x" });
    assert.deepEqual([v.thumb, v.permalink, v.likes], ["https://cdn/t.jpg", null, null]);
    assert.equal(L.normalizeMedia({ id: "8", media_type: "IMAGE", media_url: "https://cdn/i.jpg" }).thumb, "https://cdn/i.jpg");
  });
  it("zamanlama İstanbul saatiyle; geçmiş ve 90 günden ileri reddedilir", () => {
    const now = new Date("2026-10-15T08:00:00Z");
    assert.equal(L.parseSchedule("2026-10-16T11:00", now).at.toISOString(), "2026-10-16T08:00:00.000Z");
    assert.equal(L.parseSchedule("2026-10-15T10:58", now).ok, true, "5 dk tolerans");
    assert.match(L.parseSchedule("2026-10-15T10:00", now).error, /Geçmiş/);
    assert.match(L.parseSchedule("2027-03-01T10:00", now).error, /90 gün/);
    assert.equal(L.parseSchedule("yarın", now).ok, false);
  });
  it("kuyruk eylemleri: iptal yalnızca queued; şimdi/yeniden zamanla failed/canceled'ı da kuyruğa alır", () => {
    const now = new Date("2026-10-15T08:00:00Z");
    assert.deepEqual(L.queueActionPlan("cancel", null, now).from, ["queued"]);
    const n = L.queueActionPlan("now", null, now);
    assert.deepEqual(n.from, ["queued", "failed", "canceled"]); assert.equal(n.data.scheduledAt, now); assert.equal(n.data.attempts, 0);
    assert.equal(L.queueActionPlan("reschedule", "2026-10-16T09:30", now).data.scheduledAt.toISOString(), "2026-10-16T06:30:00.000Z");
    assert.equal(L.queueActionPlan("reschedule", "2020-01-01T00:00", now).ok, false);
    assert.equal(L.queueActionPlan("delete", null, now).ok, false);
  });
  it("hafta başı İstanbul pazartesi 00:00; EVET kaydı süzgeci", () => {
    assert.equal(L.weekStart(new Date("2026-10-15T08:00:00Z")).toISOString(), "2026-10-11T21:00:00.000Z");
    assert.equal(L.weekStart(new Date("2026-10-11T22:30:00Z")).toISOString(), "2026-10-11T21:00:00.000Z", "pazartesi 01:30 İstanbul");
    const since = new Date("2026-10-08T00:00:00Z");
    assert.equal(L.wantsContactSince(JSON.stringify({ inboundWantsContact: true, inboundWantsContactVia: "instagram", inboundWantsContactAt: "2026-10-10T00:00:00Z" }), since), true);
    assert.equal(L.wantsContactSince(JSON.stringify({ inboundWantsContact: true, inboundWantsContactVia: "web", inboundWantsContactAt: "2026-10-10T00:00:00Z" }), since), false);
    assert.equal(L.wantsContactSince("{", since), false);
  });
});

describe("Oturum", () => {
  it("tüm uçlar oturumsuz 401 döner; yükleme guard'ı dosya alınmadan reddeder", async () => {
    const c = new IgPanelController(new Proxy({}, { get: () => () => { throw new Error("çağrılmamalı"); } }));
    for (const call of [(r) => c.overview({ headers: {} }, r), (r) => c.media({ headers: {} }, r), (r) => c.queue({ headers: {} }, r),
      (r) => c.upload({ headers: {} }, r, null, {}), (r) => c.update({ headers: {} }, r, "x", {}), (r) => c.activity({ headers: {} }, r)]) {
      const r = res(); await call(r); assert.equal(r.code, 401);
    }
    const ctx = (headers) => ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) });
    assert.throws(() => new SessionGuard().canActivate(ctx({})), (e) => e.getStatus() === 401);
    assert.equal(new SessionGuard().canActivate(ctx({ cookie })), true);
  });
  it("oturumla özet döner; Instagram bağlı değilse profil null", async () => {
    const { svc } = svcWith(null);
    const r = res(); await new IgPanelController(svc).overview({ headers: { cookie } }, r);
    assert.equal(r.code, 200);
    assert.equal(r.body.connected, false); assert.equal(r.body.profile, null);
    assert.deepEqual(r.body.kpis, { queued: 0, publishedWeek: 0, dmAnalyses7d: 2, commentTriggers7d: 4, wantsContact7d: 1 });
    const m = res(); await new IgPanelController(svc).media({ headers: { cookie } }, m);
    assert.deepEqual(m.body, { connected: false, items: [], stories: [] });
  });
});

describe("Profil ve gönderiler (sahte fetch)", () => {
  it("profil: kod 100 → temel alanlarla yeniden; 5 dk önbellek; belirteç başlıkta", async () => {
    const { svc, calls } = svcWith((url) => url.includes("biography")
      ? { status: 400, body: { error: { code: 100, message: "Tried accessing nonexisting field (biography)" } } }
      : { status: 200, body: { user_id: "1784", username: "istanbul.marketing", followers_count: 1200, follows_count: 10, media_count: 36, profile_picture_url: "https://cdn/p.jpg" } });
    const p = await svc.profile(false, 1_000);
    assert.equal(p.username, "istanbul.marketing"); assert.equal(p.biography, null);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /^https:\/\/graph\.instagram\.com\/v25\.0\/me\?fields=user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count,biography,website$/);
    assert.equal(calls[1].auth, "Bearer tok-secret"); assert.ok(!calls[1].url.includes("tok-secret"));
    await svc.profile(false, 200_000); assert.equal(calls.length, 2, "önbellekten");
    await svc.profile(false, 1_000 + 5 * 60_000 + 1); assert.equal(calls.length, 4, "süre doldu");
  });
  it("profil hatası özeti bozmaz; hata metninde belirteç yok", async () => {
    const { svc } = svcWith(() => ({ status: 401, body: { error: { code: 190, message: "Invalid OAuth access_token=tok-secret" } } }));
    const o = await svc.overview();
    assert.equal(o.connected, true); assert.equal(o.profile, null);
    assert.match(o.profileError, /kod 190/); assert.ok(!o.profileError.includes("tok-secret"));
  });
  it("medya en fazla 36, sayfalanır; hikâye hatası listeyi bozmaz", async () => {
    const page = (n, from) => Array.from({ length: n }, (_, i) => ({ id: String(from + i), media_type: i === 0 ? "CAROUSEL_ALBUM" : "IMAGE", media_url: `https://cdn/${from + i}.jpg`, permalink: `https://www.instagram.com/p/${from + i}/`, like_count: 3, comments_count: 1 }));
    const { svc, calls } = svcWith((url) => {
      if (url.includes("/me/stories")) return { status: 400, body: { error: { code: 10, message: "izin yok" } } };
      if (url.includes("after=CUR2")) return { status: 200, body: { data: page(11, 25) } };
      if (url.includes("/me/media")) return { status: 200, body: { data: page(25, 0), paging: { cursors: { after: "CUR2" }, next: "https://graph.instagram.com/next" } } };
    });
    const m = await svc.media();
    assert.equal(m.items.length, 36); assert.equal(m.items[0].type, "CAROUSEL_ALBUM"); assert.equal(m.items[35].id, "35");
    assert.deepEqual(m.stories, []); assert.match(m.storiesError, /kod 10/);
    assert.match(calls[0].url, /me\/media\?limit=25&fields=id,caption,media_type,media_product_type,/);
    assert.match(calls[1].url, /limit=11&after=CUR2/);
  });
});

describe("Kuyruk: yükleme ve eylemler", () => {
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const now = new Date("2026-10-15T08:00:00Z");
  it("JPEG kaydedilir ve hikâye kuyruğa eklenir", async () => {
    const { svc, prisma } = svcWith(null);
    const r = await svc.upload({ buffer: JPEG, originalname: "Kampanya Şablon.jpg" }, "2026-10-16T11:00", now);
    assert.equal(r.fileName, "story-20261016-1100-kampanya-sablon.jpg");
    assert.ok(readFileSync(path.join(dir, r.fileName)).equals(JPEG));
    const row = prisma.posts.get(r.id);
    assert.deepEqual([row.kind, row.status, row.scheduledAt.toISOString()], ["story", "queued", "2026-10-16T08:00:00.000Z"]);
    const again = await svc.upload({ buffer: JPEG, originalname: "Kampanya Şablon.jpg" }, "2026-10-16T11:00", now);
    assert.notEqual(again.fileName, r.fileName, "aynı ad üzerine yazılmaz");
    assert.match(again.fileName, /^story-20261016-1100-kampanya-sablon-[0-9a-f]{6}\.jpg$/);
  });
  it("PNG, boş, büyük dosya ve geçmiş tarih reddedilir", async () => {
    const { svc } = svcWith(null);
    const err = async (p, status, re) => { await assert.rejects(p, (e) => e instanceof PanelError && e.status === status && re.test(e.message)); };
    await err(svc.upload({ buffer: PNG }, "2026-10-16T11:00", now), 415, /PNG/);
    await err(svc.upload({ buffer: Buffer.from("GIF89a....") }, "2026-10-16T11:00", now), 415, /JPEG/);
    await err(svc.upload(undefined, "2026-10-16T11:00", now), 400, /seçilmedi/);
    await err(svc.upload({ buffer: Buffer.concat([JPEG, Buffer.alloc(8 * 1024 * 1024)]) }, "2026-10-16T11:00", now), 413, /8 MB/);
    await err(svc.upload({ buffer: JPEG, originalname: "gecmis.jpg" }, "2026-10-14T11:00", now), 400, /Geçmiş/);
    assert.equal(existsSync(path.join(dir, "story-20261014-1100-gecmis.jpg")), false);
  });
  it("iptal / şimdi paylaş / yeniden zamanla; yayında olan satıra dokunulmaz (409)", async () => {
    const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
    const { svc, prisma } = svcWith(null, [
      { id: id(1), status: "queued", attempts: 0, scheduledAt: now },
      { id: id(2), status: "publishing", attempts: 1, scheduledAt: now },
      { id: id(3), status: "failed", attempts: 3, error: "x", scheduledAt: now },
    ]);
    assert.equal((await svc.update(id(1), { action: "cancel" }, now)).status, "canceled");
    await assert.rejects(svc.update(id(2), { action: "cancel" }, now), (e) => e.status === 409 && /publishing/.test(e.message));
    await assert.rejects(svc.update(id(2), { action: "now" }, now), (e) => e.status === 409);
    const r = await svc.update(id(3), { action: "now" }, now);
    assert.deepEqual([r.status, r.attempts, r.error, r.scheduledAt], ["queued", 0, null, now]);
    assert.equal((await svc.update(id(1), { action: "reschedule", scheduledAt: "2026-10-20T09:00" }, now)).scheduledAt.toISOString(), "2026-10-20T06:00:00.000Z");
    await assert.rejects(svc.update(id(1), { action: "reschedule", scheduledAt: "bozuk" }, now), (e) => e.status === 400);
    await assert.rejects(svc.update("../x", { action: "cancel" }, now), (e) => e.status === 404);
    await assert.rejects(svc.update(id(9), { action: "cancel" }, now), (e) => e.status === 404);
    assert.equal(prisma.posts.get(id(2)).status, "publishing");
  });
  it("kuyruk listesi: görsel yolu göreli, yayınlananın permalink'i alınır ve önbelleğe girer", async () => {
    const { svc, calls } = svcWith((url) => url.includes("/555?fields=permalink") ? { status: 200, body: { permalink: "https://www.instagram.com/stories/im/555/" } } : null, [
      { id: "a", kind: "story", fileName: "story-a.jpg", status: "published", mediaId: "555", scheduledAt: now },
      { id: "b", kind: "story", fileName: "../bad.jpg", status: "queued", mediaId: null, scheduledAt: now },
    ]);
    const q = await svc.queue();
    assert.equal(q.items[0].imageUrl, "/api/public/ig-media/story-a.jpg");
    assert.equal(q.items[0].permalink, "https://www.instagram.com/stories/im/555/");
    assert.equal(q.items[1].imageUrl, null);
    await svc.queue(); assert.equal(calls.length, 1, "permalink önbellekten");
  });
  it("etkinlik: IGSID tam olarak dönmez", async () => {
    const { svc } = svcWith(null);
    const a = await svc.activity();
    assert.equal(a.conversations[0].id, "567890"); assert.equal(a.conversations[0].igsid, undefined);
    assert.equal(a.comments[0].username, "<b>x</b>", "ham veri; panel kaçışlar");
  });
});
