import type { PublicReport } from "./report.model.js";
import { trDate } from "./report.html.js";
import { gradeOf } from "../audit/plain-language.js";

// Instagram DM şablon kartı için skor görseli (1080x1080 kare; Instagram şablon görselini kare kırpar). SVG → PNG, @resvg/resvg-js ile;
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
  const W = 1080, P = 80, BW = W - 2 * P;
  const score = i.score, grade = i.grade || gradeOf(score);
  const cx = W / 2, cy = 330, r = 118, circ = 2 * Math.PI * r, frac = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const cats = i.categories.slice(0, 6);
  // Kategoriler iki sütunda (3 + 3): Instagram kartı kare kırptığı için her şey kare alana sığmalı.
  const colW = (BW - 48) / 2;
  const rows = cats.map((c, k) => {
    const x = P + (k % 2) * (colW + 48), y = 668 + Math.floor(k / 2) * 92, fill = c.score == null ? 0 : Math.max(8, (colW * c.score) / 100);
    return `<text x="${x}" y="${y}" font-family="${F}" font-weight="600" font-size="26" fill="${C.ink}">${esc(clip(c.name, 22))}</text>
<text x="${x + colW}" y="${y}" text-anchor="end" font-family="${F}" font-weight="800" font-size="26" fill="${band(c.score)}">${c.score ?? "–"}</text>
<rect x="${x}" y="${y + 16}" width="${colW}" height="10" rx="5" fill="${C.track}"/>
<rect x="${x}" y="${y + 16}" width="${fill.toFixed(1)}" height="10" rx="5" fill="${band(c.score)}"/>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
<rect width="${W}" height="${W}" fill="${C.bg}"/>
<circle cx="${P + 8}" cy="${P + 2}" r="9" fill="${C.accent}"/>
<text x="${P + 28}" y="${P + 11}" font-family="${F}" font-weight="800" font-size="30" fill="${C.ink}">istanbul.marketing</text>
<text x="${W - P}" y="${P + 10}" text-anchor="end" font-family="${F}" font-weight="600" font-size="22" fill="${C.muted}">${i.date ? esc(trDate(i.date)) : "Web Sitesi Analizi"}</text>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.track}" stroke-width="22"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${band(score)}" stroke-width="22" stroke-linecap="round" stroke-dasharray="${(circ * frac).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>
<text x="${cx}" y="${cy + 28}" text-anchor="middle" font-family="${F}" font-weight="800" font-size="92" fill="${C.ink}">${score ?? "–"}</text>
<text x="${cx}" y="${cy + 66}" text-anchor="middle" font-family="${F}" font-weight="600" font-size="22" fill="${C.muted}">/ 100</text>
<text x="${cx}" y="${cy + r + 70}" text-anchor="middle" font-family="${F}" font-weight="800" font-size="46" fill="${C.ink}">${esc(clip(i.domain, 28))}</text>
<text x="${cx}" y="${cy + r + 116}" text-anchor="middle" font-family="${F}" font-weight="800" font-size="30" fill="${band(score)}">${esc(grade)}</text>
<line x1="${P}" y1="606" x2="${W - P}" y2="606" stroke="${C.track}" stroke-width="2"/>
${rows}
<text x="${cx}" y="${W - 52}" text-anchor="middle" font-family="${F}" font-weight="400" font-size="21" fill="${C.muted}">6 kategoride, 30+ kriterle değerlendirildi</text>
<rect x="0" y="${W - 10}" width="${W}" height="10" fill="${C.accent}"/>
</svg>`;
}

export async function renderCardPng(i: CardInput): Promise<Buffer> {
  const { Resvg } = await import("@resvg/resvg-js");
  const r = new Resvg(renderCardSvg(i), { font: { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: "Plus Jakarta Sans" }, fitTo: { mode: "width", value: 1080 } });
  return Buffer.from(r.render().asPng());
}
