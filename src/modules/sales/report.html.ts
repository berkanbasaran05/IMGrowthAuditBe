import type { PublicReport } from "./report.model.js";

// Müşteriye açık web raporu (sunucuda üretilen tek HTML sayfası). Tüm dinamik değerler kaçışlanır.

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const pct = (v: number | null) => (v == null ? "–" : `%${Math.round(v * 100)}`);
const band = (s: number | null) => (s == null ? "unk" : s >= 80 ? "ok" : s >= 60 ? "mid" : s >= 40 ? "warn" : "bad");
const PRIORITY: Record<string, string> = { critical: "Kritik", high: "Yüksek etki", medium: "Orta", low: "Düşük" };
const IMPACT: Record<string, string> = { high: "Yüksek", medium: "Orta", low: "Düşük" };
const DIFF: Record<string, string> = { easy: "Kolay", medium: "Orta", hard: "Zor" };
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
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--line);font-size:12.5px;color:var(--subtle);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.preview{background:var(--warnbg);color:var(--warn);font-weight:700;font-size:13px;text-align:center;padding:8px}
@media print{body{background:#fff}.btn,.preview{display:none}.card{break-inside:avoid}h2{break-after:avoid}}
</style></head><body>
${opts.preview ? `<div class="preview">İç önizleme — müşteri bu sayfayı yalnızca güvenli rapor bağlantısıyla görür.</div>` : ""}
<div class="wrap">
<header><img src="/brand/logo-wordmark-on-light.png" alt="istanbul.marketing"><div class="r">Growth Audit™ Raporu · ${esc(trDate(r.auditDate))}${opts.pdfHref ? `<div style="margin-top:8px"><a class="btn" href="${esc(opts.pdfHref)}">PDF indir</a></div>` : ""}</div></header>
<h1>${esc(r.company.name)}</h1>
<p class="sub">${[r.company.sector, r.company.location, site].filter(Boolean).map(esc).join(" · ")}</p>

<div class="card hero"><div class="g">${gauge(r.score)}<div class="v"><b>${r.score == null ? "–" : Math.round(r.score)}</b><span>Growth Score™ / 100</span></div></div>
<div class="kv"><div><span>Veri kapsamı</span><b>${pct(r.coverage)}</b></div><div><span>Güven düzeyi</span><b>${pct(r.confidence)}</b></div><div><span>Denetim tarihi</span><b>${esc(trDate(r.auditDate))}</b></div><div><span>Puanlama sürümü</span><b>${esc(r.scoringVersion)}</b></div></div></div>
<p class="note">Growth Score, sitenin dijital olgunluğunu altı kategoride 0–100 arasında ölçer. Ölçülemeyen metrikler sıfır sayılmaz; kapsam ayrıca gösterilir.</p>

${r.summary ? `<h2>Yönetici özeti</h2><div class="card"><b style="font-size:17px">${esc(r.summary.headline)}</b><p style="margin-top:8px">${esc(r.summary.narrative)}</p></div>` : ""}

<h2>Kategori puanları</h2>
<div class="card bars">${r.categories.map((c) => `<div class="bar ${band(c.score)}"><div class="h"><span>${esc(c.name)} <small>· ağırlık %${c.weight}</small></span><b>${c.score == null ? "–" : Math.round(c.score)}</b></div><div class="t"><i style="width:${c.score == null ? 0 : Math.max(2, c.score)}%"></i></div><small>Kapsam ${pct(c.coverage)}</small></div>`).join("")}</div>

${r.opportunities.length ? `<h2>Öncelikli büyüme fırsatları</h2><div class="list">${r.opportunities.slice(0, 8).map((o) => `<div class="card item"><h3>${esc(o.title)}<span class="tag ${esc(o.priority)}">${esc(PRIORITY[o.priority] || o.priority)}</span></h3><p>${esc(o.problem)}</p><div class="do"><b>Önerilen adım:</b> ${esc(o.action)}</div><div class="tags"><span class="tag">Etki: ${esc(IMPACT[o.impact] || o.impact)}</span><span class="tag">Zorluk: ${esc(DIFF[o.difficulty] || o.difficulty)}</span><span class="tag">${o.basis === "observed" ? "Ölçülmüş bulgu" : "Değerlendirme"}</span>${o.service ? `<span class="tag">${esc(o.service)}</span>` : ""}</div></div>`).join("")}</div>` : ""}

${r.roadmap.some((p) => p.items.length) ? `<h2>30 / 60 / 90 günlük yol haritası</h2><div class="road">${r.roadmap.map((p) => `<div class="card"><h3>${esc(p.phase)}</h3>${p.items.length ? `<ul>${p.items.map((i) => `<li><b>${esc(i.title)}</b>${esc(i.action)}</li>`).join("")}</ul>` : `<p class="note">Bu dönem için ek iş öngörülmedi.</p>`}</div>`).join("")}</div>` : ""}

${r.services.length ? `<h2>Önerilen Istanbul Marketing hizmetleri</h2><div class="svc">${r.services.map((s) => `<div class="card"><b>${esc(s.name)}</b><p>${s.reasons.map(esc).join(" · ")}</p></div>`).join("")}</div>` : ""}

${r.findings.length ? `<h2>Kanıta dayalı bulgular</h2><div class="list">${r.findings.map((f) => `<div class="card item"><h3>${esc(f.name)}<span class="sc">${f.score}</span></h3><p>${esc(f.category)} · ${f.state === "MEASURED" ? "Ölçüldü" : "Tahmini"}</p><ul class="obs">${f.observations.map((o) => `<li><b>${esc(o.source)}:</b> ${esc(o.text)}</li>`).join("")}</ul>${f.recommendation ? `<div class="do"><b>Öneri:</b> ${esc(f.recommendation)}</div>` : ""}</div>`).join("")}</div>` : ""}

${r.strengths.length ? `<h2>Güçlü yönler</h2><div class="card"><ul class="obs" style="margin:0">${r.strengths.map((s) => `<li><b>${esc(s.name)} (${s.score}):</b> ${esc(s.observation)}</li>`).join("")}</ul></div>` : ""}

<h2>Kapsam ve sınırlamalar</h2><div class="card"><ul class="obs" style="margin:0">${r.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>

<footer><span>© Istanbul Marketing · istanbul.marketing</span><span>Istanbul Marketing Growth Audit™ · ${esc(r.scoringVersion)}</span></footer>
</div></body></html>`;
}
