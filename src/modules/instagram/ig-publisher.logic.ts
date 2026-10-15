// Zamanlanmış Instagram içerikleri (hikâye, gönderi, karusel, Reels) — saf yardımcılar (ağ/DB yok). CLI
// (scripts/ig-schedule-stories.mjs) derlenmiş halini (dist/) kullanır; testler .test-build/ altından okur.
// Sınırlar Meta "Content Publishing" + IG User Media başvurusuna göredir (Instagram API with Instagram Login).

export const MEDIA_FILE_RE = /^[a-z0-9-]{1,100}\.(jpg|png|mp4|mov)$/;
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
export const isVideoFile = (name: string) => /\.(mp4|mov)$/.test(name);
export const contentTypeFor = (name: string) =>
  name.endsWith(".png") ? "image/png" : name.endsWith(".mp4") ? "video/mp4" : name.endsWith(".mov") ? "video/quicktime" : "image/jpeg";

// --- İçerik türleri ve Meta sınırları ---
export type PostKind = "story" | "image" | "carousel" | "reels";
export const KINDS: PostKind[] = ["story", "image", "carousel", "reels"];
export const isKind = (k: unknown): k is PostKind => typeof k === "string" && (KINDS as string[]).includes(k);
export const KIND_LABEL: Record<PostKind, string> = { story: "Hikâye", image: "Gönderi", carousel: "Karusel", reels: "Reels" };
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024; // JPEG, gönderi/hikâye/karusel/kapak
export const STORY_VIDEO_MAX_BYTES = 100 * 1024 * 1024; // hikâye videosu (3–60 sn)
export const REELS_MAX_BYTES = 300 * 1024 * 1024; // Reels (3 sn – 15 dk)
export const CAPTION_MAX = 2200;
export const HASHTAG_MAX = 30;
export const MENTION_MAX = 20;
export const CAROUSEL_MIN = 2;
export const CAROUSEL_MAX = 10;
// Akış görseli en-boy oranı 4:5 (0.8) – 1.91:1; küçük yuvarlama toleransı.
export const FEED_RATIO_MIN = 0.8;
export const FEED_RATIO_MAX = 1.91;

