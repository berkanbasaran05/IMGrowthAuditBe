// Zamanlanmış içerik türleri (hikâye, gönderi, karusel, Reels): doğrulama, yayın akışları (sahte fetch), Reels'te turlar
// arası uzun yoklama, kota, panel yükleme/düzenleme/yeniden deneme kuralları ve video ucu (Range).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import express from "express";

process.env.SESSION_SECRET ||= "x".repeat(40);
process.env.ADMIN_PASSWORD ||= "Test-Parola-2026!";
const dir = mkdtempSync(path.join(os.tmpdir(), "ig-content-"));
process.env.IG_MEDIA_DIR = dir;
process.env.PUBLIC_REPORT_BASE_URL = "https://customer.istanbul.marketing";

const load = (p) => import(`../.test-build/modules/${p}.js`).then((m) => m.default ?? m);
const L = await load("instagram/ig-publisher.logic");
const P = await load("instagram/ig-panel.logic");
const { IgClient } = await load("instagram/instagram.client");
const { IgPublisherService } = await load("instagram/ig-publisher.service");
const { IgPanelService, PanelError } = await load("instagram/ig-panel.service");
const { IgMediaController } = await load("instagram/ig-media.controller");

// En küçük geçerli JPEG başlığı: SOI + APP0 + SOF0 (boyutlu) + EOI.
function jpeg(width, height, pad = 0) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(pad), Buffer.from([0xff, 0xd9])]);
}
const mp4 = (brand = "isom") => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftyp" + brand, "latin1"), Buffer.alloc(200)]);
const NOW = new Date("2026-10-15T08:00:00Z");
const AT = "2026-10-16T11:00";

