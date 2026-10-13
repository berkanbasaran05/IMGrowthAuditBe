import crypto from "node:crypto";
import { redis, getOne } from "../lib/redis.js";
import { getSettings, addEvent } from "../lib/events.js";
import net from "node:net";
import { SCHEMA, cleanAnswers, missingRequired } from "../lib/adsform.js";

// Demo sitelerden gelen ilgi sinyalleri → firma kaydında "ilgi" ve "sıcaklık" puanı
async function track(req, res) {
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const id = String(b.lead || ""); if (!/^[a-z0-9-]{1,120}$/.test(id)) return res.status(204).end();
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "x";
  const k = `rl:trk:${ip}`, n = await redis("INCR", k); if (n === 1) await redis("EXPIRE", k, 3600); if (n > 120) return res.status(204).end();
  const l = await getOne("leads", id); if (!l || !l.demo) return res.status(204).end();
  const page = String(b.page || "ana-sayfa").slice(0, 80), secs = Math.max(0, Math.min(1800, +b.secs_time || 0)), depth = Math.max(0, Math.min(100, +b.depth || 0));
  const I = l.interest || { pages: {}, secs: [], total: 0 };
  const P = I.pages[page] || { v: 0, t: 0, d: 0 }; P.v++; P.t += secs; P.d = Math.max(P.d, depth); I.pages[page] = P;
  I.total = (I.total || 0) + secs;
  const newSecs = (Array.isArray(b.secs) ? b.secs : []).map((x) => String(x).slice(0, 30)).filter((x) => !I.secs.includes(x));
  I.secs = [...I.secs, ...newSecs].slice(0, 40);
  I.last = new Date().toISOString();
  const views = Object.values(I.pages).reduce((a, x) => a + x.v, 0);
  const heat = Math.min(100, Math.round(views * 6 + I.total / 8 + (I.secs.includes("paketler") ? 30 : 0) + (I.pages.sunum ? 15 : 0) + (l.bookingId ? 40 : 0)));
  await redis("HSET", "leads", id, JSON.stringify({ ...l, interest: I, heat }));
  if (newSecs.includes("paketler")) await addEvent("demo_hot", { id, name: l.name });
  return res.status(204).end();
}
// Alan adı müsaitliği: DNS kaydı yoksa muhtemelen müsait (kesin sonuç için kayıt firmasında doğrulanır)
// Alan adı müsaitliği — kayıt otoritesinden doğrulanır:
// .com/.net: Verisign RDAP (404 = kayıtlı değil), .tr: TRABIS whois ("No match found" = kayıtlı değil).
function trWhois(d) {
  return new Promise((resolve) => {
    let b = "", done = false; const end = (v) => { if (!done) { done = true; resolve(v); } };
    const s = net.connect(43, "whois.trabis.gov.tr", () => s.write(d + "\r\n"));
    s.setTimeout(6000, () => { s.destroy(); end(null); });
    s.on("data", (c) => (b += c)); s.on("end", () => end(b)); s.on("error", () => end(null));
  });
}
async function checkDomain(d) {
  const tld = d.split(".").slice(1).join(".");
  if (tld === "com" || tld === "net") {
    const r = await fetch(`https://rdap.verisign.com/${tld}/v1/domain/${d}`, { headers: { accept: "application/rdap+json" } });
    return r.status === 404 ? "available" : r.status === 200 ? "taken" : "unknown";
  }
  if (d.endsWith(".tr")) {
    const w = await trWhois(d);
    if (!w) return "unknown";
    if (/No match found/i.test(w)) return "available";
    if (/Domain Name:/i.test(w)) return "taken";
    return "unknown";
  }
  return "unknown";
}
async function domain(req, res) {
  const d = String(req.query.d || "").toLowerCase();
  if (!/^[a-z0-9-]{1,60}(\.[a-z]{2,6}){1,2}$/.test(d)) return res.status(400).json({ status: "invalid" });
  const c = await redis("GET", "dom2:" + d); if (c) return res.status(200).json({ status: c, cached: true });
  let status = "unknown";
  try { status = await checkDomain(d); } catch { status = "unknown"; }
  if (status !== "unknown") await redis("SET", "dom2:" + d, status, "EX", 21600);
  res.setHeader("Cache-Control", "s-maxage=1800");
  return res.status(200).json({ status, verified: status !== "unknown" });
}

