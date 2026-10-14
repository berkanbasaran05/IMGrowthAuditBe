import { publicMessage } from "../../../infrastructure/http/http-hardening.js";
import { isAuthed } from "../lib/auth.js";
import { redis } from "../lib/redis.js";

export default async function handler(req, res) {
  if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
  try {
    if (req.method === "GET") {
      const [list, seen, bookings] = await Promise.all([
        redis("LRANGE", "events", 0, 99), redis("GET", "events:seen"), redis("HGETALL", "bookings"),
      ]);
      const events = (list || []).map((x) => JSON.parse(x));
      const b = []; for (let i = 0; i < (bookings || []).length; i += 2) b.push({ id: bookings[i], ...JSON.parse(bookings[i + 1]) });
      b.sort((x, y) => y.at.localeCompare(x.at));
      return res.status(200).json({ events, seenAt: seen || "", unread: events.filter((e) => e.at > (seen || "")).length, bookings: b,
        telegramConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) });
    }
    if (req.method === "POST") { await redis("SET", "events:seen", new Date().toISOString()); return res.status(200).json({ ok: true }); }
    if (req.method === "PATCH") {
      const { id, status } = req.body || {};
      const cur = await redis("HGET", "bookings", String(id || ""));
      if (!cur) return res.status(404).json({ error: "Bulunamadı" });
      await redis("HSET", "bookings", id, JSON.stringify({ ...JSON.parse(cur), status: String(status || "").slice(0, 30) }));
      return res.status(200).json({ ok: true });
    }
    res.status(405).end();
  } catch (e) { res.status(500).json({ error: publicMessage(e) }); }
}
