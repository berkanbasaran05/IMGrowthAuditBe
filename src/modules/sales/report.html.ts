import type { PublicReport } from "./report.model.js";
import { CONTACT, gradeOf } from "../audit/plain-language.js";

// Müşteriye açık web raporu (sunucuda üretilen tek HTML sayfası). Tüm dinamik değerler kaçışlanır.

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const pct = (v: number | null) => (v == null ? "–" : `%${Math.round(v * 100)}`);
const band = (s: number | null) => (s == null ? "unk" : s >= 80 ? "ok" : s >= 60 ? "mid" : s >= 40 ? "warn" : "bad");
export const trDate = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });

function gauge(score: number | null) {
  const v = score == null ? 0 : Math.max(0, Math.min(100, score)), a = Math.PI * (1 - v / 100);
  const x = (100 + 80 * Math.cos(a)).toFixed(2), y = (100 - 80 * Math.sin(a)).toFixed(2);
  return `<svg viewBox="0 0 200 112" class="gauge ${band(score)}" role="img" aria-label="Growth Score ${score == null ? "hesaplanamadı" : Math.round(score)}"><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#e6e2da" stroke-width="14" stroke-linecap="round"/>${score == null ? "" : `<path d="M20 100 A80 80 0 0 1 ${x} ${y}" fill="none" stroke="currentColor" stroke-width="14" stroke-linecap="round"/>`}</svg>`;
}

