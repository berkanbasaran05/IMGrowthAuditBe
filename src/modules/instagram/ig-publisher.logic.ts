// Zamanlanmış Instagram hikâyeleri — saf yardımcılar (ağ/DB yok). CLI (scripts/ig-schedule-stories.mjs) derlenmiş
// halini (dist/) kullanır; testler .test-build/ altından okur.

export const MEDIA_FILE_RE = /^[a-z0-9-]{1,100}\.(jpg|png)$/;
export const DEFAULT_MEDIA_DIR = "/opt/im/ig-media";
export const DEFAULT_PUBLIC_BASE = "https://customer.istanbul.marketing";
export const MEDIA_ROUTE = "/api/public/ig-media";
export const MAX_ATTEMPTS = 3;
// Hata sonrası yeniden deneme gecikmesi: 1. hatadan sonra 5 dk, 2.'den sonra 15 dk. 3. hata → failed.
export const RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000];
// Kapsayıcı durumu yoklama aralıkları (toplam ~2 dk). Görseller genelde ilk yoklamada FINISHED olur.
export const STATUS_POLL_DELAYS_MS = [2_000, 5_000, 10_000, 15_000, 30_000, 30_000, 30_000];
// Zamanından bu kadar geç kalan hikâye yayınlanmaz (sunucu uzun süre kapalı kaldıysa birikmiş hikâyeler aynı anda atılmaz).
export const DEFAULT_MAX_LATE_MS = 6 * 3_600_000;
// 'publishing' durumunda bu süreden uzun kalan satır (süreç çöktü) yeniden kuyruğa alınır; varsa kapsayıcı yeniden kullanılır.
export const PUBLISHING_STALE_MS = 10 * 60_000;

export const mediaDir = (env: NodeJS.ProcessEnv = process.env) => env.IG_MEDIA_DIR || DEFAULT_MEDIA_DIR;
export const publicBase = (env: NodeJS.ProcessEnv = process.env) => (env.PUBLIC_REPORT_BASE_URL || DEFAULT_PUBLIC_BASE).replace(/\/+$/, "");
export const isValidMediaFile = (name: unknown): name is string => typeof name === "string" && MEDIA_FILE_RE.test(name);
export function mediaUrl(fileName: string, env: NodeJS.ProcessEnv = process.env) {
  if (!isValidMediaFile(fileName)) throw new Error("Geçersiz dosya adı");
  return `${publicBase(env)}${MEDIA_ROUTE}/${fileName}`;
}
export const contentTypeFor = (name: string) => (name.endsWith(".png") ? "image/png" : "image/jpeg");

// Hata sonrası: deneme hakkı kaldıysa yeniden kuyruğa (gecikmeli), yoksa failed.
export function retryPlan(attempts: number, now: Date): { status: "queued" | "failed"; nextAttemptAt: Date | null } {
  if (attempts >= MAX_ATTEMPTS) return { status: "failed", nextAttemptAt: null };
  const delay = RETRY_DELAYS_MS[Math.min(Math.max(attempts, 1), RETRY_DELAYS_MS.length) - 1];
  return { status: "queued", nextAttemptAt: new Date(now.getTime() + delay) };
}

// Hata metninden belirteç benzeri değerler ve URL sorgu parametreleri ayıklanır; en fazla 300 karakter.
export function safeError(e: unknown): string {
  const raw = String((e as any)?.message ?? e ?? "Bilinmeyen hata");
  return raw
    .replace(/(access_token|token|secret|signature)=[^&\s"]+/gi, "$1=***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/\b(IGAA|IGQV|EAA)[A-Za-z0-9_-]{10,}/g, "***")
    .replace(/[A-Za-z0-9_-]{60,}/g, "***")
    .slice(0, 300);
}

// --- Zamanlama: belirli bir saat dilimindeki duvar saatini UTC'ye çevirme (Intl ile; ek bağımlılık yok) ---

function tzOffsetMs(utcMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(utcMs / 1000) * 1000;
}

// "2026-10-16T11:00" (saat dilimi eki yok) → o saat diliminde 11:00'in UTC karşılığı.
export function zonedToUtc(local: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) throw new Error(`Geçersiz tarih: ${local} (biçim: 2026-10-16T11:00)`);
  new Intl.DateTimeFormat("en-US", { timeZone }); // geçersiz saat dilimi → RangeError
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x || 0));
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let utc = guess - tzOffsetMs(guess, timeZone);
  utc = guess - tzOffsetMs(utc, timeZone); // yaz saati geçişleri için ikinci tur
  return new Date(utc);
}

// n adet zaman: başlangıç + i * everyHours (duvar saati olarak; yaz saati değişse de hep aynı yerel saat).
export function scheduleTimes(start: string, count: number, everyHours: number, timeZone: string): Date[] {
  if (!(everyHours > 0)) throw new Error("--every-hours pozitif olmalı");
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(start.trim());
  if (!m) throw new Error(`Geçersiz tarih: ${start}`);
  const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Array.from({ length: count }, (_, i) => {
    const wall = new Date(base + i * everyHours * 3_600_000).toISOString().slice(0, 16);
    return zonedToUtc(wall, timeZone);
  });
}

export function formatInZone(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

// Kaynak dosya adından güvenli hedef ad: story-<yyyymmdd-hhmm>-<kök>.jpg (yalnızca [a-z0-9-]).
export function storyFileName(source: string, when: Date, timeZone: string) {
  const stem = source.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").toLocaleLowerCase("tr")
    .replace(/[çğıöşüâîû]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" }[c]!))
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "story";
  const stamp = formatInZone(when, timeZone).replace(/[^0-9]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2");
  return `story-${stamp}-${stem}.jpg`;
}
