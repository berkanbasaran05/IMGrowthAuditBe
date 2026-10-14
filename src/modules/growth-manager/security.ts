import crypto from "node:crypto";

// AI Growth Manager güvenlik yardımcıları:
// - Entegrasyon belirteçleri AES-256-GCM ile şifrelenir (INTEGRATION_ENCRYPTION_KEY, 32 bayt base64).
// - Portal parolaları scrypt ile özetlenir; karşılaştırma sabit zamanlıdır.
// - Portal oturumu ve OAuth "state" değeri HMAC ile imzalanır; yönetici oturumundan ayrı anahtar kullanılır.

export const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
export const randomToken = () => crypto.randomBytes(32).toString("base64url");

function encryptionKey(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY || "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("INTEGRATION_ENCRYPTION_KEY tanımlı değil veya 32 bayt değil (openssl rand -base64 32)");
  return key;
}
export const encryptionConfigured = () => { try { encryptionKey(); return true; } catch { return false; } };

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
export function decryptSecret(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Şifreli veri biçimi geçersiz");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}
export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  // Kullanıcı yoksa da aynı maliyetli işlem yapılır (zamanlama ile kullanıcı keşfini zorlaştırır).
  const [alg, n, salt, hash] = (stored || "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86)).split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = crypto.scryptSync(password, Buffer.from(salt, "base64url"), expected.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p });
  return crypto.timingSafeEqual(actual, expected) && !!stored;
}
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Parola en az 10 karakter olmalı";
  if (!/[a-zçğıöşü]/i.test(password) || !/\d/.test(password)) return "Parola harf ve rakam içermeli";
  return null;
}

function signingKey(purpose: string) {
  const base = process.env.PORTAL_SESSION_SECRET || process.env.SESSION_SECRET || "";
  if (!base) throw new Error("PORTAL_SESSION_SECRET tanımlı değil");
  return crypto.createHmac("sha256", base).update(`im-growth-manager:${purpose}`).digest();
}
export function sign(purpose: string, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", signingKey(purpose)).update(body).digest("base64url")}`;
}
export function verify<T = any>(purpose: string, token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  let expected: Buffer;
  try { expected = crypto.createHmac("sha256", signingKey(purpose)).update(body).digest(); } catch { return null; }
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    return typeof payload.exp === "number" && payload.exp > Date.now() / 1000 ? payload : null;
  } catch { return null; }
}
