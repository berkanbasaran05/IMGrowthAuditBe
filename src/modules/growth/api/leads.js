import { isAuthed, isMachine } from "../lib/auth.js";
import { getAll, getOne, put, merge, redis } from "../lib/redis.js";
import { addEvent } from "../lib/events.js";
import { buildOutreach } from "../lib/outreach.js";

const ID = /^[a-z0-9-]{1,120}$/;

export default async function handler(req, res) {
  const human = isAuthed(req), machine = isMachine(req);
  if (!human && !machine) return res.status(401).json({ error: "Giriş gerekli" });
  try {
    if (req.method === "GET") {
      const [leads, runs] = await Promise.all([getAll("leads"), getAll("runs")]);
      for (const l of leads) if (l.manual && !l.outreach && human) { l.outreach = buildOutreach(l); await put("leads", l.id, (({ id, ...r }) => r)(l)); }
      runs.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return res.status(200).json({ leads, runs: runs.slice(0, 30) });
    }
    if (req.method === "PATCH") {
      const { id, patch } = req.body || {};
      if (!ID.test(id || "") || !patch || typeof patch !== "object") return res.status(400).json({ error: "Geçersiz istek" });
      const cur = await getOne("leads", id);
      if (!cur) return res.status(404).json({ error: "Firma bulunamadı" });
      const next = merge(cur, patch);
      if (cur.manual && human) {
        if (patch.outreach) next.outreach = { ...patch.outreach, edited: true };
        else if (!cur.outreach?.edited && INFO.some((k) => k in patch)) next.outreach = buildOutreach({ id, ...next });
      }
      await put("leads", id, next);
      if (patch.demoRequest?.status === "hazir" && cur.demoRequest?.status !== "hazir") await addEvent("demo_ready", { id, name: cur.name });
      return res.status(200).json({ ok: true, lead: { id, ...next } });
    }
    if (req.method === "POST" && req.body?.regen) {
      // Elle eklenen firmanın metinlerini güncel bilgilerle şablondan yeniden üretir (elle düzenlemeyi sıfırlar)
      if (!human) return res.status(401).json({ error: "Giriş gerekli" });
      const id = String(req.body.regen);
      const cur = ID.test(id) ? await getOne("leads", id) : null;
      if (!cur || !cur.manual) return res.status(404).json({ error: "Firma bulunamadı" });
      const next = { ...cur, outreach: buildOutreach({ id, ...cur }) };
      await put("leads", id, next);
      return res.status(200).json({ ok: true, lead: { id, ...next } });
    }
    if (req.method === "POST" && req.body?.manual) {
      // Elle firma ekleme (tanıdık firmalar): yalnızca giriş yapmış kullanıcı; alanlar sınırlı ve temizlenir
      if (!human) return res.status(401).json({ error: "Giriş gerekli" });
      const m = cleanManual(req.body.manual);
      if (!m.name) return res.status(400).json({ error: "Firma adı gerekli." });
      let id = slug([m.name, m.district].filter(Boolean).join(" ")) || "firma";
      if (await getOne("leads", id)) id = `${id.slice(0, 100)}-${Math.random().toString(36).slice(2, 6)}`;
      const lead = { status: "yeni", ...m, manual: true, source: "manuel", foundAt: new Date().toISOString().slice(0, 10) };
      lead.outreach = buildOutreach({ id, ...lead });
      await put("leads", id, lead);
      return res.status(200).json({ ok: true, lead: { id, ...lead } });
    }
    if (req.method === "DELETE") {
      // Yalnızca elle eklenen firmalar silinebilir; keşifle bulunanlar korunur
      if (!human) return res.status(401).json({ error: "Giriş gerekli" });
      const id = String(req.query.id || "");
      const cur = ID.test(id) ? await getOne("leads", id) : null;
      if (!cur) return res.status(404).json({ error: "Firma bulunamadı" });
      if (!cur.manual) return res.status(403).json({ error: "Yalnızca elle eklenen firmalar silinebilir." });
      await redis("HDEL", "leads", id);
      return res.status(200).json({ ok: true });
    }
    if (req.method === "POST") {
      // Toplu ekleme (günlük keşif): { leads: [{id,...}], run: {date,...} }. Var olan firmaların durum/not/geçmiş alanları korunur.
      if (!machine && !human) return res.status(401).end();
      const { leads = [], run } = req.body || {};
      let added = 0, updated = 0;
      for (const l of leads) {
        const { id, ...data } = l;
        if (!ID.test(id || "")) continue;
        const cur = await getOne("leads", id);
        if (cur) { await put("leads", id, { ...data, ...pick(cur, ["status", "statusAt", "notes", "seq", "undo"]) }); updated++; }
        else { await put("leads", id, { status: "yeni", ...data }); added++; }
      }
      if (run?.date) await put("runs", String(run.date), run);
      return res.status(200).json({ ok: true, added, updated });
    }
    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

const INFO = ["name", "sector", "city", "district", "website", "websiteStatus", "ads", "services", "phone", "email", "instagram", "capacity"];
const SERVICES = ["Web sitesi", "Google Ads", "Sosyal medya", "Mobil uygulama", "Özel yazılım"];
const s = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const TR = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
const slug = (v) => String(v).toLocaleLowerCase("tr").replace(/[çğıöşüâîû]/g, (c) => TR[c]).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);

// Elle girilen firma alanlarını temizler; yalnızca bilinen alanlar kabul edilir
function cleanManual(m) {
  const o = m && typeof m === "object" ? m : {};
  const web = s(o.website, 200);
  return {
    name: s(o.name, 120), sector: s(o.sector, 120), city: s(o.city, 60), district: s(o.district, 60),
    phone: s(o.phone, 40), email: s(o.email, 120).toLowerCase(), instagram: s(o.instagram, 80),
    website: web && !/^https?:\/\//i.test(web) ? "https://" + web : web,
    websiteStatus: web ? "" : "yok",
    ads: ["var", "yok"].includes(o.ads) ? o.ads : "",
    services: (Array.isArray(o.services) ? o.services : []).filter((x) => SERVICES.includes(x)),
    capacity: String(o.capacity ?? "").replace(/\r/g, "").trim().slice(0, 600),
  };
}
