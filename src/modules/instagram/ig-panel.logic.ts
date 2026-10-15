// Panel "Instagram" sekmesi — saf yardımcılar (ağ/DB yok; testler doğrudan kullanır).
// Alanlar Instagram API with Instagram Login (graph.instagram.com) IG User / IG Media başvurusuna göredir.
// biography/website belgede Instagram Login için açıkça listelenmediğinden önce istenir, "kod 100" (bilinmeyen alan)
// dönerse temel alanlarla yeniden denenir.

import { zonedToUtc } from "./ig-publisher.logic.js";

export const TZ = "Europe/Istanbul";
export const PROFILE_FIELDS = "user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count,biography,website";
export const PROFILE_BASE_FIELDS = "user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count";
export const MEDIA_FIELDS = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
export const MEDIA_BASE_FIELDS = "id,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
export const STORY_FIELDS = "id,media_type,media_url,thumbnail_url,permalink,timestamp";
export const MEDIA_LIMIT = 36;
export const PROFILE_TTL_MS = 5 * 60_000;
export const MEDIA_TTL_MS = 60_000;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_AHEAD_MS = 90 * 86_400_000;
export const PAST_GRACE_MS = 5 * 60_000;

// Meta "kod 100" = geçersiz/bilinmeyen alan ya da parametre.
export const isFieldError = (e: unknown) => /kod 100\b/.test(String((e as any)?.message ?? ""));

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
// Yalnızca https adresler geçer (javascript:, data: vb. sayfaya hiç ulaşmaz).
export const httpsUrl = (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s"'<>]+$/i.test(v) && v.length <= 2000 ? v : null);

export function normalizeProfile(j: any) {
  return {
    id: j?.user_id != null ? String(j.user_id).slice(0, 64) : null,
    username: str(j?.username, 80), name: str(j?.name, 150), accountType: str(j?.account_type, 40),
    picture: httpsUrl(j?.profile_picture_url), biography: str(j?.biography, 300), website: httpsUrl(j?.website),
    followers: num(j?.followers_count), follows: num(j?.follows_count), mediaCount: num(j?.media_count),
  };
}

export function normalizeMedia(m: any) {
  const type = str(m?.media_type, 20) || "IMAGE";
  return {
    id: String(m?.id ?? "").slice(0, 64), type, product: str(m?.media_product_type, 20),
    caption: str(m?.caption, 2200), url: httpsUrl(m?.media_url), thumb: httpsUrl(m?.thumbnail_url) || (type === "VIDEO" ? null : httpsUrl(m?.media_url)),
    permalink: httpsUrl(m?.permalink), timestamp: str(m?.timestamp, 40), likes: num(m?.like_count), comments: num(m?.comments_count),
  };
}

export const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
export const isPng = (b: Buffer) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

// Panelden gelen "2026-10-16T11:00" (İstanbul duvar saati) → UTC. Geçmiş (5 dk tolerans) ve 90 günden ileri reddedilir.
export function parseSchedule(local: unknown, now = new Date()): { ok: boolean; at?: Date; error?: string } {
  if (typeof local !== "string" || !local.trim()) return { ok: false, error: "Tarih ve saat gerekli" };
  let at: Date;
  try { at = zonedToUtc(local, TZ); } catch { return { ok: false, error: "Geçersiz tarih (biçim: 2026-10-16T11:00)" }; }
  if (Number.isNaN(at.getTime())) return { ok: false, error: "Geçersiz tarih" };
  if (at.getTime() < now.getTime() - PAST_GRACE_MS) return { ok: false, error: "Geçmiş bir zaman seçilemez" };
  if (at.getTime() > now.getTime() + MAX_AHEAD_MS) return { ok: false, error: "En fazla 90 gün sonrası seçilebilir" };
  return { ok: true, at };
}

// Kuyruk satırı eylemi: hangi durumlardan izinli ve ne yazılır. publishing/published satırlara dokunulmaz.
export type QueueAction = "cancel" | "reschedule" | "now";
export function queueActionPlan(action: unknown, scheduledAt: unknown, now = new Date()):
  { ok: boolean; from?: string[]; data?: Record<string, unknown>; error?: string } {
  if (action === "cancel") return { ok: true, from: ["queued"], data: { status: "canceled", nextAttemptAt: null } };
  const requeue = { status: "queued", attempts: 0, error: null, nextAttemptAt: null };
  if (action === "now") return { ok: true, from: ["queued", "failed", "canceled"], data: { ...requeue, scheduledAt: now } };
  if (action === "reschedule") {
    const p = parseSchedule(scheduledAt, now);
    if (!p.ok) return { ok: false, error: p.error };
    return { ok: true, from: ["queued", "failed", "canceled"], data: { ...requeue, scheduledAt: p.at } };
  }
  return { ok: false, error: "Geçersiz eylem" };
}

// Bu haftanın başlangıcı: İstanbul saatiyle pazartesi 00:00 (UTC olarak).
export function weekStart(now = new Date()) {
  const local = new Date(now.getTime() + 3 * 3_600_000); // İstanbul sabit UTC+3 (yaz saati yok)
  const dow = (local.getUTCDay() + 6) % 7; // pazartesi = 0
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dow));
  return zonedToUtc(d.toISOString().slice(0, 10) + "T00:00", TZ);
}

// Firma kaydından "EVET" (görüşme isteği) Instagram'dan ve belirli tarihten sonra mı?
export function wantsContactSince(raw: string, since: Date) {
  try {
    const l = JSON.parse(raw);
    if (!l?.inboundWantsContact || l.inboundWantsContactVia !== "instagram") return false;
    const at = Date.parse(l.inboundWantsContactAt || "");
    return Number.isFinite(at) && at >= since.getTime();
  } catch { return false; }
}
