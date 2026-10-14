// Instagram buzkıranlarını (ice breakers) ayarlar ve mevcut durumu yazdırır. İdempotent: aynı liste zaten
// tanımlıysa yeniden yazmaz. Belirteç .env'deki IG_ACCESS_TOKEN'dır ve asla yazdırılmaz.
// Kullanım: npm run ig:setup-profile            (ayarla + göster)
//           npm run ig:setup-profile -- --show  (yalnızca göster)
import "dotenv/config";

const ICE_BREAKERS = [
  { question: "🔎 Ücretsiz site analizi", payload: "START_AUDIT" },
  { question: "💬 Ekiple görüşmek istiyorum", payload: "TALK_TO_TEAM" },
  { question: "ℹ️ Analiz neleri kapsıyor?", payload: "ABOUT_AUDIT" },
];

const token = process.env.IG_ACCESS_TOKEN;
const version = /^v\d+\.\d+$/.test(process.env.IG_GRAPH_VERSION || "") ? process.env.IG_GRAPH_VERSION : "v25.0";
if (!token) { console.error("IG_ACCESS_TOKEN tanımlı değil (.env)"); process.exit(1); }
const base = `https://graph.instagram.com/${version}/me/messenger_profile`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function call(url, init = {}) {
  const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(15_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}${body?.error ? ` · ${body.error.code ?? ""} ${body.error.message ?? ""}` : ""}`);
  return body;
}
const current = async () => (await call(`${base}?fields=ice_breakers&platform=instagram`)).data?.[0]?.call_to_actions ?? [];
const print = (list) => { if (!list.length) console.log("  (tanımlı buzkıran yok)"); for (const c of list) console.log(`  - ${c.question}  →  ${c.payload}`); };
const same = (a, b) => a.length === b.length && a.every((x, i) => x.question === b[i].question && x.payload === b[i].payload);

try {
  const before = await current();
  console.log("Mevcut buzkıranlar:"); print(before);
  if (process.argv.includes("--show")) process.exit(0);
  if (same(before, ICE_BREAKERS)) { console.log("Zaten güncel; değişiklik yapılmadı."); process.exit(0); }
  await call(base, { method: "POST", body: JSON.stringify({ platform: "instagram", ice_breakers: [{ call_to_actions: ICE_BREAKERS }] }) });
  console.log("Buzkıranlar ayarlandı. Şimdiki durum:"); print(await current());
} catch (e) { console.error(`Hata: ${e.message}`); process.exit(1); }
