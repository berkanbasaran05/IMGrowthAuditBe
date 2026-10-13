import { isAuthed } from "../lib/auth.js";
import { getOne, put } from "../lib/redis.js";
import { renderDemo, model, pagesOf, extras } from "../lib/demo-template.js";

// Panel araçları: ?action=psi (PageSpeed ölçümü) · ?action=qc (demo kalite kontrolü)
const SITE = "https://istanbulmarketingmusteribulma.vercel.app";
const CHECK = [/sigortal[ıi]/i, /ücretsiz/i, /garantili/i, /7\/24/, /uzman kadro/i];
const BANNED = [/sektörün lideri/i, /\b1 numara/i, /türkiye'nin en/i, /en iyi (klinik|kuaför|pastane|nakliyat)/i, /garanti(li)? (sonuç|sıralama)/i, /%100/];

export default async function handler(req, res) {
  if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
  const id = String(req.query.id || "");
  const lead = /^[a-z0-9-]{1,120}$/.test(id) ? await getOne("leads", id) : null;
  if (!lead?.demo) return res.status(404).json({ error: "Demo bulunamadı" });
  try {
    if (req.query.action === "psi") {
      const url = `${SITE}/demo/${id}?preview=1`;
      const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo${process.env.PSI_KEY ? "&key=" + process.env.PSI_KEY : ""}`;
      const r = await fetch(api); const j = await r.json();
      if (!r.ok || !j.lighthouseResult) return res.status(502).json({ error: j.error?.message || "Ölçüm yapılamadı" });
      const c = j.lighthouseResult.categories, perf = { at: new Date().toISOString() };
      for (const k of ["performance", "accessibility", "best-practices", "seo"]) perf[k] = Math.round((c[k]?.score || 0) * 100);
      await put("leads", id, { ...lead, demo: { ...lead.demo, perf } });
      return res.status(200).json({ ok: true, perf });
    }
    if (req.query.action === "qc") {
      const M = model({ ...lead, id }), issues = [], checks = [];
      const paths = ["", ...pagesOf(M).map(([k]) => k).filter(Boolean), ...M.services.map((s) => "hizmetler/" + s.slug), ...extras(M).arts.slice(0, 3).map((a) => "blog/" + a.slug), "sss", "randevu", "iletisim", "kvkk", "site-haritasi", "sunum"];
      let text = "";
      for (const p of [...new Set(paths)]) {
        if (p === "sunum") { checks.push(p); continue; }
        const html = renderDemo({ ...lead, id }, { bannerHref: "/teklif", page: p, preview: true });
        if (!html) issues.push(`Sayfa açılmıyor: /${p || "(ana sayfa)"}`); else { checks.push(p); text += html.replace(/<[^>]+>/g, " "); }
      }
      const imgs = [...(lead.demo.images || []), lead.demo.logo].filter(Boolean);
      const bad = [];
      await Promise.all(imgs.map(async (u) => { try { const r = await fetch(u, { method: "GET", headers: { Range: "bytes=0-64" } }); if (!r.ok || !(r.headers.get("content-type") || "").startsWith("image/")) bad.push(u); } catch { bad.push(u); } }));
      if (bad.length) issues.push(`${bad.length} görsel yüklenmiyor`);
      if (!lead.phone) issues.push("Telefon numarası yok (arama ve WhatsApp düğmeleri çalışmaz)");
      else if (String(lead.phone).split("/")[0].replace(/\D/g, "").length < 10) issues.push("Telefon numarası eksik görünüyor");
      if (!(lead.demo.services || []).length) issues.push("Hizmet listesi boş");
      if (!(lead.demo.story || []).length && !lead.demo.about) issues.push("Hakkımızda metni yok");
      for (const r of BANNED) if (r.test(text)) issues.push(`Doğrulanamayan iddia: "${text.match(r)[0]}"`);
      if (/\{n\}|\{d\}|undefined|null/.test(text)) issues.push("Doldurulmamış şablon ifadesi var");
      for (const r of CHECK) if (r.test(text)) issues.push(`Firmayla doğrulanmalı: "${text.match(r)[0]}" ifadesi geçiyor`);
      const qc = { at: new Date().toISOString(), pages: checks.length, issues, ok: issues.length === 0 };
      await put("leads", id, { ...lead, demo: { ...lead.demo, qc } });
      return res.status(200).json({ ok: true, qc });
    }
    res.status(400).json({ error: "Geçersiz işlem" });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
