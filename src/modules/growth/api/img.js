import crypto from "node:crypto";
import { isAuthed, safeEqual } from "../lib/auth.js";
import { safeFetch } from "../../audit/safe-fetch.js";

// İmzalı görsel vekili: demo sitelerdeki firma görsellerini hızlı ve kalıcı sunmak için CDN'de önbelleğe alır.
// Yalnızca sunucunun imzaladığı adresler kabul edilir (açık vekil değildir).
// Oturum anahtarından türetilmiş ayrı anahtar (aynı anahtar farklı amaçlarla kullanılmaz).
const imgKey = () => crypto.createHmac("sha256", process.env.SESSION_SECRET || "").update("image-proxy").digest();
export const signImg = (u) => crypto.createHmac("sha256", imgKey()).update(u).digest("base64url").slice(0, 22);

export default async function handler(req, res) {
  const u = String(req.query.u || ""), s = String(req.query.s || "");
  // Panel: renk çıkarmak için imzalı adres iste (yalnızca giriş yapmış kullanıcı)
  if (req.query.sign === "1") { if (!isAuthed(req) || !/^https:\/\//i.test(u)) return res.status(403).end(); return res.status(200).json({ url: `/api/img?u=${encodeURIComponent(u)}&s=${signImg(u)}` }); }
  if (!/^https:\/\//i.test(u) || !process.env.SESSION_SECRET || !safeEqual(s, signImg(u))) return res.status(403).end();
  try {
    // SSRF koruması: özel/yerel adresler engellenir, yönlendirmeler tek tek doğrulanır, boyut ve süre sınırlıdır.
    const r = await safeFetch(u, { timeoutMs: 15_000, maxBytes: 6 * 1024 * 1024, accept: "image/*" });
    const type = r.headers.get("content-type") || "";
    if (r.truncated) return res.status(413).end();
    if (r.status >= 400 || !/^image\/(png|jpe?g|gif|webp|avif|svg\+xml)/i.test(type)) return res.status(404).end();
    res.setHeader("Content-Type", type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (/svg/i.test(type)) res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=31536000, immutable");
    res.status(200).send(r.buffer);
  } catch { res.status(502).end(); }
}
