import { checkCredentials, sessionCookie } from "../lib/auth.js";

// Basit kaba kuvvet frenlemesi: her denemede küçük gecikme
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { username = "", password = "", remember = true } = req.body || {};
  await sleep(400);
  if (!checkCredentials(username, password)) return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı." });
  res.setHeader("Set-Cookie", sessionCookie(username, remember !== false));
  res.status(200).json({ ok: true });
}
