// Instagram DM analiz botu testleri: imza, webhook doğrulama, ayrıştırma, niyet, durum makinesi, mesaj bölme, servis akışı.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";

const load = (p) => import(`../.test-build/modules/${p}.js`).then((m) => m.default ?? m);
const L = await load("instagram/instagram.logic");
const { IgClient } = await load("instagram/instagram.client");
const { InstagramService } = await load("instagram/instagram.service");
const { InstagramController } = await load("instagram/instagram.controller");

const ENV = { IG_APP_SECRET: "s3cret", IG_VERIFY_TOKEN: "vtok", IG_ACCESS_TOKEN: "tok", IG_ACCOUNT_ID: "1784", IG_GRAPH_VERSION: "v25.0" };
const sign = (raw, secret = "s3cret") => "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
const dm = (text, over = {}) => ({ object: "instagram", entry: [{ id: "1784", time: 1, messaging: [{ sender: { id: "555" }, recipient: { id: "1784" }, timestamp: 1, message: { mid: "m-" + Math.random(), text, ...over } }] }] });

describe("İmza ve webhook doğrulama", () => {
  it("X-Hub-Signature-256 ham gövde üzerinden doğrulanır", () => {
    const raw = Buffer.from(JSON.stringify(dm("analiz")));
    assert.equal(L.verifySignature(raw, sign(raw), "s3cret"), true);
    assert.equal(L.verifySignature(raw, sign(raw, "baska"), "s3cret"), false);
    assert.equal(L.verifySignature(Buffer.from(raw.toString() + " "), sign(raw), "s3cret"), false);
    assert.equal(L.verifySignature(raw, undefined, "s3cret"), false);
    assert.equal(L.verifySignature(raw, "sha1=abc", "s3cret"), false);
    assert.equal(L.verifySignature(undefined, sign(raw), "s3cret"), false);
  });
  it("hub.challenge yalnızca doğru belirteçle döner", () => {
    assert.equal(L.verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "vtok", "hub.challenge": "12345" }, "vtok"), "12345");
    assert.equal(L.verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "yanlis", "hub.challenge": "12345" }, "vtok"), null);
    assert.equal(L.verifyChallenge({ "hub.mode": "unsubscribe", "hub.verify_token": "vtok", "hub.challenge": "1" }, "vtok"), null);
    assert.equal(L.verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "vtok", "hub.challenge": "<script>" }, "vtok"), null);
  });
  it("controller: env yoksa kapalı, varsa imzayı denetler", () => {
    const saved = { ...process.env };
    const res = () => ({ code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }, type() { return this; } });
    let handled = 0;
    const ctrl = new InstagramController({ handleWebhook: async () => { handled++; } });
    for (const k of Object.keys(ENV)) delete process.env[k];
    let r = res(); ctrl.receive({ headers: {}, rawBody: Buffer.from("{}"), body: {} }, r); assert.equal(r.code, 404);
    Object.assign(process.env, ENV);
    r = res(); ctrl.verify({ query: { "hub.mode": "subscribe", "hub.verify_token": "vtok", "hub.challenge": "42" } }, r); assert.deepEqual([r.code, r.body], [200, "42"]);
    r = res(); ctrl.verify({ query: { "hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "42" } }, r); assert.equal(r.code, 403);
    const raw = Buffer.from(JSON.stringify(dm("analiz")));
    r = res(); ctrl.receive({ headers: { "x-hub-signature-256": sign(raw, "x") }, rawBody: raw, body: {} }, r); assert.equal(r.code, 401);
    r = res(); ctrl.receive({ headers: { "x-hub-signature-256": sign(raw) }, rawBody: raw, body: {} }, r); assert.equal(r.code, 200);
    process.env = saved;
  });
});

