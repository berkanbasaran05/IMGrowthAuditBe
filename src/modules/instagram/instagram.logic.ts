import crypto from "node:crypto";
import { normalizeWebsite } from "../audit/safe-fetch.js";

// Instagram DM analiz botu — saf yardımcılar (ağ/DB erişimi yok; testler doğrudan kullanır).

export const MAX_TEXT_BYTES = 1000; // Instagram metin sınırı: UTF-8 olarak 1000 bayt
export const DAILY_AUDIT_LIMIT = 3;
export const HANDOFF_MS = 72 * 3_600_000;

export interface IgConfig { appSecret: string; verifyToken: string; accessToken: string; accountId: string; version: string }
export function igConfig(env: NodeJS.ProcessEnv = process.env): IgConfig | null {
  const c = { appSecret: env.IG_APP_SECRET || "", verifyToken: env.IG_VERIFY_TOKEN || "", accessToken: env.IG_ACCESS_TOKEN || "", accountId: env.IG_ACCOUNT_ID || "", version: env.IG_GRAPH_VERSION || "v25.0" };
  if (!c.appSecret || !c.verifyToken || !c.accessToken || !c.accountId) return null;
  if (!/^v\d+\.\d+$/.test(c.version)) c.version = "v25.0";
  return c;
}

// X-Hub-Signature-256: "sha256=" + HMAC-SHA256(ham gövde, uygulama gizli anahtarı). Sabit zamanlı karşılaştırma.
export function verifySignature(raw: Buffer | string | undefined, header: unknown, secret: string): boolean {
  if (!raw || !secret || typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice(7), "hex");
  const expected = crypto.createHmac("sha256", secret).update(raw).digest();
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// GET doğrulama: eşleşirse hub.challenge döner, aksi halde null.
export function verifyChallenge(q: Record<string, any>, verifyToken: string): string | null {
  const mode = q["hub.mode"], token = q["hub.verify_token"], challenge = q["hub.challenge"];
  if (mode !== "subscribe" || !verifyToken || typeof token !== "string" || typeof challenge !== "string") return null;
  const a = Buffer.from(token), b = Buffer.from(verifyToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return /^[A-Za-z0-9_-]{1,128}$/.test(challenge) ? challenge : null;
}

export interface IncomingMessage { igsid: string; mid: string; text: string; quickReply: string | null; timestamp: number }
// Webhook gövdesinden yanıtlanacak mesajları çıkarır. Yankı (is_echo), kendi mesajlarımız (is_self / gönderen = hesabımız),
// tepkiler, okundu bilgileri, silinen/desteklenmeyen mesajlar ve metinsiz ekler atlanır.
export function parseWebhook(body: any, accountId: string): IncomingMessage[] {
  if (!body || body.object !== "instagram" || !Array.isArray(body.entry)) return [];
  const out: IncomingMessage[] = [];
  for (const entry of body.entry) {
    for (const ev of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const m = ev?.message, sender = String(ev?.sender?.id || "");
      // Buton / buzkıran dokunuşları (messaging_postbacks): yük, hızlı yanıt gibi işlenir.
      const pb = ev?.postback;
      if (!m && pb && typeof pb.payload === "string" && sender && sender !== accountId && sender !== String(entry?.id || "")) {
        const ts = Number(ev.timestamp || entry.time || Date.now());
        out.push({ igsid: sender, mid: String(pb.mid || `pb:${sender}:${ts}:${pb.payload}`), text: typeof pb.title === "string" ? pb.title.slice(0, 200) : "", quickReply: pb.payload.slice(0, 100), timestamp: ts });
        continue;
      }
      if (!m || ev.read || ev.reaction || m.is_echo || m.is_self || m.is_deleted || m.is_unsupported) continue;
      if (!sender || sender === accountId || sender === String(entry?.id || "")) continue;
      const qr = typeof m.quick_reply?.payload === "string" ? m.quick_reply.payload : null;
      const text = typeof m.text === "string" ? m.text : "";
      if (!m.mid || (!text && !qr)) continue;
      out.push({ igsid: sender, mid: String(m.mid), text: text.slice(0, 2000), quickReply: qr, timestamp: Number(ev.timestamp || entry.time || Date.now()) });
    }
  }
  return out;
}

const TR: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
export const fold = (v: string) => v.replace(/[İ]/g, "i").toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[çğıöşüâîû]/g, (c) => TR[c] || c).replace(/\s+/g, " ").trim();

// Metindeki ilk alan adı / URL. E-posta adresleri ve @kullanıcı adları URL sayılmaz.
const URLISH = /(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9À-ɏ](?:[a-z0-9À-ɏ-]{0,61}[a-z0-9À-ɏ])?\.)+[a-z]{2,24}(?::\d{2,5})?(?:\/[^\s]*)?/i;
export function extractUrl(text: string): URL | null {
  for (const token of String(text || "").split(/\s+/)) {
    if (!token || token.includes("@")) continue;
    const m = token.replace(/^[<("'“]+|[>)"'”.,!?;:]+$/g, "").match(URLISH);
    if (!m || m.index !== 0) continue;
    const url = normalizeWebsite(m[0]);
    if (url && /\.[a-z]{2,24}$/i.test(url.hostname) && !/\.(jpg|jpeg|png|gif|pdf)$/i.test(url.hostname)) return url;
  }
  return null;
}

export const PAYLOAD = { start: "START_AUDIT", talk: "TALK_TO_TEAM", about: "ABOUT_AUDIT", yes: "IM_YES", no: "IM_NO" } as const;

export type Intent = "analyze" | "url" | "yes" | "no" | "about" | "other";
export function detectIntent(msg: { text: string; quickReply?: string | null }): Intent {
  const p = msg.quickReply;
  if (p === PAYLOAD.yes || p === PAYLOAD.talk) return "yes";
  if (p === PAYLOAD.no) return "no";
  if (p === PAYLOAD.start) return "analyze";
  if (p === PAYLOAD.about) return "about";
  if (extractUrl(msg.text)) return "url";
  const t = fold(msg.text).replace(/[^a-z0-9 ]/g, "").trim();
  if (/^(analiz|analiz yap|analiz et|analiz istiyorum|ucretsiz analiz|analyze|analysis|audit)$/.test(t) || /^analiz\b/.test(t)) return "analyze";
  if (/^(evet|evet lutfen|isterim|yes|ok|tamam)$/.test(t)) return "yes";
  if (/^(hayir|hayir tesekkurler|istemiyorum|no)$/.test(t)) return "no";
  return "other";
}

export type State = "idle" | "awaiting_url" | "auditing" | "sending" | "result_sent" | "handoff";
export interface ConvLike { state: State | string; handoffUntil?: Date | null; auditsDay?: string | null; auditsToday?: number }
export type Action =
  | { kind: "ask_url" } | { kind: "start_audit"; url: URL } | { kind: "busy" } | { kind: "yes" } | { kind: "no" }
  | { kind: "help" } | { kind: "silent" } | { kind: "rate_limited" } | { kind: "about" };

export const dayKey = (now = new Date()) => new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10); // İstanbul günü
export const auditsUsedToday = (c: ConvLike, now = new Date()) => (c.auditsDay === dayKey(now) ? c.auditsToday || 0 : 0);

// Durum makinesi: gelen mesaj + mevcut durum → yapılacak iş.
export function decide(conv: ConvLike | null, msg: { text: string; quickReply?: string | null }, now = new Date()): Action {
  const state = (conv?.state || "idle") as State;
  const intent = detectIntent(msg);
  // Ekip devraldıysa yalnızca yeni bir "ANALİZ" isteği botu yeniden başlatır.
  if (state === "handoff" && conv?.handoffUntil && conv.handoffUntil > now && intent !== "analyze") return { kind: "silent" };
  if (state === "auditing" || state === "sending") return intent === "analyze" || intent === "url" ? { kind: "busy" } : { kind: "silent" };
  if (intent === "url") {
    if (conv && auditsUsedToday(conv, now) >= DAILY_AUDIT_LIMIT) return { kind: "rate_limited" };
    return { kind: "start_audit", url: extractUrl(msg.text)! };
  }
  if (intent === "analyze") return { kind: "ask_url" };
  if (intent === "about") return { kind: "about" };
  // "Ücretsiz görüşme" butonu / buzkıran her durumda; yazılı "evet" yalnızca sonuçtan sonra.
  if (msg.quickReply === PAYLOAD.talk || (state === "result_sent" && intent === "yes")) return { kind: "yes" };
  if (state === "result_sent" && intent === "no") return { kind: "no" };
  if (state === "awaiting_url") return { kind: "ask_url" };
  return { kind: "help" };
}

export const COPY = {
  askUrl: "Web sitenizi ücretsiz analiz edelim. Site adresinizi yazmanız yeterli (ör. ornekfirma.com).",
  started: (domain: string) => `🔎 Analiz başladı · ${domain}\nSiteniz 6 kategoride, 30+ kriterle inceleniyor. Sonuç birkaç dakika içinde burada olacak.`,
  progressScan: "✓ Sayfalar tarandı\n✓ Hız ölçüldü\n⏳ Google görünürlüğü ve dönüşüm noktaları inceleniyor…",
  progressAi: "✓ Teknik ölçümler tamamlandı\n⏳ Yapay zekâ raporu hazırlıyor…",
  busy: "Analiziniz sürüyor. Sonuç hazır olduğunda buraya göndereceğiz.",
  invalidUrl: "Bu adresi analiz edemedik. Adresi kontrol edip tekrar yazar mısınız? (ör. ornekfirma.com)",
  rateLimited: "Bugünlük ücretsiz analiz hakkınız doldu. Yarın yeniden deneyebilirsiniz.",
  noWebsite: (domain: string) => `${domain} adresindeki siteye ulaşamadık. Adresi kontrol edip tekrar yazar mısınız? Farklı bir adres de gönderebilirsiniz.`,
  failed: (domain: string) => `${domain} için analiz şu an tamamlanamadı. Birkaç dakika sonra adresi yeniden yazarak tekrar deneyebilirsiniz.`,
  yes: "Teşekkürler. Ekibimiz en kısa sürede buradan size yazacak.",
  no: "Teşekkürler. Başka bir site için istediğiniz zaman adres yazabilir ya da \"ANALİZ\" gönderebilirsiniz.",
  help: "Web sitenizi ücretsiz analiz edebiliriz. Site adresinizi yazın ya da \"ANALİZ\" gönderin.",
  about: "Analiz sitenizi 6 kategoride, 30+ kriterle inceler: marka mesajı, kullanım kolaylığı, hız ve teknik altyapı, Google'da bulunma, müşteriye dönüştürme ve güven.\n\nSonuçta 100 üzerinden bir skor, öncelikli 3 adım ve detaylı bir rapor alırsınız. Ücretsizdir, birkaç dakika sürer.",
  noLinkNote: "Detaylı raporu ekibimiz buradan iletebilir; \"Ücretsiz görüşme\" seçeneğine dokunmanız yeterli.",
  error: "Şu an bir sorun yaşıyoruz. Lütfen birkaç dakika sonra tekrar deneyin.",
};

const qr = (title: string, payload: string) => ({ content_type: "text", title, payload });
export const YES_NO = [qr("Evet", PAYLOAD.yes), qr("Hayır", PAYLOAD.no)];
export const RESULT_QUICK = [qr("Ücretsiz görüşme", PAYLOAD.talk), qr("Başka site analiz et", PAYLOAD.start)];
export const ABOUT_QUICK = [qr("Analizi başlat", PAYLOAD.start)];

// Denetim ilerlemesi → gönderilecek ara mesaj düzeyi (0: yok, 1: tarama/hız bitti, 2: yapay zekâ). En fazla 2 ara mesaj.
export function progressLevel(progress: number | null | undefined): 0 | 1 | 2 {
  const p = Number(progress) || 0;
  return p >= 75 ? 2 : p >= 65 ? 1 : 0;
}

export const byteLen = (s: string) => Buffer.byteLength(s, "utf8");
// Metni 1000 bayt sınırına göre paragraf/satır/kelime sınırlarından böler.
export function splitMessage(text: string, max = MAX_TEXT_BYTES): string[] {
  const out: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  for (const line of text.split("\n")) {
    const cand = cur ? `${cur}\n${line}` : line;
    if (byteLen(cand) <= max) { cur = cand; continue; }
    push();
    if (byteLen(line) <= max) { cur = line; continue; }
    for (const word of line.split(" ")) {
      const c2 = cur ? `${cur} ${word}` : word;
      if (byteLen(c2) <= max) { cur = c2; continue; }
      push();
      let w = word;
      while (byteLen(w) > max) { let n = max; while (byteLen(w.slice(0, n)) > max) n--; out.push(w.slice(0, n)); w = w.slice(n); }
      cur = w;
    }
  }
  push();
  return out;
}

export interface ResultInput { domain: string; score: number | null; grade: string; steps: string[]; reportUrl: string; cardUrl?: string }
const cut = (v: string, n: number) => (v.length > n ? v.slice(0, n - 1).trimEnd() + "…" : v);

// Sonuç kartı (generic template): görsel = skor kartı, butonlar = rapor + ücretsiz görüşme. Metinde URL yoktur.
export function resultCard(r: ResultInput) {
  const title = cut(`${r.domain} · ${r.score ?? "–"}/100 · ${r.grade}`, 80);
  const subtitle = cut(r.steps[0] ? `Öncelik: ${r.steps[0]}` : "Detaylı rapor hazır", 80);
  const buttons = [
    { type: "web_url", url: r.reportUrl, title: "Detaylı raporu aç" },
    { type: "postback", title: "Ücretsiz görüşme", payload: PAYLOAD.talk },
  ];
  return {
    generic: { attachment: { type: "template", payload: { template_type: "generic", elements: [{ title, subtitle, image_url: r.cardUrl || `${r.reportUrl}/card.png`, default_action: { type: "web_url", url: r.reportUrl }, buttons }] } } },
    button: { attachment: { type: "template", payload: { template_type: "button", text: cut(`${title}\n${subtitle}`, 640), buttons } } },
    text: `${title}\n${subtitle}`,
  };
}

export function stepsText(steps: string[]): string | null {
  if (!steps.length) return null;
  return splitMessage(["Öncelikli 3 adım:", ...steps.slice(0, 3).map((s, i) => `${i + 1}. ${s}`)].join("\n"))[0];
}
