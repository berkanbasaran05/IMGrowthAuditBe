import { checkCredentials, sessionCookie } from "../lib/auth.js";
import { clientIp, rateLimited } from "../../../infrastructure/http/rate-limit.js";

// Basit kaba kuvvet frenlemesi: her denemede küçük gecikme
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { username = "", password = "", remember = true } = req.body || {};
  // Kaba kuvvet koruması: IP başına 15 dakikada 10 deneme. Kullanıcı adı tek başına anahtar yapılmaz;
  // aksi halde saldırgan farklı IP'lerden deneyerek gerçek yöneticiyi kilitleyebilirdi.
  if (rateLimited(`admin-login:${clientIp(req)}`, 10, 15 * 60_000)) {
    return res.status(429).json({ error: "Çok fazla deneme. 15 dakika sonra tekrar deneyin." });
  }
  await sleep(400);
  if (!checkCredentials(username, password)) return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı." });
  res.setHeader("Set-Cookie", sessionCookie(username, remember !== false));
  res.status(200).json({ ok: true });
}