export const countHashtags = (s: string) => (s.match(/(?:^|[^\p{L}\p{N}_&])#[\p{L}\p{N}_]+/gu) || []).length;
export const countMentions = (s: string) => (s.match(/(?:^|[^\p{L}\p{N}_.])@[A-Za-z0-9_.]+/gu) || []).length;

// Açıklama: hikâyede yok; diğerlerinde en fazla 2200 karakter, 30 hashtag, 20 @etiket. Boş → null.
export function validateCaption(kind: PostKind, raw: unknown): { ok: boolean; value?: string | null; error?: string } {
  if (raw != null && typeof raw !== "string") return { ok: false, error: "Geçersiz açıklama" };
  const value = String(raw ?? "").replace(/\r\n?/g, "\n").trim();
  if (!value) return { ok: true, value: null };
  if (kind === "story") return { ok: false, error: "Hikâyelerde açıklama kullanılamaz" };
  if ([...value].length > CAPTION_MAX) return { ok: false, error: `Açıklama en fazla ${CAPTION_MAX} karakter olabilir` };
  if (countHashtags(value) > HASHTAG_MAX) return { ok: false, error: `En fazla ${HASHTAG_MAX} hashtag kullanılabilir` };
  if (countMentions(value) > MENTION_MAX) return { ok: false, error: `En fazla ${MENTION_MAX} @etiket kullanılabilir` };
  return { ok: true, value };
}

// Tür başına dosya kümesi kuralı (dosya adlarından): hikâye 1 görsel/video, gönderi 1 JPEG, karusel 2–10 JPEG, Reels 1 video.
export function validateMediaSet(kind: PostKind, files: string[]): string | null {
  if (!files.length) return "Dosya seçilmedi";
  if (files.some((f) => !isValidMediaFile(f))) return "Geçersiz dosya adı";
  const vids = files.filter(isVideoFile).length, pngs = files.filter((f) => f.endsWith(".png")).length;
  if (pngs) return "Instagram yalnızca JPEG kabul ediyor";
  if (kind === "story") return files.length === 1 ? null : "Hikâye tek görsel ya da video olmalı";
  if (kind === "image") return files.length === 1 && !vids ? null : "Gönderi tek JPEG görsel olmalı";
  if (kind === "reels") return files.length === 1 && vids === 1 ? null : "Reels tek video (MP4/MOV) olmalı";
  if (files.length < CAROUSEL_MIN || files.length > CAROUSEL_MAX) return `Karusel ${CAROUSEL_MIN}–${CAROUSEL_MAX} görselden oluşur`;
  return vids ? "Karuselde yalnızca JPEG görsel kullanılabilir" : null;
}

export function maxBytesFor(kind: PostKind, file: string) {
  if (!isVideoFile(file)) return IMAGE_MAX_BYTES;
  return kind === "reels" ? REELS_MAX_BYTES : STORY_VIDEO_MAX_BYTES;
}

// Satırın dosyaları: yeni satırlarda media_files (JSON dizi), eski hikâyelerde file_name.
export function rowFiles(row: { fileName: string; mediaFiles?: unknown }): string[] {
  const m = row.mediaFiles;
  if (Array.isArray(m) && m.length) return m.map((x) => (typeof x === "string" ? x : String((x as any)?.name ?? "")));
  return [row.fileName];
}

// --- Dosya içeriği koklama (uzantıya güvenilmez) ---
export const isJpegBuf = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
export const isPngBuf = (b: Buffer) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
// ISO BMFF (MP4) / QuickTime (MOV): 4. bayttan itibaren kutu türü. ftyp markası "qt  " → MOV.
export function videoExt(b: Buffer): "mp4" | "mov" | null {
  if (b.length < 12) return null;
  const box = b.toString("latin1", 4, 8);
  if (box === "ftyp") return b.toString("latin1", 8, 12) === "qt  " ? "mov" : "mp4";
  return ["moov", "mdat", "wide", "free", "skip"].includes(box) ? "mov" : null;
}
// JPEG boyutu (SOF0–SOF15, DHT/JPG/DAC hariç). Okunamazsa null.
export function jpegSize(b: Buffer): { width: number; height: number } | null {
  if (!isJpegBuf(b)) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}
export function feedRatioError(size: { width: number; height: number } | null): string | null {
  if (!size || !size.width || !size.height) return null;
  const r = size.width / size.height;
  if (r < FEED_RATIO_MIN - 0.005) return "Görsel çok dikey: akış gönderisi en fazla 4:5 olabilir";
  if (r > FEED_RATIO_MAX + 0.005) return "Görsel çok yatay: akış gönderisi en fazla 1.91:1 olabilir";
  return null;
}

// Meta kapsayıcısı hazır olana kadar işçi turlar arasında bekler (video işleme dakikalar sürebilir). Satır 'queued'
// kalır, deneme hakkı tüketilmez; bu sürelerden sonra kapsayıcı bırakılır ve hata sayılır.
export const INLINE_POLL_MS = [3_000, 7_000];
export const PROCESSING_RECHECK_MS = 60_000;
export const PROCESSING_DEADLINE_MS = { image: 10 * 60_000, video: 30 * 60_000 };
export const QUOTA_RECHECK_MS = 30 * 60_000;

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

// Kaynak dosya adından güvenli hedef ad: <tür>-<yyyymmdd-hhmm>-<kök>.<uzantı> (yalnızca [a-z0-9-]).
export function storyFileName(source: string, when: Date, timeZone: string) { return mediaFileName("story", source, when, timeZone, "jpg"); }
export function mediaFileName(kind: string, source: string, when: Date, timeZone: string, ext: "jpg" | "mp4" | "mov") {
  const stem = source.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").toLocaleLowerCase("tr")
    .replace(/[çğıöşüâîû]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" }[c]!))
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || (/^[a-z]{1,12}$/.test(kind) ? kind : "post");
  const stamp = formatInZone(when, timeZone).replace(/[^0-9]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2");
  return `${/^[a-z]{1,12}$/.test(kind) ? kind : "post"}-${stamp}-${stem}.${ext}`;
}