describe("Doğrulama", () => {
  it("dosya adı mp4/mov kabul eder; içerik türleri doğru", () => {
    for (const ok of ["reels-20261016-1100-a.mp4", "story-x.mov"]) assert.equal(L.isValidMediaFile(ok), true, ok);
    for (const bad of ["a.MP4", "a.mkv", "../a.mp4", "a.mp4.jpg/x"]) assert.equal(L.isValidMediaFile(bad), false, bad);
    assert.equal(L.contentTypeFor("a.mp4"), "video/mp4");
    assert.equal(L.contentTypeFor("a.mov"), "video/quicktime");
    assert.equal(L.contentTypeFor("a.jpg"), "image/jpeg");
  });
  it("açıklama: hikâyede yok; 2200 karakter, 30 hashtag, 20 @etiket", () => {
    assert.deepEqual(L.validateCaption("story", ""), { ok: true, value: null });
    assert.equal(L.validateCaption("story", "merhaba").ok, false);
    assert.equal(L.validateCaption("image", "  Yeni ürün\r\n#istanbul  ").value, "Yeni ürün\n#istanbul");
    assert.equal(L.validateCaption("reels", "ğ".repeat(2200)).ok, true, "karakter sayısı kod noktası ile");
    assert.match(L.validateCaption("reels", "a".repeat(2201)).error, /2200/);
    const tags = (n) => Array.from({ length: n }, (_, i) => `#etiket${i}`).join(" ");
    assert.equal(L.validateCaption("carousel", tags(30)).ok, true);
    assert.match(L.validateCaption("carousel", tags(31)).error, /30 hashtag/);
    assert.equal(L.countHashtags("a#b c&#39; #çay #1"), 2, "kelime içi # ve HTML varlığı sayılmaz");
    assert.match(L.validateCaption("image", Array.from({ length: 21 }, (_, i) => `@k${i}`).join(" ")).error, /@etiket/);
    assert.equal(L.validateCaption("image", 5).ok, false);
  });
  it("tür başına dosya kümesi", () => {
    assert.equal(L.validateMediaSet("story", ["a.jpg"]), null);
    assert.equal(L.validateMediaSet("story", ["a.mp4"]), null);
    assert.match(L.validateMediaSet("story", ["a.jpg", "b.jpg"]), /tek/);
    assert.equal(L.validateMediaSet("image", ["a.jpg"]), null);
    assert.match(L.validateMediaSet("image", ["a.mp4"]), /JPEG/);
    assert.equal(L.validateMediaSet("reels", ["a.mov"]), null);
    assert.match(L.validateMediaSet("reels", ["a.jpg"]), /video/);
    assert.match(L.validateMediaSet("carousel", ["a.jpg"]), /2–10/);
    assert.equal(L.validateMediaSet("carousel", Array.from({ length: 10 }, (_, i) => `a${i}.jpg`)), null);
    assert.match(L.validateMediaSet("carousel", Array.from({ length: 11 }, (_, i) => `a${i}.jpg`)), /2–10/);
    assert.match(L.validateMediaSet("carousel", ["a.jpg", "b.mp4"]), /JPEG/);
    assert.match(L.validateMediaSet("image", ["a.png"]), /JPEG/);
    assert.deepEqual(L.rowFiles({ fileName: "a.jpg", mediaFiles: null }), ["a.jpg"]);
    assert.deepEqual(L.rowFiles({ fileName: "a.jpg", mediaFiles: ["a.jpg", "b.jpg"] }), ["a.jpg", "b.jpg"]);
  });
  it("içerik koklama: JPEG boyutu, akış oranı 4:5–1.91:1, MP4/MOV", () => {
    assert.deepEqual(L.jpegSize(jpeg(1080, 1350)), { width: 1080, height: 1350 });
    assert.equal(L.feedRatioError(L.jpegSize(jpeg(1080, 1350))), null, "4:5");
    assert.equal(L.feedRatioError(L.jpegSize(jpeg(1440, 754))), null, "1.91:1");
    assert.match(L.feedRatioError(L.jpegSize(jpeg(1080, 1920))), /dikey/);
    assert.match(L.feedRatioError(L.jpegSize(jpeg(2000, 1000))), /yatay/);
    assert.equal(L.videoExt(mp4()), "mp4");
    assert.equal(L.videoExt(mp4("qt  ")), "mov");
    assert.equal(L.videoExt(jpeg(10, 10)), null);
    assert.equal(L.mediaFileName("reels", "Tanıtım Videosu.MOV", L.zonedToUtc(AT, "Europe/Istanbul"), "Europe/Istanbul", "mov"), "reels-20261016-1100-tanitim-videosu.mov");
  });
  it("düzenleme sırası: mevcut ad ya da yeni dosya indeksi", () => {
    assert.deepEqual(P.parseOrder('["n:0","f:a.jpg"]', ["a.jpg"], 1).order, [{ neu: 0 }, { old: "a.jpg" }]);
    assert.equal(P.parseOrder('["f:b.jpg"]', ["a.jpg"], 0).ok, false, "satıra ait olmayan ad");
    assert.equal(P.parseOrder('["n:1"]', [], 1).ok, false);
    assert.equal(P.parseOrder('["n:0","n:0"]', [], 1).ok, false);
    assert.equal(P.parseOrder("{", [], 0).ok, false);
  });
  it("yeniden dene yalnızca başarısız içerikte; zamanı şimdi olur", () => {
    const r = P.queueActionPlan("retry", null, NOW);
    assert.deepEqual(r.from, ["failed"]); assert.equal(r.data.scheduledAt, NOW); assert.equal(r.data.attempts, 0);
  });
});

