import { isAuthed } from "../lib/auth.js";
import { redis, getOne, put } from "../lib/redis.js";
import { mailConfig, sendMail } from "../lib/mail.js";

const STEPS = ["İlk mail", "1. takip", "2. takip", "Kapanış"];
const ID = /^[a-z0-9-]{1,120}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUE = [0, 3, 7, 14]; // adım → ilk mailden itibaren gün
const STOP = ["red", "musteri", "cevap", "toplanti"];
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });

export default async function handler(req, res) {
  if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
  const cfg = mailConfig();
  const dayKey = `sent:${today()}`;

  if (req.method === "GET") {
    const sentToday = Number((await redis("GET", dayKey).catch(() => 0)) || 0);
    const sends = ((await redis("LRANGE", "sends", 0, 199).catch(() => [])) || []).map((x) => JSON.parse(x));
    return res.status(200).json({ ...cfg, sentToday, sends });
  }
  if (req.method !== "POST") return res.status(405).end();
  if (!cfg.configured) return res.status(400).json({ error: "Mail hesabı bağlı değil. Vercel'de SMTP ayarlarını ekleyin." });

  const { id, step, test } = req.body || {};

  // Test: yalnızca gönderen adrese gider, firma kaydını değiştirmez
  if (test) {
    try {
      const r = await sendMail({ to: cfg.from, subject: "IM Growth Audit · test maili", text: "Bu bir test mailidir. SMTP ayarlarınız çalışıyor.\n\nİstanbul Marketing" });
      return res.status(200).json({ ok: true, to: cfg.from, messageId: r.messageId });
    } catch (e) { return res.status(502).json({ error: "Gönderilemedi: " + e.message }); }
  }

  if (!ID.test(id || "") || ![0, 1, 2, 3].includes(step)) return res.status(400).json({ error: "Geçersiz istek" });
  const lead = await getOne("leads", id);
  if (!lead) return res.status(404).json({ error: "Firma bulunamadı" });
  if (!lead.email || !EMAIL.test(lead.email)) return res.status(400).json({ error: "Bu firmanın geçerli bir e-posta adresi yok." });
  if (STOP.includes(lead.status) || lead.optOut) return res.status(409).json({ error: "Bu firmaya gönderim kapalı (cevap verdi, görüşme, müşteri ya da ilgilenmiyor)." });

  const seq = lead.seq && !lead.seq.__none ? lead.seq : { step: -1, log: [] };
  const expected = (seq.step ?? -1) + 1;
  if (step !== expected) return res.status(409).json({ error: `Sıradaki adım "${STEPS[expected] || "yok"}". Aynı adım iki kez gönderilemez.` });

  if (step === 0 && lead.status !== "yeni") return res.status(409).json({ error: "İlk mail yalnızca henüz iletişime geçilmemiş (Yeni) firmalara gönderilir." });
  if (step > 0) {
    if (lead.status !== "iletisim") return res.status(409).json({ error: "Takip maili yalnızca \"İletişimde\" olan firmalara gönderilir." });
    const waited = seq.sentAt ? daysBetween(seq.sentAt, today()) : 0;
    if (waited < DUE[step]) return res.status(409).json({ error: `Bu takip henüz zamanı gelmedi (ilk mailden ${DUE[step]} gün sonra; şu an ${waited}. gün).` });
  }

  const o = lead.outreach || {};
  const m = step === 0 ? { subject: o.subject, body: o.body } : o.followups?.[step - 1];
  if (!m?.subject || !m?.body) return res.status(400).json({ error: "Bu adımın metni yok." });

  // Günlük limit (atomik sayaç)
  const used = await redis("INCR", dayKey);
  if (used === 1) await redis("EXPIRE", dayKey, 60 * 60 * 36);
  if (used > cfg.limit) { await redis("DECR", dayKey); return res.status(429).json({ error: `Günlük gönderim limiti (${cfg.limit}) doldu.` }); }

  const firstId = seq.messageIds?.[0];
  let r;
  try {
    r = await sendMail({ to: lead.email, subject: m.subject, text: m.body, inReplyTo: step > 0 ? firstId : undefined, references: step > 0 ? (seq.messageIds || []).join(" ") : undefined });
  } catch (e) {
    await redis("DECR", dayKey);
    return res.status(502).json({ error: "Gönderilemedi: " + e.message });
  }

  const d = today();
  const next = {
    ...lead,
    status: "iletisim",
    statusAt: new Date().toISOString(),
    seq: {
      ...seq, step, sentAt: step === 0 ? d : (seq.sentAt || d),
      messageIds: [...(seq.messageIds || []), r.messageId],
      log: [...(seq.log || []), { date: d, label: `${STEPS[step]} e-postayla gönderildi (${lead.email})` }],
    },
  };
  await put("leads", id, next);
  await redis("LPUSH", "sends", JSON.stringify({ at: new Date().toISOString(), id, name: lead.name, to: lead.email, step, subject: m.subject, messageId: r.messageId }));
  await redis("LTRIM", "sends", 0, 999);
  return res.status(200).json({ ok: true, lead: { id, ...next }, sentToday: used, limit: cfg.limit });
}
