import nodemailer from "nodemailer";

// SMTP ayarları yalnızca ortam değişkenlerinden okunur (şifre koda yazılmaz)
const cfg = () => ({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.SMTP_FROM || process.env.SMTP_USER,
  fromName: process.env.SMTP_FROM_NAME || "istanbul.marketing",
  limit: Number(process.env.SEND_DAILY_LIMIT || 25),
});

// MAIL_DRY_RUN=1: gerçek mail göndermeden akışı sınamak için (yalnızca geliştirme)
const dry = () => process.env.MAIL_DRY_RUN === "1";

export function mailConfig() {
  const c = cfg();
  if (dry()) return { configured: true, dryRun: true, from: c.from || "kuru-calisma@yerel", fromName: c.fromName, limit: c.limit };
  return { configured: !!(c.host && c.user && c.pass && c.from), dryRun: false, from: c.from || null, fromName: c.fromName, limit: c.limit };
}

let transport;
function getTransport() {
  const c = cfg();
  transport ??= nodemailer.createTransport({
    host: c.host, port: c.port, secure: c.port === 465,
    auth: { user: c.user, pass: c.pass },
  });
  return transport;
}

const FOOTER = "\n\nBu iletiyi almak istemiyorsanız bu e-postayı \"çıkış\" yazarak yanıtlamanız yeterli.";

export async function sendMail({ to, subject, text, inReplyTo, references }) {
  const c = cfg();
  if (dry()) return { messageId: `<kuru-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@yerel>`, accepted: [to], rejected: [], dry: true };
  const body = /rahatsız etmeyiz|çıkış/i.test(text || "") ? text : (text || "") + FOOTER;
  const info = await getTransport().sendMail({
    from: { name: c.fromName, address: c.from },
    to, subject, text: body,
    headers: { "List-Unsubscribe": `<mailto:${c.from}?subject=Cikis>` },
    ...(inReplyTo ? { inReplyTo, references: references || inReplyTo } : {}),
  });
  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}