describe("Webhook ayrıştırma", () => {
  it("normal mesaj ve hızlı yanıt alınır", () => {
    const [m] = L.parseWebhook(dm("Analiz"), "1784");
    assert.equal(m.igsid, "555"); assert.equal(m.text, "Analiz");
    const [q] = L.parseWebhook(dm("EVET", { quick_reply: { payload: "IM_YES" } }), "1784");
    assert.equal(q.quickReply, "IM_YES");
  });
  it("yankı, kendi mesajı, tepki, okundu ve metinsiz olaylar atlanır", () => {
    assert.equal(L.parseWebhook(dm("x", { is_echo: true }), "1784").length, 0);
    assert.equal(L.parseWebhook(dm("x", { is_self: true }), "1784").length, 0);
    const own = dm("x"); own.entry[0].messaging[0].sender.id = "1784";
    assert.equal(L.parseWebhook(own, "1784").length, 0);
    const reaction = { object: "instagram", entry: [{ id: "1784", messaging: [{ sender: { id: "555" }, reaction: { mid: "m", action: "react" } }] }] };
    const read = { object: "instagram", entry: [{ id: "1784", messaging: [{ sender: { id: "555" }, read: { mid: "m" } }] }] };
    assert.equal(L.parseWebhook(reaction, "1784").length, 0);
    assert.equal(L.parseWebhook(read, "1784").length, 0);
    assert.equal(L.parseWebhook(dm(undefined, { attachments: [{}] }), "1784").length, 0);
    assert.equal(L.parseWebhook({ object: "page", entry: [] }, "1784").length, 0);
  });
});

describe("Niyet ve URL ayrıştırma", () => {
  it("tetikleyiciler büyük/küçük harf ve aksandan bağımsız", () => {
    for (const t of ["analiz", "ANALİZ", "Analız", "analiz yap", "  Analiz!  ", "ANALIZ YAP"]) assert.equal(L.detectIntent({ text: t }), "analyze", t);
    assert.equal(L.detectIntent({ text: "merhaba" }), "other");
    assert.equal(L.detectIntent({ text: "EVET" }), "yes");
    assert.equal(L.detectIntent({ text: "hayır" }), "no");
    assert.equal(L.detectIntent({ text: "x", quickReply: "IM_NO" }), "no");
  });
  it("URL/alan adı çıkarılır; e-posta ve @kullanıcı URL sayılmaz", () => {
    assert.equal(L.extractUrl("sitemiz ornekfirma.com.tr bakar mısınız").hostname, "ornekfirma.com.tr");
    assert.equal(L.extractUrl("https://www.ornek.com/hakkimizda.").hostname, "www.ornek.com");
    assert.equal(L.extractUrl("(ornek.io)").hostname, "ornek.io");
    assert.equal(L.extractUrl("ali@ornek.com"), null);
    assert.equal(L.extractUrl("@ornek.firma"), null);
    assert.equal(L.extractUrl("merhaba nasılsınız"), null);
    assert.equal(L.extractUrl("1.5 saat"), null);
    assert.equal(L.detectIntent({ text: "analiz ornek.com" }), "url");
  });
});

describe("Durum makinesi", () => {
  const now = new Date("2026-10-14T10:00:00Z");
  it("boşta: tetikleyici → adres sor, URL → analiz, diğer → yardım", () => {
    assert.equal(L.decide(null, { text: "analiz" }, now).kind, "ask_url");
    assert.equal(L.decide(null, { text: "ornek.com" }, now).kind, "start_audit");
    assert.equal(L.decide(null, { text: "selam" }, now).kind, "help");
    assert.equal(L.decide({ state: "awaiting_url" }, { text: "bilmiyorum" }, now).kind, "ask_url");
  });
  it("analiz sürerken tekrar istek → meşgul; diğerleri sessiz", () => {
    assert.equal(L.decide({ state: "auditing" }, { text: "ornek.com" }, now).kind, "busy");
    assert.equal(L.decide({ state: "auditing" }, { text: "teşekkürler" }, now).kind, "silent");
  });
  it("sonuç sonrası EVET/Hayır; devirde 72 saat sessiz, ANALİZ yeniden başlatır", () => {
    assert.equal(L.decide({ state: "result_sent" }, { text: "evet" }, now).kind, "yes");
    assert.equal(L.decide({ state: "result_sent" }, { text: "x", quickReply: "IM_NO" }, now).kind, "no");
    const h = { state: "handoff", handoffUntil: new Date(now.getTime() + 3_600_000) };
    assert.equal(L.decide(h, { text: "fiyat nedir?" }, now).kind, "silent");
    assert.equal(L.decide(h, { text: "ornek.com" }, now).kind, "silent");
    assert.equal(L.decide(h, { text: "ANALİZ" }, now).kind, "ask_url");
    assert.equal(L.decide({ ...h, handoffUntil: new Date(now.getTime() - 1) }, { text: "selam" }, now).kind, "help");
  });
  it("günlük 3 analiz sınırı (İstanbul günü)", () => {
    const c = { state: "idle", auditsDay: L.dayKey(now), auditsToday: 3 };
    assert.equal(L.decide(c, { text: "ornek.com" }, now).kind, "rate_limited");
    assert.equal(L.decide({ ...c, auditsDay: "2026-10-13" }, { text: "ornek.com" }, now).kind, "start_audit");
  });
});