// Google Ads başlangıç formu: müşteriye özel gizli bağlantı (?k=<anahtar>); yalnızca kendi formunu okur/yazar
async function adsForm(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const k = String(req.query.k || "");
  if (!/^[a-f0-9]{32}$/.test(k)) return res.status(404).json({ error: "Bağlantı geçersiz" });
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "x";
  const rk = `rl:adsf:${ip}`, n = await redis("INCR", rk); if (n === 1) await redis("EXPIRE", rk, 3600); if (n > 60) return res.status(429).json({ error: "Çok fazla deneme. Lütfen daha sonra tekrar deneyin." });
  const id = await redis("HGET", "adstokens", k); const c = id ? await getOne("adsclients", id) : null;
  if (!c) return res.status(404).json({ error: "Bağlantı geçersiz" });
  if (req.method === "GET") return res.status(200).json({ name: c.name, schema: SCHEMA, answers: c.form || {}, status: c.formStatus, at: c.formAt || "" });
  if (req.method === "POST") {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (b.hp) return res.status(200).json({ ok: true }); // bot tuzağı
    const answers = cleanAnswers(b.answers);
    const miss = missingRequired(answers);
    if (miss.length) return res.status(400).json({ error: "Zorunlu alanları doldurun.", missing: miss });
    const next = { ...c, form: answers, formStatus: "gonderildi", formAt: new Date().toISOString() };
    await redis("HSET", "adsclients", id, JSON.stringify(next));
    try { await addEvent("ads_form", { id, name: c.name }); } catch {}
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}

// Herkese açık: teklif sayfası verisi ve görüşme talebi formu
export default async function handler(req, res) {
  try {
    if (req.query.type === "track") return await track(req, res);
    if (req.query.type === "domain") return await domain(req, res);
    if (req.query.type === "adsform") return await adsForm(req, res);
    if (req.method === "GET") {
      const s = await getSettings();
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
      return res.status(200).json({ offer: s.offer });
    }
    if (req.method === "POST") {
      const b = req.body || {};
      if (b.website) return res.status(200).json({ ok: true }); // bot tuzağı
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "x";
      const k = `rl:book:${ip}`, n = await redis("INCR", k);
      if (n === 1) await redis("EXPIRE", k, 3600);
      if (n > 8) return res.status(429).json({ error: "Çok fazla deneme. Lütfen daha sonra tekrar deneyin." });
      const d = {
        name: String(b.name || "").trim().slice(0, 100), business: String(b.business || "").trim().slice(0, 120),
        phone: String(b.phone || "").trim().slice(0, 30), email: String(b.email || "").trim().slice(0, 120),
        interest: String(b.interest || "").slice(0, 80), time: String(b.time || "").slice(0, 60),
        note: String(b.note || "").trim().slice(0, 1500), lead: /^[a-z0-9-]{1,120}$/.test(b.lead || "") ? b.lead : "",
      };
      if (!d.name || (!d.phone && !d.email)) return res.status(400).json({ error: "Ad ve telefon ya da e-posta gerekli." });
      if (!b.consent) return res.status(400).json({ error: "Aydınlatma metnini onaylayın." });
      const id = Date.now().toString(36) + crypto.randomBytes(2).toString("hex");
      const rec = { ...d, at: new Date().toISOString(), status: "yeni" };
      await redis("HSET", "bookings", id, JSON.stringify(rec));
      if (d.lead) {
        const l = await getOne("leads", d.lead);
        if (l) await redis("HSET", "leads", d.lead, JSON.stringify({ ...l, status: ["yeni", "iletisim", "cevap"].includes(l.status || "yeni") ? "toplanti" : l.status, bookingId: id }));
      }
      await addEvent("booking", { id, name: d.name, business: d.business, phone: d.phone, lead: d.lead });
      return res.status(200).json({ ok: true });
    }
    res.status(405).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
}
