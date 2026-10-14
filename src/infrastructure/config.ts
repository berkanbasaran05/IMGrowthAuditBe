// Başlangıçta ortam değişkenlerini doğrular. Üretimde (NODE_ENV=production) zorunlu ayarlar eksik veya
// zayıfsa uygulama açık bir mesajla durur; isteğe bağlı özellikler için yalnızca uyarı verir. Gizli değerler yazdırılmaz.

export interface ConfigReport { errors: string[]; warnings: string[]; features: Record<string, boolean> }

const EXAMPLES = new Set(["guclu-bir-sifre", "uzun-rastgele-bir-anahtar", "uzun-rastgele-bir-veri-aktarma-anahtari", "change-me", "admin"]);
const weak = (v: string | undefined, min: number) => !v || v.length < min || EXAMPLES.has(v);

export function validateConfig(env: Record<string, string | undefined> = process.env): ConfigReport {
  const prod = env.NODE_ENV === "production";
  const errors: string[] = [], warnings: string[] = [];
  const need = (cond: boolean, msg: string) => (cond ? null : (prod ? errors : warnings).push(msg));

  need(!!env.DATABASE_URL, "DATABASE_URL tanımlı değil");
  need(!weak(env.SESSION_SECRET, 32), "SESSION_SECRET en az 32 karakter ve örnekten farklı olmalı");
  need(!!env.ADMIN_USER && !weak(env.ADMIN_PASSWORD, 12), "ADMIN_USER tanımlı ve ADMIN_PASSWORD en az 12 karakter, örnekten farklı olmalı");
  if (env.INGEST_TOKEN) need(!weak(env.INGEST_TOKEN, 32), "INGEST_TOKEN en az 32 karakter olmalı");
  if (env.PORTAL_SESSION_SECRET) need(!weak(env.PORTAL_SESSION_SECRET, 32), "PORTAL_SESSION_SECRET en az 32 karakter olmalı");
  else if (prod) warnings.push("PORTAL_SESSION_SECRET tanımlı değil; portal oturumları SESSION_SECRET'tan türetiliyor (ayrı anahtar önerilir)");
  if (env.INTEGRATION_ENCRYPTION_KEY && Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, "base64").length !== 32) errors.push("INTEGRATION_ENCRYPTION_KEY 32 baytlık base64 olmalı (openssl rand -base64 32)");
  if (env.PAYMENT_PROVIDER === "mock" && prod) errors.push("PAYMENT_PROVIDER=mock üretimde kullanılamaz");
  if (prod && env.IYZICO_API_KEY && /sandbox/.test(env.IYZICO_BASE_URL || "sandbox")) warnings.push("iyzico test (sandbox) ortamında; gerçek tahsilat için IYZICO_BASE_URL=https://api.iyzipay.com yapın");
  if (env.MAIL_DRY_RUN === "1" && prod) warnings.push("MAIL_DRY_RUN=1: e-postalar gerçekte gönderilmiyor");

  const features = {
    ai: !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) && env.AUDIT_AI_DISABLED !== "1",
    pagespeed: !!env.PSI_KEY,
    smtp: !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS),
    googleOAuth: !!(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI),
    googleAds: !!env.GOOGLE_ADS_DEVELOPER_TOKEN,
    integrationEncryption: !!env.INTEGRATION_ENCRYPTION_KEY,
    instagramBot: !!(env.IG_APP_SECRET && env.IG_VERIFY_TOKEN && env.IG_ACCESS_TOKEN && env.IG_ACCOUNT_ID),
    telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    payments: !!(env.IYZICO_API_KEY && env.IYZICO_SECRET_KEY) || (env.PAYMENT_PROVIDER === "mock" && !prod),
  };
  if (!features.ai) warnings.push("AI kapalı: ANTHROPIC_API_KEY yok (öznel metrikler 'Bilinmiyor', metinler şablonla üretilir)");
  if (!features.pagespeed) warnings.push("PSI_KEY yok: Lighthouse ölçümleri kota nedeniyle sık başarısız olur");
  if (features.googleOAuth && !features.integrationEncryption) errors.push("Google OAuth tanımlı ama INTEGRATION_ENCRYPTION_KEY yok; belirteçler saklanamaz");
  return { errors, warnings, features };
}
