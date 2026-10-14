import { publicMessage } from "../../../infrastructure/http/http-hardening.js";
import crypto from "node:crypto";
import { isAuthed } from "../lib/auth.js";
import { redis, getAll, getOne, put, merge } from "../lib/redis.js";

// Referans ortakları (mali müşavir, kuruluş danışmanı, matbaa vb.)
const clean = (b) => ({
  name: String(b.name || "").slice(0, 120), type: String(b.type || "").slice(0, 60),
  phone: String(b.phone || "").slice(0, 40), email: String(b.email || "").slice(0, 120),
  commission: String(b.commission || "").slice(0, 80), notes: String(b.notes || "").slice(0, 2000),
});

export default async function handler(req, res) {
  if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
  try {
    if (req.method === "GET") return res.status(200).json({ refs: await getAll("refs") });
    if (req.method === "POST") {
      const d = clean(req.body || {});
      if (!d.name) return res.status(400).json({ error: "Ad gerekli" });
      const id = crypto.randomUUID().slice(0, 8);
      await put("refs", id, { ...d, createdAt: new Date().toISOString() });
      return res.status(200).json({ ok: true, id });
    }
    if (req.method === "PATCH") {
      const { id, ...rest } = req.body || {};
      const cur = await getOne("refs", String(id || ""));
      if (!cur) return res.status(404).json({ error: "Bulunamadı" });
      await put("refs", id, merge(cur, clean({ ...cur, ...rest })));
      return res.status(200).json({ ok: true });
    }
    if (req.method === "DELETE") { await redis("HDEL", "refs", String(req.query.id || "")); return res.status(200).json({ ok: true }); }
    res.status(405).end();
  } catch (e) { res.status(500).json({ error: publicMessage(e) }); }
}