describe("Mesaj biçimi ve bölme", () => {
  it("sonuç mesajı skor, 3 adım, rapor ve kapanış içerir", () => {
    const msgs = L.formatResult({ domain: "ornek.com", score: 62, grade: "Geliştirilebilir", steps: ["A", "B", "C", "D"], reportUrl: "https://x/r/abc" });
    assert.match(msgs[0], /^ornek\.com için skorunuz: 62\/100 — Geliştirilebilir/);
    assert.match(msgs[0], /Öncelikli 3 adım:\n1\. A\n2\. B\n3\. C\n/);
    assert.ok(!msgs[0].includes("4. D"));
    assert.match(msgs[0], /Detaylı rapor: https:\/\/x\/r\/abc/);
    assert.match(msgs.at(-1), /'EVET' yazın/);
  });
  it("1000 bayt sınırı UTF-8 olarak korunur", () => {
    const long = Array.from({ length: 40 }, (_, i) => `${i}. Şöyle ğüçlü bir başlık 🙂 ${"ı".repeat(20)}`).join("\n");
    const parts = L.splitMessage(long);
    assert.ok(parts.length >= 2);
    for (const p of parts) assert.ok(L.byteLen(p) <= 1000);
    assert.equal(parts.join("\n"), long);
    for (const p of L.splitMessage("ş".repeat(1500))) assert.ok(L.byteLen(p) <= 1000);
    for (const t of Object.values(L.COPY)) assert.ok(L.byteLen(typeof t === "function" ? t("a".repeat(253)) : t) <= 1000);
  });
});

describe("Graph istemcisi", () => {
  it("doğru uca Bearer ve hızlı yanıtlarla gönderir", async () => {
    const calls = [];
    const c = new IgClient({ ...{ appSecret: "s", verifyToken: "v", accessToken: "tok", accountId: "1784", version: "v25.0" } }, null, async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({}) }; });
    await c.send("555", "hi", L.YES_NO);
    assert.equal(calls[0].url, "https://graph.instagram.com/v25.0/1784/messages");
    assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.recipient, { id: "555" });
    assert.equal(body.message.quick_replies[0].payload, "IM_YES");
  });
  it("yenileme yeni belirteci depoya yazar", async () => {
    let stored = null;
    const c = new IgClient({ appSecret: "s", verifyToken: "v", accessToken: "tok", accountId: "1", version: "v25.0" }, { get: async () => stored, set: async (t) => { stored = t; } },
      async (url) => { assert.match(url, /refresh_access_token\?grant_type=ig_refresh_token/); return { ok: true, status: 200, json: async () => ({ access_token: "new", expires_in: 5184000 }) }; });
    assert.equal(await c.refresh(), 5184000);
    assert.equal(stored, "new");
    assert.equal(await c.token(), "new");
  });
});

