import { isAuthed } from "../lib/auth.js";
import { getOne, put } from "../lib/redis.js";
import { addEvent } from "../lib/events.js";
import { renderDemo, renderGone } from "../lib/demo-template.js";
import { renderSunum } from "../lib/sunum.js";
import { getSettings } from "../lib/events.js";

// /sunum/:slug (ve eski /demo/:slug adresleri) → firmaya özel sunum. Panel kullanıcısının ve önizlemenin açışları sayılmaz.
export default async function handler(req, res) {
  const slug = String(req.query.slug || "");
  let page = String(req.query.page || "").replace(/^\/+|\/+$/g, "").toLowerCase();
  if (page.includes(":")) page = ""; // sonda eğik çizgi: /demo/firma/
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
  if (!/^[a-z0-9-]{1,120}$/.test(slug) || !/^[a-z0-9/-]{0,120}$/.test(page)) return res.status(404).send(renderGone());
  // Demo site kaldırıldı: yalnızca size özel sunum yayında; diğer tüm adresler sunuma yönlenir
  if (page !== "sunum") { const u = new URL(req.url, "http://x"); u.searchParams.delete("slug"); u.searchParams.delete("page"); const qs = u.searchParams.toString(); res.statusCode = 302; res.setHeader("Location", `/sunum/${slug}${qs ? "?" + qs : ""}`); return res.end(); }
  const lead = await getOne("leads", slug).catch(() => null);
  const d = lead?.demo || {};
  const expired = d?.expiresAt && d.expiresAt < new Date().toISOString();
  if (!lead || d.enabled === false || expired) return res.status(404).send(renderGone());

  const preview = req.query.preview === "1", embed = req.query.embed === "1";
  const internal0 = isAuthed(req) || preview;
  const html = page === "sunum"
    ? renderSunum({ ...lead, id: slug }, await getSettings().catch(() => ({})), { base: `/demo/${slug}`, preview: internal0 })
    : renderDemo({ ...lead, id: slug }, { bannerHref: `/demo/${slug}/sunum${preview ? "?preview=1" : ""}`, page, preview, embed, track: !internal0 && !embed });
  if (!html) return res.status(404).send(renderGone());

  const internal = internal0 || embed;
  const bot = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord/i.test(String(req.headers["user-agent"] || ""));
  if (!internal && !bot) {
    const now = new Date().toISOString();
    const pages = { ...(lead.demoPages || {}) }; pages[page || "ana-sayfa"] = (pages[page || "ana-sayfa"] || 0) + 1;
    await put("leads", slug, { ...lead, demoViews: (lead.demoViews || 0) + 1, demoLastView: now, demoFirstView: lead.demoFirstView || now, demoPages: pages });
    if (!lead.demoLastView || Date.parse(now) - Date.parse(lead.demoLastView) > 30 * 60 * 1000)
      await addEvent("demo_view", { id: slug, name: lead.name, views: (lead.demoViews || 0) + 1, page: page || "ana-sayfa" });
  }
  res.status(200).send(html);
}
