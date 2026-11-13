import { KNOWLEDGE_SNAPSHOT } from "./knowledge.snapshot.js";

// Asistanın bilgi kaynağı: sitenin llms.txt metni (hizmetler, fiyatlar, SSS, referanslar).
//
// Varsayılan olarak backend'le birlikte paketlenen kopya (knowledge.snapshot.ts) kullanılır; böylece asistanın
// bildiği fiyatlar, konu sınırı testinin çalıştığı metinle aynıdır ve sitenin eski bir sürümü yayındayken yanlış
// bilgi vermez. Site fiyatları değişince kopyayı web/public/llms.txt'den güncelleyin.
//
// ASSISTANT_KNOWLEDGE_URL tanımlıysa (ör. https://www.istanbul.marketing/llms.txt) metin oradan okunur ve 6 saat
// bellekte tutulur; site açılamazsa son başarılı metin, o da yoksa paketlenmiş kopya kullanılır.

const TTL_MS = 6 * 3_600_000;
let cache: { text: string; at: number } | null = null;

export const knowledgeUrl = () => process.env.ASSISTANT_KNOWLEDGE_URL?.trim() || "";

export async function loadKnowledge(now = Date.now()): Promise<string> {
  const url = knowledgeUrl();
  if (!url) return KNOWLEDGE_SNAPSHOT;
  if (cache && now - cache.at < TTL_MS) return cache.text;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000), headers: { Accept: "text/plain" } });
    const text = res.ok ? (await res.text()).trim() : "";
    // Beklenmedik içerik (ör. HTML hata sayfası) bilgi kaynağına girmez.
    if (text.length > 500 && text.length < 60_000 && text.startsWith("# ")) {
      cache = { text, at: now };
      return text;
    }
  } catch { /* yedeğe düş */ }
  const text = cache?.text || KNOWLEDGE_SNAPSHOT;
  cache = { text, at: now - TTL_MS + 600_000 }; // 10 dk sonra yeniden dene
  return text;
}
