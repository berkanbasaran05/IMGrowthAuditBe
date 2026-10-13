import { redis } from "./redis.js";

// Olay kaydı + isteğe bağlı Telegram bildirimi (TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID tanımlıysa)
export async function addEvent(type, data = {}) {
  const ev = { type, at: new Date().toISOString(), ...data };
  await redis("LPUSH", "events", JSON.stringify(ev));
  await redis("LTRIM", "events", 0, 499);
  const tok = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (tok && chat) {
    const text = {
      demo_view: `👀 ${data.name} sunumu açtı`,
      booking: `📅 Yeni görüşme talebi: ${data.business || data.name} (${data.phone || ""})`,
      ads_form: `📝 ${data.name} Google Ads başlangıç formunu doldurdu`,
    }[type] || `${type}: ${data.name || ""}`;
    await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: text + "\nhttps://istanbulmarketingmusteribulma.vercel.app" }),
    }).catch(() => {});
  }
  return ev;
}

export const DEFAULT_SETTINGS = {
  offer: {
    headline: "İşletmenizi dijitalde büyütüyoruz",
    sub: "Web sitesi, performans reklamları ve sosyal medya; strateji, tasarım ve teknolojiyi tek ekipte birleştiriyoruz.",
    promise: "",
    packages: [],
    contactPhone: "",
    contactEmail: "business@istanbul.marketing",
    whatsapp: "",
  },
  demo: { expiryDays: 30, autoScore: 70 },
};

export async function getSettings() {
  const raw = await redis("GET", "settings");
  const s = raw ? JSON.parse(raw) : {};
  return { offer: { ...DEFAULT_SETTINGS.offer, ...(s.offer || {}) }, demo: { ...DEFAULT_SETTINGS.demo, ...(s.demo || {}) } };
}
