import type { PublicReport } from "./report.model.js";
import { trDate } from "./report.html.js";
import { gradeOf } from "../audit/plain-language.js";

// Instagram DM şablon kartı için skor görseli (1200x628, 1.91:1). SVG → PNG, @resvg/resvg-js ile;
// yazı tipi (Plus Jakarta Sans) dosyadan yüklenir, sistem yazı tiplerine bağımlı değildir.

const FONT = (w: string) => require.resolve(`@expo-google-fonts/plus-jakarta-sans/${w}/PlusJakartaSans_${w}.ttf`);
let fonts: string[] | null = null;
const fontFiles = () => (fonts ??= ["400Regular", "600SemiBold", "800ExtraBold"].map(FONT));

const C = { bg: "#07111f", panel: "#0e1b2e", track: "#1c2b40", ink: "#ffffff", muted: "#9aa5b4", accent: "#f04432", ok: "#2fbf71", mid: "#f5f3ef", warn: "#f2a33a", bad: "#f04432" };
const band = (s: number | null) => (s == null ? C.muted : s >= 80 ? C.ok : s >= 60 ? C.mid : s >= 40 ? C.warn : C.bad);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export interface CardInput { domain: string; score: number | null; grade?: string; date?: string; categories: { name: string; score: number | null }[] }

export function cardInputFromReport(r: PublicReport): CardInput {
  const domain = String(r.company.website || r.company.name || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return { domain, score: r.score == null ? null : Math.round(r.score), date: r.auditDate, categories: r.categories.map((c) => ({ name: c.name, score: c.score == null ? null : Math.round(c.score) })) };
}

export function renderCardSvg(i: CardInput): string {
  const F = "Plus Jakarta Sans";
  const score = i.score, grade = i.grade || gradeOf(score);
  const cx = 250, cy = 340, r = 132, circ = 2 * Math.PI * r, frac = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const cats = i.categories.slice(0, 6);
  const rows = cats.map((c, k) => {
    const y = 268 + k * 52, fill = c.score == null ? 0 : Math.max(8, (576 * c.score) / 100);
    return `<text x="560" y="${y}" font-family="${F}" font-weight="600" font-size="21" fill="${C.ink}">${esc(clip(c.name, 30))}</text>
<text x="1136" y="${y}" text-anchor="end" font-family="${F}" font-weight="800" font-size="21" fill="${band(c.score)}">${c.score ?? "–"}</text>
<rect x="560" y="${y + 12}" width="576" height="8" rx="4" fill="${C.track}"/>
<rect x="560" y="${y + 12}" width="${fill.toFixed(1)}" height="8" rx="4" fill="${band(c.score)}"/>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="628" viewBox="0 0 1200 628">
<rect width="1200" height="628" fill="${C.bg}"/>
<circle cx="72" cy="66" r="8" fill="${C.accent}"/>
<text x="90" y="74" font-family="${F}" font-weight="800" font-size="24" fill="${C.ink}">istanbul.marketing</text>
<text x="1136" y="74" text-anchor="end" font-family="${F}" font-weight="600" font-size="18" fill="${C.muted}">Web Sitesi Analizi${i.date ? ` · ${esc(trDate(i.date))}` : ""}</text>
<text x="560" y="170" font-family="${F}" font-weight="800" font-size="44" fill="${C.ink}">${esc(clip(i.domain, 30))}</text>
<text x="560" y="208" font-family="${F}" font-weight="400" font-size="20" fill="${C.muted}">6 kategoride, 30+ kriterle değerlendirildi</text>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.track}" stroke-width="22"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${band(score)}" stroke-width="22" stroke-linecap="round" stroke-dasharray="${(circ * frac).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>
<text x="${cx}" y="${cy + 30}" text-anchor="middle" font-family="${F}" font-weight="800" font-size="96" fill="${C.ink}">${score ?? "–"}</text>
<text x="${cx}" y="${cy + 70}" text-anchor="middle" font-family="${F}" font-weight="600" font-size="22" fill="${C.muted}">/ 100</text>
<text x="${cx}" y="${cy + r + 66}" text-anchor="middle" font-family="${F}" font-weight="800" font-size="26" fill="${band(score)}">${esc(grade)}</text>
${rows}
<rect x="0" y="620" width="1200" height="8" fill="${C.accent}"/>
</svg>`;
}

export async function renderCardPng(i: CardInput): Promise<Buffer> {
  const { Resvg } = await import("@resvg/resvg-js");
  const r = new Resvg(renderCardSvg(i), { font: { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: "Plus Jakarta Sans" }, fitTo: { mode: "width", value: 1200 } });
  return Buffer.from(r.render().asPng());
}