// Bellek içi sahte Prisma ile servis akışı (ağ yok; gönderimler kaydedilir).
function fakeService({ pollResult } = {}) {
  const kv = new Map(), convs = new Map(), sent = [], submits = [];
  const prisma = {
    keyValue: {
      findUnique: async ({ where }) => kv.get(where.key) ?? null,
      create: async ({ data }) => { if (kv.has(data.key)) throw Object.assign(new Error("dup"), { code: "P2002" }); kv.set(data.key, data); return data; },
      upsert: async ({ where, create }) => kv.set(where.key, create),
    },
    igConversation: {
      findUnique: async ({ where }) => convs.get(where.igsid) ?? null,
      create: async ({ data }) => { const c = { state: "idle", auditsToday: 0, auditsTotal: 0, messagesIn: 0, updatedAt: new Date(), ...data }; convs.set(data.igsid, c); return c; },
      update: async ({ where, data }) => { const c = convs.get(where.igsid); for (const [k, v] of Object.entries(data)) c[k] = v && typeof v === "object" && "increment" in v ? (c[k] || 0) + v.increment : v; if (!("updatedAt" in data)) c.updatedAt = new Date(); return c; },
      updateMany: async ({ where, data }) => { let count = 0; for (const c of convs.values()) if ((!where.igsid || c.igsid === where.igsid) && c.state === where.state && (!where.updatedAt || c.updatedAt < where.updatedAt.lt)) { Object.assign(c, data); count++; } return { count }; },
      findMany: async ({ where }) => [...convs.values()].filter((c) => c.state === where.state),
    },
  };
  const publicAudits = {
    submit: async (input, ip, opts) => { submits.push({ input, ip, opts }); return { token: "T".repeat(43), leadId: "ornek-com", auditId: "a1" }; },
    poll: async () => pollResult,
  };
  const svc = new InstagramService(prisma, publicAudits);
  svc.client = { cfg: { accountId: "1784" }, send: async (id, text, qr) => { sent.push({ id, text, qr }); }, profile: async () => ({ username: "ornekfirma" }) };
  return { svc, sent, submits, convs };
}
const msg = (text, mid = "mid-" + Math.random(), quickReply = null) => ({ igsid: "555", mid, text, quickReply, timestamp: 1 });

describe("Servis akışı", () => {
  it("ANALİZ → adres sorar; URL → bildirimsiz analiz başlatır; aynı mid ikinci kez işlenmez", async () => {
    const { svc, sent, submits, convs } = fakeService();
    await svc.handleMessage(msg("ANALİZ", "m1"));
    await svc.handleMessage(msg("ANALİZ", "m1"));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, L.COPY.askUrl);
    assert.equal(convs.get("555").state, "awaiting_url");
    await svc.handleMessage(msg("ornek.com", "m2"));
    assert.equal(submits[0].opts.notify, false);
    assert.equal(submits[0].input.source, "instagram");
    assert.equal(submits[0].input.instagram, "ornekfirma");
    assert.equal(convs.get("555").state, "auditing");
    assert.equal(convs.get("555").auditsToday, 1);
    assert.match(sent.at(-1).text, /ornek\.com analiz ediliyor/);
  });
  it("tamamlanan analiz sonucu hızlı yanıtlarla gönderilir; EVET devreder", async () => {
    const pollResult = { status: "completed", result: { overallScore: 55, grade: "Acil iyileştirme gerekli", topOpportunities: [{ title: "Site yavaş açılıyor" }], reportUrl: "https://customer.istanbul.marketing/r/x" } };
    const { svc, sent, convs } = fakeService({ pollResult });
    await svc.handleMessage(msg("ornek.com"));
    sent.length = 0;
    await svc.pollPending();
    assert.match(sent[0].text, /55\/100/);
    assert.match(sent[0].text, /1\. Site yavaş açılıyor/);
    assert.deepEqual(sent.at(-1).qr, L.YES_NO);
    assert.equal(convs.get("555").state, "result_sent");
    assert.equal(convs.get("555").publicToken, null);
    await svc.pollPending(); // ikinci kez gönderilmez
    const n = sent.length;
    await svc.handleMessage(msg("EVET", undefined, "IM_YES")).catch(() => {}); // firma işaretleme Redis gerektirir; hata yutulur
    assert.equal(convs.get("555").state, "handoff");
    assert.equal(sent.at(-1).text, L.COPY.yes);
    await svc.handleMessage(msg("fiyatınız nedir?"));
    assert.equal(sent.length, n + 1); // devirde sessiz
  });
  it("site yoksa nazik mesaj, durum boşa döner", async () => {
    const { svc, sent, convs } = fakeService({ pollResult: { status: "no_website" } });
    await svc.handleMessage(msg("ornek.com"));
    await svc.pollPending();
    assert.match(sent.at(-1).text, /ulaşamadık/);
    assert.equal(convs.get("555").state, "idle");
  });
});
