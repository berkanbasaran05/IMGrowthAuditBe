import crypto from "node:crypto";
import { isAuthed } from "../lib/auth.js";

// İmzalı görsel vekili: demo sitelerdeki firma görsellerini hızlı ve kalıcı sunmak için CDN'de önbelleğe alır.
// Yalnızca sunucunun imzaladığı adresler kabul edilir (açık vekil değildir).
export const signImg = (u) => crypto.createHmac("sha256", process.env.SESSION_SECRET || "").update(u).digest("base64url").slice(0, 22);

export default async function handler(req, res) {
  const u = String(req.query.u || ""), s = String(req.query.s || "");
  // Panel: renk çıkarmak için imzalı adres iste (yalnızca giriş yapmış kullanıcı)
  if (req.query.sign === "1") { if (!isAuthed(req) || !/^https:\/\//i.test(u)) return res.status(403).end(); return res.status(200).json({ url: `/api/img?u=${encodeURIComponent(u)}&s=${signImg(u)}` }); }
  if (!/^https:\/\//i.test(u) || !process.env.SESSION_SECRET || s !== signImg(u)) return res.status(403).end();
  try {
    const r = await fetch(u, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; IstanbulMarketingDemo/1.0)" } });
    const type = r.headers.get("content-type") || "";
    if (!r.ok || !type.startsWith("image/")) return res.status(404).end();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 6 * 1024 * 1024) return res.status(413).end();
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=31536000, immutable");
    res.status(200).send(buf);
  } catch { res.status(502).end(); }
}