// ---- Yayın akışları ----
const CFG = { appSecret: "s", verifyToken: "v", accessToken: "tok-secret", accountId: "1784", version: "v25.0" };
function publisher(handler, { quota } = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    if (url.includes("content_publishing_limit")) return { ok: true, status: 200, json: async () => ({ data: [{ quota_usage: quota ?? 3, config: { quota_total: 50, quota_duration: 86400 } }] }) };
    const r = handler(url, init, calls) || { status: 500, body: { error: { code: 1, message: "beklenmeyen" } } };
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  const rows = new Map();
  const prisma = { igScheduledPost: { update: async ({ where, data }) => Object.assign(rows.get(where.id), data) } };
  const svc = new IgPublisherService(prisma, { client: new IgClient(CFG, null, fetcher) });
  const sleeps = [];
  svc.sleep = async (ms) => { sleeps.push(ms); };
  const add = (over) => { const r = { id: "r1", containerId: null, childIds: null, containerCreatedAt: null, attempts: 1, scheduledAt: NOW, status: "publishing", caption: null, coverFile: null, ...over }; rows.set(r.id, r); return r; };
  const creates = () => calls.filter((c) => c.method === "POST" && c.url.endsWith("/1784/media")).map((c) => c.body);
  return { svc, calls, rows, add, sleeps, creates };
}
const write = (name, buf) => writeFileSync(path.join(dir, name), buf);
write("image-20261016-1100-a.jpg", jpeg(1080, 1350));
write("carousel-20261016-1100-a.jpg", jpeg(1080, 1080));
write("carousel-20261016-1100-a-2.jpg", jpeg(1080, 1080));
write("carousel-20261016-1100-a-3.jpg", jpeg(1080, 1080));
write("reels-20261016-1100-v.mp4", mp4());
write("cover-20261016-1100-k.jpg", jpeg(1080, 1920));
write("story-20261016-1100-v.mov", mp4("qt  "));
const BASE = "https://customer.istanbul.marketing/api/public/ig-media/";
const ok = (body) => ({ status: 200, body });
const statusIs = (code) => (url, init) => (init.method || "GET") === "GET" && url.includes("fields=status_code") ? ok({ status_code: typeof code === "function" ? code(url) : code }) : null;

