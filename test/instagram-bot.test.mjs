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
  it("postback (buton/buzkıran) yükü hızlı yanıt gibi alınır", () => {
    const body = { object: "instagram", entry: [{ id: "1784", messaging: [{ sender: { id: "555" }, recipient: { id: "1784" }, timestamp: 9, postback: { mid: "pm1", title: "🔎 Ücretsiz site analizi", payload: "START_AUDIT" } }] }] };
    const [m] = L.parseWebhook(body, "1784");
    assert.deepEqual([m.mid, m.quickReply], ["pm1", "START_AUDIT"]);
    delete body.entry[0].messaging[0].postback.mid;
    assert.match(L.parseWebhook(body, "1784")[0].mid, /^pb:555:9:START_AUDIT$/);
    body.entry[0].messaging[0].sender.id = "1784";
    assert.equal(L.parseWebhook(body, "1784").length, 0);
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
  it("buzkıran yükleri: START_AUDIT → adres, TALK_TO_TEAM → devir (her durumda), ABOUT_AUDIT → açıklama", () => {
    assert.equal(L.decide(null, { text: "", quickReply: "START_AUDIT" }, now).kind, "ask_url");
    assert.equal(L.decide(null, { text: "", quickReply: "TALK_TO_TEAM" }, now).kind, "yes");
    assert.equal(L.decide({ state: "awaiting_url" }, { text: "", quickReply: "ABOUT_AUDIT" }, now).kind, "about");
    assert.equal(L.decide(null, { text: "evet" }, now).kind, "help"); // yazılı evet yalnızca sonuçtan sonra
    assert.equal(L.decide({ state: "result_sent" }, { text: "", quickReply: "START_AUDIT" }, now).kind, "ask_url");
  });
  it("günlük 3 analiz sınırı (İstanbul günü)", () => {
    const c = { state: "idle", auditsDay: L.dayKey(now), auditsToday: 3 };
    assert.equal(L.decide(c, { text: "ornek.com" }, now).kind, "rate_limited");
    assert.equal(L.decide({ ...c, auditsDay: "2026-10-13" }, { text: "ornek.com" }, now).kind, "start_audit");
  });
});

