import crypto from "node:crypto";

const SECRET = process.env.SESSION_SECRET || "";
const COOKIE = "im_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 gün

const sign = (v) => crypto.createHmac("sha256", SECRET).update(v).digest("base64url");

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function checkCredentials(user, pass) {
  const U = process.env.ADMIN_USER, P = process.env.ADMIN_PASSWORD;
  if (!U || !P || !SECRET) return false;
  const okU = safeEqual(user, U), okP = safeEqual(pass, P); // ikisi de her zaman hesaplanır
  return okU && okP;
}

// remember=false: tarayıcı kapanınca biten oturum (en fazla 12 saat)
export function sessionCookie(user, remember = true) {
  const ttl = remember ? MAX_AGE : 60 * 60 * 12;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const payload = Buffer.from(JSON.stringify({ u: user, exp })).toString("base64url");
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax` + (remember ? `; Max-Age=${ttl}` : "");
}

export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export function isAuthed(req) {
  if (!SECRET) return false;
  const raw = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return false;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return false;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now() / 1000; }
  catch { return false; }
}

// Günlük keşif görevi için makine erişimi: Authorization: Bearer <INGEST_TOKEN>
export function isMachine(req) {
  const t = process.env.INGEST_TOKEN;
  const h = req.headers.authorization || "";
  return !!t && h.startsWith("Bearer ") && safeEqual(h.slice(7), t);
}