export function renderReportHtml(r: PublicReport, opts: { pdfHref?: string; preview?: boolean } = {}) {
  const site = r.company.website ? r.company.website.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>${esc(r.company.name)} · Growth Audit™ Raporu · Istanbul Marketing</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
:root{--bg:#f5f3ef;--surface:#fff;--ink:#07111f;--muted:#5d6470;--subtle:#8a909a;--line:#e6e2da;--accent:#f04432;--ok:#1f8a4c;--okbg:#e7f4ec;--warn:#b26a00;--warnbg:#fdf1dc;--bad:#c2341f;--badbg:#fde9e5}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;background:var(--bg);color:var(--ink);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:920px;margin:0 auto;padding:28px 20px 60px}
header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;padding-bottom:18px;border-bottom:1px solid var(--line)}
header img{height:22px;width:auto}
header .r{font-size:13px;color:var(--muted);text-align:right}
.btn{display:inline-flex;align-items:center;height:38px;padding:0 14px;border-radius:10px;background:var(--ink);color:#fff;font-weight:700;font-size:13.5px;text-decoration:none}
h1{font-size:30px;letter-spacing:-.03em;line-height:1.15;margin-top:28px}
.sub{color:var(--muted);margin-top:6px}
h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--subtle);margin:34px 0 12px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:18px 20px}
.hero{display:grid;grid-template-columns:220px 1fr;gap:24px;align-items:center;margin-top:22px}
@media(max-width:640px){.hero{grid-template-columns:1fr}}
.g{position:relative;max-width:220px;margin:0 auto}
.gauge{width:100%;height:auto;display:block}.gauge.ok{color:var(--ok)}.gauge.mid{color:var(--ink)}.gauge.warn{color:var(--warn)}.gauge.bad{color:var(--bad)}
.g .v{position:absolute;left:0;right:0;bottom:4px;text-align:center}.g .v b{display:block;font-size:40px;font-weight:800;letter-spacing:-.03em;line-height:1}.g .v span{font-size:12px;color:var(--muted)}
.kv{display:grid;gap:9px;font-size:14px}.kv div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding-bottom:8px}.kv div:last-child{border:0;padding:0}.kv span{color:var(--muted)}
.bars{display:grid;gap:12px}
.bar .h{display:flex;justify-content:space-between;font-size:14px}.bar .h b{font-variant-numeric:tabular-nums}
.bar .t{height:8px;border-radius:99px;background:#f0ede7;margin-top:5px;overflow:hidden}.bar .t i{display:block;height:100%;border-radius:99px;background:var(--ink)}
.bar.ok .t i{background:var(--ok)}.bar.warn .t i{background:var(--warn)}.bar.bad .t i{background:var(--bad)}
.bar small{font-size:12px;color:var(--subtle)}
.list{display:grid;gap:12px}
.item h3{font-size:16px;letter-spacing:-.01em;display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.item p{color:var(--muted);font-size:14px;margin-top:6px}
.item .do{color:var(--ink);margin-top:8px;font-size:14px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.tag{font-size:12px;font-weight:600;padding:3px 9px;border-radius:99px;background:#f5f3ef;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.tag.critical{background:var(--badbg);color:var(--bad);border-color:transparent}.tag.high{background:var(--warnbg);color:var(--warn);border-color:transparent}
.sc{font-weight:800;font-variant-numeric:tabular-nums}
.obs{margin-top:8px;padding-left:16px;color:var(--muted);font-size:13.5px;display:grid;gap:4px}.obs b{color:var(--ink);font-weight:600}
.road{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}@media(max-width:720px){.road{grid-template-columns:1fr}}
.road h3{font-size:15px;margin-bottom:8px}.road li{font-size:13.5px;color:var(--muted);margin:0 0 8px 16px}.road li b{color:var(--ink);font-weight:600;display:block}
.svc{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.svc b{font-size:15px}.svc p{font-size:13.5px;color:var(--muted);margin-top:4px}
.note{font-size:12.5px;color:var(--subtle);margin-top:8px}
.grade{display:inline-block;margin-top:6px;font-size:13px;font-weight:700;padding:3px 10px;border-radius:99px}.grade.ok{background:var(--okbg);color:var(--ok)}.grade.mid{background:#eef0f3;color:var(--ink)}.grade.warn,.grade.bad,.grade.unk{background:var(--badbg);color:var(--bad)}
.lead{font-size:15.5px;color:var(--ink)}.lead p+p{margin-top:8px}
.num{display:inline-flex;width:24px;height:24px;border-radius:99px;background:var(--ink);color:#fff;font-size:12.5px;font-weight:800;align-items:center;justify-content:center;flex:none;margin-right:10px}
.cta{background:var(--ink);color:#fff;border:0;margin-top:36px;padding:26px 24px}.cta h2{color:#fff;opacity:.7;margin:0 0 8px}.cta b{font-size:20px;letter-spacing:-.02em}.cta p{color:#c9cdd4;margin-top:6px}
.cta .acts{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.cta a{display:inline-flex;align-items:center;height:42px;padding:0 16px;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none;background:#fff;color:var(--ink)}.cta a.wa{background:#1f8a4c;color:#fff}
details.tech{margin-top:36px;font-size:13px;color:var(--muted)}details.tech summary{cursor:pointer;color:var(--subtle);font-weight:600}details.tech .card{margin-top:10px}details.tech h3{font-size:14px;margin:14px 0 6px;color:var(--ink)}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--line);font-size:12.5px;color:var(--subtle);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.preview{background:var(--warnbg);color:var(--warn);font-weight:700;font-size:13px;text-align:center;padding:8px}
@media print{body{background:#fff}.btn,.preview,.cta .acts,details.tech{display:none}.card{break-inside:avoid}h2{break-after:avoid}}
</style></head><body>
${opts.preview ? `<div class="preview">İç önizleme — müşteri bu sayfayı yalnızca güvenli rapor bağlantısıyla görür.</div>` : ""}
<div class="wrap">
<header><img src="/brand/logo-wordmark-on-light.png" alt="istanbul.marketing"><div class="r">Growth Audit™ Raporu · ${esc(trDate(r.auditDate))}${opts.pdfHref ? `<div style="margin-top:8px"><a class="btn" href="${esc(opts.pdfHref)}">PDF indir</a></div>` : ""}</div></header>
<h1>${esc(r.company.name)}</h1>
<p class="sub">${[r.company.sector, r.company.location, site].filter(Boolean).map(esc).join(" · ")}</p>

<div class="card hero"><div class="g">${gauge(r.score)}<div class="v"><b>${r.score == null ? "–" : Math.round(r.score)}</b><span>/ 100</span></div></div>
<div><b style="font-size:18px">Web sitenizin genel puanı</b><div><span class="grade ${band(r.score)}">${esc(gradeOf(r.score))}</span></div><p class="note" style="font-size:13.5px">Sitenizi altı başlıkta inceledik: marka mesajı, kullanım kolaylığı, hız, Google'da bulunma, müşteriye dönüştürme ve güven. 80 ve üzeri iyi, 60–79 geliştirilebilir, 60'ın altı acil iyileştirme gerektirir.</p></div></div>

${r.summary ? `<h2>Kısaca durum</h2><div class="card lead"><b style="font-size:17px">${esc(r.summary.headline)}</b><p style="margin-top:8px;color:var(--muted)">${esc(r.summary.narrative)}</p></div>` : ""}

<h2>Başlık başlık puanlar</h2>
<div class="card bars">${r.categories.map((c) => `<div class="bar ${band(c.score)}"><div class="h"><span>${esc(c.name)}</span><b>${c.score == null ? "–" : Math.round(c.score)}</b></div><div class="t"><i style="width:${c.score == null ? 0 : Math.max(2, c.score)}%"></i></div></div>`).join("")}</div>

${r.opportunities.length ? `<h2>Önce bunları düzeltin</h2><div class="list">${r.opportunities.slice(0, 5).map((o, i) => `<div class="card item"><h3><span style="display:flex;align-items:flex-start"><span class="num">${i + 1}</span>${esc(o.title)}</span>${o.priority === "critical" || o.priority === "high" ? `<span class="tag ${esc(o.priority)}">${o.priority === "critical" ? "Acil" : "Önemli"}</span>` : ""}</h3><p>${esc(o.why)}</p><div class="do"><b>Ne yapmalı:</b> ${esc(o.action)}</div></div>`).join("")}</div>` : ""}

${r.roadmap.some((p) => p.items.length) ? `<h2>Adım adım plan</h2><div class="road">${r.roadmap.map((p) => `<div class="card"><h3>${esc(p.phase)}</h3>${p.items.length ? `<ul>${p.items.map((i) => `<li><b>${esc(i.title)}</b></li>`).join("")}</ul>` : `<p class="note">Bu dönem için ek iş yok.</p>`}</div>`).join("")}</div>` : ""}

${r.strengths.length ? `<h2>İyi giden şeyler</h2><div class="card"><ul class="obs" style="margin:0">${r.strengths.map((s) => `<li><b>${esc(s.name)}</b></li>`).join("")}</ul></div>` : ""}

<div class="card cta"><h2>Sonraki adım</h2><b>Bu sorunları birlikte çözelim</b><p>Raporu 15 dakikalık ücretsiz bir görüşmede sizinle birlikte gözden geçirelim; hangi işin önce yapılması gerektiğini netleştirelim.</p>
<div class="acts"><a class="wa" href="https://wa.me/${esc(CONTACT.whatsapp)}" rel="noopener noreferrer" target="_blank">WhatsApp'tan yazın</a><a href="tel:${esc(CONTACT.phone)}">Arayın: ${esc(CONTACT.phoneDisplay)}</a><a href="mailto:${esc(CONTACT.email)}">${esc(CONTACT.email)}</a></div></div>

<details class="tech"><summary>Teknik detaylar</summary><div class="card">
<div class="kv"><div><span>Analiz tarihi</span><b>${esc(trDate(r.auditDate))}</b></div><div><span>Veri kapsamı</span><b>${pct(r.coverage)}</b></div><div><span>Güven düzeyi</span><b>${pct(r.confidence)}</b></div><div><span>Puanlama sürümü</span><b>${esc(r.scoringVersion)}</b></div></div>
${r.services.length ? `<h3>Önerilen hizmetler</h3><p>${r.services.map((s) => esc(s.name)).join(" · ")}</p>` : ""}
${r.findings.length ? `<h3>Kontrol ayrıntıları</h3><ul class="obs">${r.findings.map((f) => `<li><b>${esc(f.name)} (${f.score}/100):</b> ${f.observations.map((o) => `${esc(o.source)} — ${esc(o.text)}`).join("; ")}</li>`).join("")}</ul>` : ""}
<h3>Notlar</h3><ul class="obs">${r.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
</div></details>

<footer><span>© Istanbul Marketing · <a href="${CONTACT.site}" style="color:inherit">istanbul.marketing</a></span><span>Growth Audit™ · ${esc(trDate(r.auditDate))}</span></footer>
</div></body></html>`;
}