describe("Mesaj biçimi ve bölme", () => {
  it("sonuç kartı: URL metinde yok, görsel + 2 buton, 80 karakter sınırı", () => {
    const c = L.resultCard({ domain: "regeditpos.com", score: 71, grade: "Geliştirilebilir", steps: ["Site yavaş açılıyor", "B"], reportUrl: "https://x/r/abc" });
    const el = c.generic.attachment.payload.elements[0];
    assert.equal(el.title, "regeditpos.com · 71/100 · Geliştirilebilir");
    assert.equal(el.subtitle, "Öncelik: Site yavaş açılıyor");
    assert.equal(el.image_url, "https://x/r/abc/card.png");
    assert.deepEqual(el.buttons.map((b) => b.type), ["web_url", "postback"]);
    assert.equal(el.buttons[1].payload, "TALK_TO_TEAM");
    assert.equal(c.button.attachment.payload.template_type, "button");
    assert.ok(!c.text.includes("http"));
    const long = L.resultCard({ domain: "a".repeat(70) + ".com", score: 1, grade: "Acil iyileştirme gerekli", steps: ["x".repeat(200)], reportUrl: "https://x/r/a" });
    assert.ok(long.generic.attachment.payload.elements[0].title.length <= 80);
    assert.ok(long.generic.attachment.payload.elements[0].subtitle.length <= 80);
    assert.equal(L.stepsText(["A", "B", "C", "D"]), "Öncelikli 3 adım:\n1. A\n2. B\n3. C");
    for (const t of Object.values(L.COPY)) assert.ok(!/https?:\/\//.test(typeof t === "function" ? t("ornek.com") : t));
  });
  it("ilerleme düzeyi en fazla 2", () => {
    assert.deepEqual([10, 45, 65, 75, 92].map(L.progressLevel), [0, 0, 1, 2, 2]);
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
  it("şablon, gönderen eylemi ve buzkıran çağrıları", async () => {
    const calls = [];
    const c = new IgClient({ appSecret: "s", verifyToken: "v", accessToken: "tok", accountId: "1784", version: "v25.0" }, null, async (url, init = {}) => { calls.push({ url, body: init.body && JSON.parse(init.body) }); return { ok: !url.includes("fail"), status: 200, json: async () => ({ data: [] }) }; });
    await c.sendMessage("555", { attachment: { type: "template" } });
    assert.equal(calls[0].body.message.attachment.type, "template");
    assert.equal(await c.action("555", "typing_on"), true);
    assert.deepEqual(calls[1].body, { recipient: { id: "555" }, sender_action: "typing_on" });
    await c.setIceBreakers([{ question: "q", payload: "P" }]);
    assert.equal(calls[2].url, "https://graph.instagram.com/v25.0/me/messenger_profile");
    assert.deepEqual(calls[2].body, { platform: "instagram", ice_breakers: [{ call_to_actions: [{ question: "q", payload: "P" }], locale: "default" }] });
    await c.getIceBreakers();
    assert.match(calls[3].url, /messenger_profile\?fields=ice_breakers/);
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
function fakeService({ pollResult, failTemplates = 0 } = {}) {
  const kv = new Map(), convs = new Map(), sent = [], submits = [];
  const prisma = {
    keyValue: {
      findUnique: async ({ where }) => kv.get(where.key) ?? null,
      create: async ({ data }) => { if (kv.has(data.key)) throw Object.assign(new Error("dup"), { code: "P2002" }); kv.set(data.key, data); return data; },
      upsert: async ({ where, create, update }) => kv.set(where.key, kv.has(where.key) ? { ...kv.get(where.key), ...update } : create),
      deleteMany: async ({ where }) => { kv.delete(where.key); return { count: 1 }; },
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
    poll: async () => (typeof pollResult === "function" ? pollResult() : pollResult),
  };
  const svc = new InstagramService(prisma, publicAudits);
  let fails = failTemplates;
  svc.client = {
    cfg: { accountId: "1784" },
    send: async (id, text, qr) => { sent.push({ id, text, qr }); },
    sendMessage: async (id, message) => { if (fails-- > 0) throw new Error("template"); sent.push({ id, message }); },
    action: async (id, a) => { sent.push({ id, action: a }); return true; },
    profile: async () => ({ username: "ornekfirma" }),
  };
  return { svc, sent: Object.assign(sent, {}), submits, convs, msgs: () => sent.filter((x) => !x.action) };
}
const msg = (text, mid = "mid-" + Math.random(), quickReply = null) => ({ igsid: "555", mid, text, quickReply, timestamp: 1 });

describe("Servis akışı", () => {
  const done = { status: "completed", result: { overallScore: 71, grade: "Geliştirilebilir", topOpportunities: [{ title: "Site yavaş açılıyor" }, { title: "B" }, { title: "C" }], reportUrl: "https://customer.istanbul.marketing/r/x" } };
  it("ANALİZ → adres sorar; URL → bildirimsiz analiz başlatır; aynı mid ikinci kez işlenmez", async () => {
    const { svc, sent, submits, convs, msgs } = fakeService();
    await svc.handleMessage(msg("ANALİZ", "m1"));
    await svc.handleMessage(msg("ANALİZ", "m1"));
    assert.equal(msgs().length, 1);
    assert.equal(msgs()[0].text, L.COPY.askUrl);
    assert.equal(sent[0].action, "typing_on");
    assert.equal(convs.get("555").state, "awaiting_url");
    await svc.handleMessage(msg("ornek.com", "m2"));
    assert.equal(submits[0].opts.notify, false);
    assert.equal(submits[0].input.source, "instagram");
    assert.equal(submits[0].input.instagram, "ornekfirma");
    assert.equal(convs.get("555").state, "auditing");
    assert.equal(convs.get("555").auditsToday, 1);
    assert.ok(sent.some((x) => x.action === "mark_seen"));
    assert.match(msgs().at(-1).text, /^🔎 Analiz başladı · ornek\.com\n/);
  });
  it("ilerleme: en fazla 2 ara mesaj, aynı düzey tekrar gönderilmez", async () => {
    let progress = 30;
    const { svc, msgs } = fakeService({ pollResult: () => (progress >= 100 ? done : { status: "processing", progress }) });
    await svc.handleMessage(msg("ornek.com"));
    const base = msgs().length;
    await svc.pollPending(); assert.equal(msgs().length, base);
    progress = 65; await svc.pollPending(); await svc.pollPending();
    assert.equal(msgs().length, base + 1); assert.equal(msgs().at(-1).text, L.COPY.progressScan);
    progress = 92; await svc.pollPending(); await svc.pollPending();
    assert.equal(msgs().length, base + 2); assert.equal(msgs().at(-1).text, L.COPY.progressAi);
    progress = 100; await svc.pollPending();
    assert.ok(msgs().at(-2).message.attachment); // kart
  });
  it("sonuç: kart + öncelikli adımlar (hızlı yanıtlar), metinde URL yok; Ücretsiz görüşme devreder", async () => {
    const { svc, sent, convs, msgs } = fakeService({ pollResult: done });
    await svc.handleMessage(msg("ornek.com"));
    sent.length = 0;
    await svc.pollPending();
    const out = msgs();
    assert.equal(out.length, 2);
    assert.equal(out[0].message.attachment.payload.template_type, "generic");
    assert.equal(out[0].message.attachment.payload.elements[0].title, "ornek.com · 71/100 · Geliştirilebilir");
    assert.equal(out[1].text, "Öncelikli 3 adım:\n1. Site yavaş açılıyor\n2. B\n3. C");
    assert.deepEqual(out[1].qr, L.RESULT_QUICK);
    assert.ok(out.every((m) => !m.text || !/https?:/.test(m.text)));
    assert.equal(sent.filter((x) => x.action === "typing_on").length, 2);
    assert.equal(convs.get("555").state, "result_sent");
    await svc.pollPending();
    const n = msgs().length;
    await svc.handleMessage(msg("Ücretsiz görüşme", undefined, "TALK_TO_TEAM")).catch(() => {}); // firma işaretleme Redis gerektirir
    assert.equal(convs.get("555").state, "handoff");
    assert.equal(msgs().at(-1).text, L.COPY.yes);
    await svc.handleMessage(msg("fiyatınız nedir?"));
    assert.equal(msgs().length, n + 1); // devirde sessiz
  });
  it("şablon başarısızsa buton şablonuna, o da başarısızsa URL'siz metne düşer", async () => {
    let f = fakeService({ pollResult: done, failTemplates: 1 });
    await f.svc.handleMessage(msg("ornek.com")); await f.svc.pollPending();
    assert.equal(f.msgs().at(-2).message.attachment.payload.template_type, "button");
    f = fakeService({ pollResult: done, failTemplates: 2 });
    await f.svc.handleMessage(msg("ornek.com")); await f.svc.pollPending();
    const t = f.msgs().at(-2).text;
    assert.match(t, /ornek\.com · 71\/100/); assert.ok(t.includes(L.COPY.noLinkNote)); assert.ok(!/https?:/.test(t));
  });
  it("buzkıranlar: ABOUT → açıklama + Analizi başlat; START → adres; TALK (analizsiz) → devir", async () => {
    const { svc, convs, msgs } = fakeService();
    await svc.handleMessage(msg("ℹ️ Analiz neleri kapsıyor?", undefined, "ABOUT_AUDIT"));
    assert.equal(msgs().at(-1).text, L.COPY.about); assert.deepEqual(msgs().at(-1).qr, L.ABOUT_QUICK);
    await svc.handleMessage(msg("Analizi başlat", undefined, "START_AUDIT"));
    assert.equal(msgs().at(-1).text, L.COPY.askUrl);
    await svc.handleMessage(msg("💬 Ekiple görüşmek istiyorum", undefined, "TALK_TO_TEAM"));
    assert.equal(convs.get("555").state, "handoff"); assert.equal(msgs().at(-1).text, L.COPY.yes);
  });
  it("site yoksa nazik mesaj, durum boşa döner", async () => {
    const { svc, convs, msgs } = fakeService({ pollResult: { status: "no_website" } });
    await svc.handleMessage(msg("ornek.com"));
    await svc.pollPending();
    assert.match(msgs().at(-1).text, /ulaşamadık/);
    assert.equal(convs.get("555").state, "idle");
  });
});

describe("Skor kartı görseli", () => {
  it("1080x1080 PNG üretir, yazı tipi gömülü", async () => {
    const { renderCardPng, renderCardSvg } = await load("sales/report.card");
    const input = { domain: "ornek.com", score: 71, categories: [{ name: "Güven", score: 40 }, { name: "Google'da bulunma", score: null }] };
    assert.match(renderCardSvg({ ...input, domain: "<x>" }), /&lt;x&gt;/);
    const png = await renderCardPng(input);
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1080, 1080]);
  });
});
