import { publicMessage } from "../../../infrastructure/http/http-hardening.js";
import crypto from "node:crypto";
import { isAuthed } from "../lib/auth.js";
import { redis, getAll, getOne, put } from "../lib/redis.js";
import { SCHEMA, cleanPlan } from "../lib/adsform.js";

// Google Ads müşterileri: başlangıç formu (müşteri doldurur) + kampanya planı (panelde doldurulur)
const COL = "adsclients", TOK = "adstokens";
const slug = (s) => String(s).toLocaleLowerCase("tr").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "musteri";

export default async function handler(req, res) {
  if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
  try {
    if (req.method === "GET") {
      const clients = await getAll(COL);
      clients.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return res.status(200).json({ schema: SCHEMA, clients });
    }
    if (req.method === "POST") {
      const name = String(req.body?.name || "").trim().slice(0, 120);
      if (!name) return res.status(400).json({ error: "Müşteri adı gerekli" });
      const id = slug(name) + "-" + crypto.randomBytes(2).toString("hex");
      const token = crypto.randomBytes(16).toString("hex");
      const rec = { name, token, leadId: /^[a-z0-9-]{1,120}$/.test(req.body?.leadId || "") ? req.body.leadId : "", createdAt: new Date().toISOString(), formStatus: "bekliyor", form: {}, plan: cleanPlan({}), planStatus: "taslak" };
      await put(COL, id, rec);
      await redis("HSET", TOK, token, id);
      return res.status(200).json({ ok: true, client: { id, ...rec } });
    }
    if (req.method === "PATCH") {
      const { id, patch } = req.body || {};
      const cur = id && /^[a-z0-9-]{1,80}$/.test(id) ? await getOne(COL, id) : null;
      if (!cur || !patch || typeof patch !== "object") return res.status(404).json({ error: "Müşteri bulunamadı" });
      const next = { ...cur };
      if (typeof patch.name === "string" && patch.name.trim()) next.name = patch.name.trim().slice(0, 120);
      if (patch.plan) next.plan = cleanPlan(patch.plan);
      if (["taslak", "onaylandi", "yayinda"].includes(patch.planStatus)) next.planStatus = patch.planStatus;
      next.updatedAt = new Date().toISOString();
      await put(COL, id, next);
      return res.status(200).json({ ok: true });
    }
    if (req.method === "DELETE") {
      const id = String(req.query.id || "");
      const cur = /^[a-z0-9-]{1,80}$/.test(id) ? await getOne(COL, id) : null;
      if (!cur) return res.status(404).json({ error: "Müşteri bulunamadı" });
      await redis("HDEL", COL, id);
      if (cur.token) await redis("HDEL", TOK, cur.token);
      return res.status(200).json({ ok: true });
    }
    res.status(405).end();
  } catch (e) { res.status(500).json({ error: publicMessage(e) }); }
}