describe("Yayın akışları (sahte fetch)", () => {
  it("gönderi: image_url + caption, media_type yok", async () => {
    const p = publisher((url, init) => init.method === "POST" && url.endsWith("/1784/media") ? ok({ id: "c1" }) : url.endsWith("/media_publish") ? ok({ id: "m1" }) : statusIs("FINISHED")(url, init));
    const row = p.add({ kind: "image", fileName: "image-20261016-1100-a.jpg", mediaFiles: ["image-20261016-1100-a.jpg"], caption: "Yeni sezon #istanbul" });
    assert.equal(await p.svc.processRow(row, NOW), "published");
    assert.deepEqual(p.creates(), [{ image_url: BASE + "image-20261016-1100-a.jpg", caption: "Yeni sezon #istanbul" }]);
    assert.deepEqual([row.status, row.mediaId], ["published", "m1"]);
  });
  it("hikâye videosu: media_type STORIES + video_url", async () => {
    const p = publisher((url, init) => init.method === "POST" && url.endsWith("/1784/media") ? ok({ id: "c2" }) : url.endsWith("/media_publish") ? ok({ id: "m2" }) : statusIs("FINISHED")(url, init));
    const row = p.add({ kind: "story", fileName: "story-20261016-1100-v.mov" });
    assert.equal(await p.svc.processRow(row, NOW), "published");
    assert.deepEqual(p.creates(), [{ media_type: "STORIES", video_url: BASE + "story-20261016-1100-v.mov" }]);
  });
  it("karusel: önce is_carousel_item öğeleri, sonra CAROUSEL (children virgüllü) + caption; öğeler saklanır", async () => {
    let n = 0;
    const p = publisher((url, init) => {
      if (init.method === "POST" && url.endsWith("/1784/media")) { const b = JSON.parse(init.body); return ok({ id: b.media_type === "CAROUSEL" ? "parent" : `ch${++n}` }); }
      if (url.endsWith("/media_publish")) return ok({ id: "m3" });
      return statusIs("FINISHED")(url, init);
    });
    const files = ["carousel-20261016-1100-a.jpg", "carousel-20261016-1100-a-2.jpg", "carousel-20261016-1100-a-3.jpg"];
    const row = p.add({ kind: "carousel", fileName: files[0], mediaFiles: files, caption: "3 görsel" });
    assert.equal(await p.svc.processRow(row, NOW), "published");
    const c = p.creates();
    assert.deepEqual(c.slice(0, 3), files.map((f) => ({ image_url: BASE + f, is_carousel_item: true })));
    assert.deepEqual(c[3], { media_type: "CAROUSEL", children: "ch1,ch2,ch3", caption: "3 görsel" });
    assert.deepEqual(row.childIds, ["ch1", "ch2", "ch3"]);
    assert.equal(p.calls.find((x) => x.url.endsWith("/media_publish")).body.creation_id, "parent");
  });
  it("karusel: ana kapsayıcı hata verirse sonraki denemede öğeler yeniden oluşturulur; öğeler hazırsa tekrar kullanılır", async () => {
    let fail = true, n = 0;
    const p = publisher((url, init) => {
      if (init.method === "POST" && url.endsWith("/1784/media")) {
        const b = JSON.parse(init.body);
        if (b.media_type === "CAROUSEL") return fail ? { status: 400, body: { error: { code: 100, message: "child expired" } } } : ok({ id: "parent" });
        return ok({ id: `ch${++n}` });
      }
      if (url.endsWith("/media_publish")) return ok({ id: "m4" });
      return statusIs("FINISHED")(url, init);
    });
    const files = ["carousel-20261016-1100-a.jpg", "carousel-20261016-1100-a-2.jpg"];
    const row = p.add({ kind: "carousel", fileName: files[0], mediaFiles: files });
    assert.equal(await p.svc.processRow(row, NOW), "queued");
    assert.equal(row.childIds, null, "bozuk öğeler bırakıldı");
    // Öğeler saklıysa (ör. süreç ana kapsayıcıdan önce çöktü) yeniden oluşturulmaz.
    fail = false;
    const row2 = p.add({ id: "r2", kind: "carousel", fileName: files[0], mediaFiles: files, childIds: ["x1", "x2"] });
    const before = p.creates().length;
    assert.equal(await p.svc.processRow(row2, NOW), "published");
    assert.deepEqual(p.creates().slice(before), [{ media_type: "CAROUSEL", children: "x1,x2" }]);
  });
  it("Reels: REELS + video_url + share_to_feed + caption + cover_url; turlar arası uzun yoklama, deneme hakkı tüketilmez", async () => {
    let ready = false;
    const p = publisher((url, init) => {
      if (init.method === "POST" && url.endsWith("/1784/media")) return ok({ id: "rc" });
      if (url.endsWith("/media_publish")) return ok({ id: "rm" });
      return statusIs(() => (ready ? "FINISHED" : "IN_PROGRESS"))(url, init);
    });
    const row = p.add({ kind: "reels", fileName: "reels-20261016-1100-v.mp4", mediaFiles: ["reels-20261016-1100-v.mp4"], caption: "Reels", coverFile: "cover-20261016-1100-k.jpg", attempts: 1 });
    assert.equal(await p.svc.processRow(row, NOW), "processing");
    assert.deepEqual(p.creates(), [{ media_type: "REELS", video_url: BASE + "reels-20261016-1100-v.mp4", share_to_feed: true, caption: "Reels", cover_url: BASE + "cover-20261016-1100-k.jpg" }]);
    assert.deepEqual([row.status, row.attempts, row.containerId], ["queued", 0, "rc"]);
    assert.equal(row.containerCreatedAt.toISOString(), NOW.toISOString());
    // 10 tur boyunca işleniyor: her turda claim +1, işçi geri verir → deneme sayısı artmaz, yeni kapsayıcı açılmaz.
    for (let i = 1; i <= 10; i++) {
      const t = new Date(NOW.getTime() + i * 60_000);
      row.attempts += 1;
      assert.equal(await p.svc.processRow({ ...row }, t), "processing");
      assert.equal(row.attempts, 0);
      assert.equal(row.nextAttemptAt.toISOString(), new Date(t.getTime() + 60_000).toISOString());
    }
    assert.equal(p.creates().length, 1);
    assert.ok(p.sleeps.every((ms) => ms <= 10_000), "tek turda uzun bekleme yok");
    ready = true; row.attempts += 1;
    assert.equal(await p.svc.processRow({ ...row }, new Date(NOW.getTime() + 11 * 60_000)), "published");
    assert.equal(row.mediaId, "rm");
  });
  it("Reels: 30 dk içinde hazır olmazsa kapsayıcı bırakılır ve hata sayılır", async () => {
    const p = publisher((url, init) => statusIs("IN_PROGRESS")(url, init));
    const row = p.add({ kind: "reels", fileName: "reels-20261016-1100-v.mp4", containerId: "old", containerCreatedAt: new Date(NOW.getTime() - 31 * 60_000), attempts: 1 });
    assert.equal(await p.svc.processRow(row, NOW), "queued");
    assert.equal(row.containerId, null);
    assert.match(row.error, /30 dakikada hazır olmadı/);
    assert.equal(row.nextAttemptAt.toISOString(), new Date(NOW.getTime() + 5 * 60_000).toISOString());
  });
  it("yayın kotası doluysa kapsayıcı açılmaz; 30 dk sonra yeniden denenir, hak tüketilmez", async () => {
    const p = publisher(() => null, { quota: 50 });
    const row = p.add({ kind: "image", fileName: "image-20261016-1100-a.jpg", attempts: 2 });
    assert.equal(await p.svc.processRow(row, NOW), "processing");
    assert.equal(p.creates().length, 0);
    assert.deepEqual([row.status, row.attempts], ["queued", 1]);
    assert.match(row.error, /kotası dolu \(50\/50/);
    assert.equal(row.nextAttemptAt.toISOString(), new Date(NOW.getTime() + 30 * 60_000).toISOString());
  });
  it("tür/dosya uyumsuzluğu ve büyük dosya Meta'ya gitmeden failed", async () => {
    const p = publisher(() => null);
    const a = p.add({ id: "a", kind: "image", fileName: "reels-20261016-1100-v.mp4" });
    assert.equal(await p.svc.processRow(a, NOW), "failed"); assert.match(a.error, /JPEG/);
    write("image-big.jpg", jpeg(10, 10, 8 * 1024 * 1024));
    const b = p.add({ id: "b", kind: "image", fileName: "image-big.jpg" });
    assert.equal(await p.svc.processRow(b, NOW), "failed"); assert.match(b.error, /8 MB/);
    assert.equal(p.creates().length, 0);
  });
});

// ---- Panel: yükleme, düzenleme, yeniden deneme ----
function fakePrisma(rows = []) {
  const posts = new Map(rows.map((r) => [r.id, { ...r }]));
  let seq = 0;
  const match = (r, where) => Object.entries(where).every(([k, v]) => {
    if (k === "OR") return v.some((w) => match(r, w));
    if (k === "mediaFiles") return Array.isArray(r.mediaFiles) && v.array_contains.every((x) => r.mediaFiles.includes(x));
    if (v && typeof v === "object" && "in" in v) return v.in.includes(r[k]);
    if (v && typeof v === "object" && "not" in v) return r[k] !== v.not;
    return r[k] === v;
  });
  return {
    posts,
    igScheduledPost: {
      findUnique: async ({ where }) => (posts.has(where.id) ? { ...posts.get(where.id) } : null),
      findMany: async () => [...posts.values()],
      count: async ({ where }) => [...posts.values()].filter((r) => match(r, where)).length,
      create: async ({ data }) => { const r = { id: `00000000-0000-4000-8000-0000000001${String(++seq).padStart(2, "0")}`, attempts: 0, ...data }; posts.set(r.id, r); return r; },
      updateMany: async ({ where, data }) => { let count = 0; for (const r of posts.values()) if (match(r, where)) { Object.assign(r, data); count++; } return { count }; },
    },
  };
}
const panel = (rows) => { const prisma = fakePrisma(rows); return { svc: new IgPanelService(prisma, { client: null }), prisma }; };
const up = (buffer, originalname = "dosya") => ({ buffer, originalname });
const rejects = (p, status, re) => assert.rejects(p, (e) => e instanceof PanelError && e.status === status && re.test(e.message));

describe("Panel: içerik oluşturma", () => {
  it("gönderi: JPEG 4:5 + açıklama kaydedilir", async () => {
    const { svc, prisma } = panel();
    const r = await svc.create({ kind: "image", caption: "Merhaba #istanbul", scheduledAt: AT }, { files: [up(jpeg(1080, 1350), "Ürün Fotoğrafı.jpg")] }, NOW);
    const row = prisma.posts.get(r.id);
    assert.deepEqual([row.kind, row.caption, row.fileName, row.mediaFiles], ["image", "Merhaba #istanbul", "image-20261016-1100-urun-fotografi.jpg", ["image-20261016-1100-urun-fotografi.jpg"]]);
    assert.ok(existsSync(path.join(dir, row.fileName)));
  });
  it("karusel: sıra korunur, adlar benzersiz; 1 görsel ya da 9:16 görsel reddedilir", async () => {
    const { svc, prisma } = panel();
    const r = await svc.create({ kind: "carousel", caption: "", scheduledAt: AT }, { files: [up(jpeg(1080, 1080), "a.jpg"), up(jpeg(1080, 1080), "b.jpg"), up(jpeg(1080, 1080), "c.jpg")] }, NOW);
    const names = prisma.posts.get(r.id).mediaFiles;
    assert.equal(names.length, 3);
    assert.match(names[0], /^carousel-20261016-1100-a(-[0-9a-f]{6})?\.jpg$/);
    assert.equal(names[1], "carousel-20261016-1100-b-2.jpg");
    assert.equal(names[2], "carousel-20261016-1100-c-3.jpg");
    assert.equal(prisma.posts.get(r.id).caption, null);
    await rejects(svc.create({ kind: "carousel", scheduledAt: AT }, { files: [up(jpeg(1080, 1080))] }, NOW), 400, /2–10/);
    const before = readdirSync(dir).length;
    await rejects(svc.create({ kind: "carousel", scheduledAt: AT }, { files: [up(jpeg(1080, 1080)), up(jpeg(1080, 1920))] }, NOW), 422, /dikey/);
    assert.equal(readdirSync(dir).length, before, "yarım kalan dosya bırakılmaz");
  });
  it("Reels: MP4 + kapak; diskten yükleme bağlanır ve geçici dosya silinir", async () => {
    const tmp = path.join(dir, ".upload-tmp"); (await import("node:fs")).mkdirSync(tmp, { recursive: true });
    const vid = path.join(tmp, "up-1"), cov = path.join(tmp, "up-2");
    writeFileSync(vid, mp4()); writeFileSync(cov, jpeg(1080, 1920));
    const { svc, prisma } = panel();
    const r = await svc.create({ kind: "reels", caption: "İlk Reels", scheduledAt: AT }, { files: [{ path: vid, size: 224, originalname: "Tanıtım.mp4" }], cover: [{ path: cov, size: 50, originalname: "kapak.jpg" }] }, NOW);
    const row = prisma.posts.get(r.id);
    assert.equal(row.fileName, "reels-20261016-1100-tanitim.mp4");
    assert.match(row.coverFile, /^cover-20261016-1100-kapak\.jpg$/);
    assert.ok(existsSync(path.join(dir, row.fileName)) && existsSync(path.join(dir, row.coverFile)));
    assert.equal(existsSync(vid) || existsSync(cov), false, "geçici dosyalar silindi");
  });
  it("tür kuralları: hikâyede açıklama yok, gönderide video yok, Reels'te görsel yok, boyut sınırları", async () => {
    const { svc } = panel();
    await rejects(svc.create({ kind: "story", caption: "x", scheduledAt: AT }, { files: [up(jpeg(1080, 1920))] }, NOW), 400, /açıklama/);
    await rejects(svc.create({ kind: "image", scheduledAt: AT }, { files: [up(mp4())] }, NOW), 415, /JPEG/);
    await rejects(svc.create({ kind: "reels", scheduledAt: AT }, { files: [up(jpeg(1080, 1920))] }, NOW), 400, /video/);
    await rejects(svc.create({ kind: "image", caption: "a".repeat(2201), scheduledAt: AT }, { files: [up(jpeg(1080, 1080))] }, NOW), 400, /2200/);
    await rejects(svc.create({ kind: "tiktok", scheduledAt: AT }, { files: [up(jpeg(1080, 1080))] }, NOW), 400, /tür/);
    await rejects(svc.create({ kind: "image", scheduledAt: AT }, { cover: [up(jpeg(10, 10))] }, NOW), 400, /seçilmedi/);
    await rejects(svc.create({ kind: "image", scheduledAt: AT }, { files: [up(jpeg(1080, 1080))], cover: [up(jpeg(10, 10))] }, NOW), 400, /Kapak/);
    const big = path.join(dir, "big.bin"); writeFileSync(big, mp4());
    await rejects(svc.create({ kind: "story", scheduledAt: AT }, { files: [{ path: big, size: 101 * 1024 * 1024 }] }, NOW), 413, /100 MB/);
    writeFileSync(big, mp4());
    await rejects(svc.create({ kind: "reels", scheduledAt: AT }, { files: [{ path: big, size: 301 * 1024 * 1024 }] }, NOW), 413, /300 MB/);
    const s = await svc.create({ kind: "story", scheduledAt: AT }, { files: [up(mp4("qt  "), "Kısa.mov")] }, NOW);
    assert.equal(s.fileName, "story-20261016-1100-kisa.mov");
  });
});

describe("Panel: düzenleme ve yeniden deneme", () => {
  const id = (n) => `00000000-0000-4000-8000-00000000020${n}`;
  it("açıklama ve zaman düzenlenir; kapsayıcı sıfırlanır", async () => {
    const { svc, prisma } = panel([{ id: id(1), kind: "image", status: "queued", fileName: "image-20261016-1100-a.jpg", mediaFiles: ["image-20261016-1100-a.jpg"], caption: "eski", scheduledAt: NOW, containerId: "c9", attempts: 0 }]);
    const r = await svc.edit(id(1), { action: "edit", caption: "yeni #etiket", scheduledAt: "2026-10-17T19:00" }, undefined, NOW);
    assert.deepEqual([r.caption, r.scheduledAt.toISOString(), r.containerId], ["yeni #etiket", "2026-10-17T16:00:00.000Z", null]);
    assert.equal(prisma.posts.get(id(1)).fileName, "image-20261016-1100-a.jpg", "medya değişmedi");
    await rejects(svc.edit(id(1), { action: "edit", caption: "#a ".repeat(31) }, undefined, NOW), 400, /hashtag/);
    await rejects(svc.edit(id(1), { action: "edit" }, undefined, NOW), 400, /Değişiklik yok/);
  });
  it("karusel medyası: yeniden sıralama + yeni görsel; çıkarılan dosya silinir (başka satır kullanmıyorsa)", async () => {
    write("carousel-e-1.jpg", jpeg(1080, 1080)); write("carousel-e-2.jpg", jpeg(1080, 1080)); write("carousel-e-3.jpg", jpeg(1080, 1080));
    const { svc, prisma } = panel([
      { id: id(2), kind: "carousel", status: "queued", fileName: "carousel-e-1.jpg", mediaFiles: ["carousel-e-1.jpg", "carousel-e-2.jpg", "carousel-e-3.jpg"], scheduledAt: NOW, attempts: 0 },
      { id: id(3), kind: "image", status: "published", fileName: "carousel-e-3.jpg", scheduledAt: NOW, attempts: 1 },
    ]);
    const r = await svc.edit(id(2), { action: "edit", order: JSON.stringify(["f:carousel-e-2.jpg", "n:0", "f:carousel-e-1.jpg"]) }, { files: [up(jpeg(1080, 1080), "yeni.jpg")] }, NOW);
    assert.equal(r.mediaFiles.length, 3);
    assert.equal(r.mediaFiles[0], "carousel-e-2.jpg"); assert.equal(r.mediaFiles[2], "carousel-e-1.jpg");
    assert.equal(r.mediaFiles[1], "carousel-20261015-1100-yeni-2.jpg", "zaman satırdan (İstanbul 11:00), sıra 2");
    assert.equal(r.fileName, "carousel-e-2.jpg");
    assert.ok(existsSync(path.join(dir, "carousel-e-3.jpg")), "başka satır kullanıyor → silinmez");
    await svc.edit(id(2), { action: "edit", order: JSON.stringify(["f:carousel-e-2.jpg", "f:" + r.mediaFiles[1]]) }, undefined, NOW);
    assert.equal(existsSync(path.join(dir, "carousel-e-1.jpg")), false, "çıkarılan dosya silindi");
    await rejects(svc.edit(id(2), { action: "edit", order: JSON.stringify(["f:carousel-e-2.jpg"]) }, undefined, NOW), 400, /2–10/);
    assert.equal(prisma.posts.get(id(2)).mediaFiles.length, 2);
  });
  it("yalnızca sıradaki içerik düzenlenir; başarısız olan 'retry' ile kuyruğa döner", async () => {
    const { svc, prisma } = panel([
      { id: id(4), kind: "image", status: "failed", fileName: "image-20261016-1100-a.jpg", error: "x", attempts: 3, scheduledAt: new Date("2026-10-14T08:00:00Z") },
      { id: id(5), kind: "image", status: "publishing", fileName: "image-20261016-1100-a.jpg", attempts: 1, scheduledAt: NOW },
      { id: id(6), kind: "image", status: "queued", fileName: "image-20261016-1100-a.jpg", attempts: 0, scheduledAt: NOW },
    ]);
    await rejects(svc.edit(id(4), { action: "edit", caption: "x" }, undefined, NOW), 409, /sıradaki/);
    await rejects(svc.edit(id(5), { action: "edit", caption: "x" }, undefined, NOW), 409, /sıradaki/);
    await rejects(svc.update(id(6), { action: "retry" }, NOW), 409, /queued/);
    const r = await svc.update(id(4), { action: "retry" }, NOW);
    assert.deepEqual([r.status, r.attempts, r.error, r.scheduledAt], ["queued", 0, null, NOW]);
    assert.equal(prisma.posts.get(id(5)).status, "publishing");
  });
  it("kuyruk listesi: dosyalar türüyle, kapak, işleniyor bayrağı", async () => {
    const { svc } = panel([{ id: id(7), kind: "reels", status: "queued", fileName: "reels-20261016-1100-v.mp4", mediaFiles: ["reels-20261016-1100-v.mp4"], coverFile: "cover-20261016-1100-k.jpg", containerId: "rc", caption: "c", scheduledAt: new Date(Date.now() - 60_000), attempts: 0 }]);
    const q = await svc.queue();
    const x = q.items[0];
    assert.deepEqual(x.files, [{ name: "reels-20261016-1100-v.mp4", url: "/api/public/ig-media/reels-20261016-1100-v.mp4", type: "video" }]);
    assert.equal(x.coverUrl, "/api/public/ig-media/cover-20261016-1100-k.jpg");
    assert.equal(x.imageUrl, x.coverUrl);
    assert.equal(x.processing, true);
    assert.equal(x.caption, "c");
  });
});

describe("Medya ucu (gerçek express): video türü ve Range", () => {
  it("mp4 206 Partial Content + video/mp4; mov video/quicktime; jpg davranışı aynı", async () => {
    const app = express();
    const c = new IgMediaController();
    app.get("/api/public/ig-media/:file", (req, res) => c.file(req.params.file, res));
    const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const port = server.address().port;
    const get = (p, headers = {}) => new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path: p, headers }, (res) => { const chunks = []; res.on("data", (d) => chunks.push(d)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); }).on("error", reject);
    });
    try {
      const r = await get("/api/public/ig-media/reels-20261016-1100-v.mp4", { Range: "bytes=0-9" });
      assert.equal(r.status, 206);
      assert.equal(r.headers["content-type"], "video/mp4");
      assert.equal(r.headers["content-range"], "bytes 0-9/212");
      assert.equal(r.headers["accept-ranges"], "bytes");
      assert.equal(r.body.length, 10);
      assert.equal(r.headers["cache-control"], "public, max-age=86400");
      const m = await get("/api/public/ig-media/story-20261016-1100-v.mov");
      assert.equal(m.status, 200); assert.equal(m.headers["content-type"], "video/quicktime");
      const j = await get("/api/public/ig-media/image-20261016-1100-a.jpg");
      assert.equal(j.status, 200); assert.equal(j.headers["content-type"], "image/jpeg");
      assert.equal((await get("/api/public/ig-media/.upload-tmp")).status, 404);
      assert.equal((await get("/api/public/ig-media/a.mkv")).status, 404);
    } finally { server.close(); }
  });
});
