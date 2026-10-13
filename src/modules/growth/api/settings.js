import { isAuthed } from "../lib/auth.js";
import { redis } from "../lib/redis.js";
import { getSettings } from "../lib/events.js";

export default async function handler(req, res) {
  if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
  try {
    if (req.method === "GET") return res.status(200).json(await getSettings());
    if (req.method === "PUT") {
      const cur = await getSettings(), b = req.body || {};
      const next = { offer: { ...cur.offer, ...(b.offer || {}) }, demo: { ...cur.demo, ...(b.demo || {}) } };
      const pk = next.offer.packages;
      if (!Array.isArray(pk) || pk.length > 6) return res.status(400).json({ error: "En fazla 6 paket" });
      next.telegram = undefined;
      await redis("SET", "settings", JSON.stringify(next));
      return res.status(200).json({ ...next, telegramConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) });
    }
    res.status(405).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
}
