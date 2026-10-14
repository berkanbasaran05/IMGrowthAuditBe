import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PublicReport } from "./report.model.js";
import { trDate } from "./report.html.js";

// Growth Audit™ PDF raporu. Türkçe karakterler için marka yazı tipi (Plus Jakarta Sans, OFL) gömülür.

const C = { ink: "#07111f", muted: "#5d6470", subtle: "#8a909a", line: "#e6e2da", soft: "#f5f3ef", accent: "#f04432", ok: "#1f8a4c", warn: "#b26a00", bad: "#c2341f" };
const FONT = (weight: string) => require.resolve(`@expo-google-fonts/plus-jakarta-sans/${weight}/PlusJakartaSans_${weight}.ttf`);
const LOGO = path.resolve(process.cwd(), "assets/brand/logo-wordmark-on-light.png");
const PRIORITY: Record<string, string> = { critical: "Kritik", high: "Yüksek etki", medium: "Orta", low: "Düşük" };
const DIFF: Record<string, string> = { easy: "Kolay", medium: "Orta", hard: "Zor" };
const IMPACT: Record<string, string> = { high: "Yüksek", medium: "Orta", low: "Düşük" };
const bandColor = (s: number | null) => (s == null ? C.subtle : s >= 80 ? C.ok : s >= 60 ? C.ink : s >= 40 ? C.warn : C.bad);
const pct = (v: number | null) => (v == null ? "–" : `%${Math.round(v * 100)}`);

export function renderReportPdf(r: PublicReport): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 56, left: 50, right: 50 }, bufferPages: true,
    info: { Title: `${r.company.name} · Growth Audit Raporu`, Author: "Istanbul Marketing", Subject: "Growth Audit™" } });
  doc.registerFont("R", FONT("400Regular")); doc.registerFont("S", FONT("600SemiBold")); doc.registerFont("B", FONT("800ExtraBold"));
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });

  const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (h: number) => { if (doc.y + h > bottom()) doc.addPage(); };
  const h2 = (t: string) => { ensure(60); doc.moveDown(1.1); doc.font("S").fontSize(9).fillColor(C.subtle).text(t.toLocaleUpperCase("tr"), L, doc.y, { characterSpacing: 1 }); doc.moveDown(0.5); };
  const para = (t: string, o: { size?: number; color?: string; font?: string; indent?: number } = {}) =>
    doc.font(o.font || "R").fontSize(o.size || 10).fillColor(o.color || C.ink).text(t, L + (o.indent || 0), doc.y, { width: W - (o.indent || 0), lineGap: 2 });

  // Başlık
  if (existsSync(LOGO)) doc.image(LOGO, L, 44, { height: 16 });
  doc.font("R").fontSize(9).fillColor(C.muted).text(`Growth Audit™ Raporu · ${trDate(r.auditDate)}`, L, 47, { width: W, align: "right" });
  doc.moveTo(L, 72).lineTo(L + W, 72).lineWidth(0.6).strokeColor(C.line).stroke();
  doc.font("B").fontSize(22).fillColor(C.ink).text(r.company.name, L, 90, { width: W });
  const site = r.company.website ? r.company.website.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
  para([r.company.sector, r.company.location, site].filter(Boolean).join(" · "), { color: C.muted });

  // Skor kartı: yarım daire gösterge + özet değerler
  doc.moveDown(0.8);
  const top = doc.y, cx = L + 80, cy = top + 78, rad = 58;
  doc.roundedRect(L, top, W, 112, 10).lineWidth(0.6).strokeColor(C.line).stroke();
  doc.path(`M ${cx - rad} ${cy} A ${rad} ${rad} 0 0 1 ${cx + rad} ${cy}`).lineWidth(10).lineCap("round").strokeColor(C.line).stroke();
  if (r.score != null) {
    const a = Math.PI * (1 - Math.max(0, Math.min(100, r.score)) / 100);
    doc.path(`M ${cx - rad} ${cy} A ${rad} ${rad} 0 0 1 ${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy - rad * Math.sin(a)).toFixed(2)}`).lineWidth(10).lineCap("round").strokeColor(bandColor(r.score)).stroke();
  }
  doc.font("B").fontSize(26).fillColor(C.ink).text(r.score == null ? "–" : String(Math.round(r.score)), cx - 40, cy - 30, { width: 80, align: "center" });
  doc.font("R").fontSize(7.5).fillColor(C.muted).text("Growth Score™ / 100", cx - 50, cy + 2, { width: 100, align: "center" });
  const rows: [string, string][] = [["Veri kapsamı", pct(r.coverage)], ["Güven düzeyi", pct(r.confidence)], ["Denetim tarihi", trDate(r.auditDate)], ["Puanlama sürümü", r.scoringVersion]];
  rows.forEach(([k, v], i) => {
    const y = top + 16 + i * 22, x = L + 190;
    doc.font("R").fontSize(10).fillColor(C.muted).text(k, x, y, { width: 150 });
    doc.font("S").fontSize(10).fillColor(C.ink).text(v, x + 150, y, { width: W - 190 - 150 - 14, align: "right" });
  });
  doc.y = top + 122;
  para("Growth Score, sitenin dijital olgunluğunu altı kategoride 0–100 arasında ölçer. Ölçülemeyen metrikler sıfır sayılmaz; kapsam ayrıca gösterilir.", { size: 8.5, color: C.subtle });

  if (r.summary) { h2("Yönetici özeti"); para(r.summary.headline, { font: "S", size: 11.5 }); doc.moveDown(0.3); para(r.summary.narrative, { color: C.muted }); }

  h2("Kategori puanları");
  for (const c of r.categories) {
    ensure(34);
    const y = doc.y;
    doc.font("R").fontSize(10).fillColor(C.ink).text(`${c.name}`, L, y, { width: W - 60 });
    doc.font("S").fontSize(10).fillColor(C.ink).text(c.score == null ? "–" : String(Math.round(c.score)), L + W - 60, y, { width: 60, align: "right" });
    doc.roundedRect(L, y + 15, W, 6, 3).fill("#f0ede7");
    if (c.score != null) doc.roundedRect(L, y + 15, Math.max(4, (W * c.score) / 100), 6, 3).fill(bandColor(c.score));
    doc.font("R").fontSize(7.5).fillColor(C.subtle).text(`Ağırlık %${c.weight} · Kapsam ${pct(c.coverage)}`, L, y + 24, { width: W });
    doc.y = y + 36;
  }

  if (r.opportunities.length) {
    h2("Öncelikli büyüme fırsatları");
    for (const o of r.opportunities.slice(0, 8)) {
      ensure(80);
      const y0 = doc.y;
      doc.font("S").fontSize(8).fillColor(o.priority === "critical" ? C.bad : o.priority === "high" ? C.warn : C.muted).text(PRIORITY[o.priority] || o.priority, L + W - 90, y0 + 2, { width: 90, align: "right" });
      doc.font("S").fontSize(11).fillColor(C.ink).text(o.title, L, y0, { width: W - 100 });
      doc.moveDown(0.15);
      para(o.problem, { color: C.muted, size: 9.5 });
      para(`Önerilen adım: ${o.action}`, { size: 9.5 });
      para(`Etki: ${IMPACT[o.impact] || o.impact} · Zorluk: ${DIFF[o.difficulty] || o.difficulty} · ${o.basis === "observed" ? "Ölçülmüş bulgu" : "Değerlendirme"}${o.service ? ` · ${o.service}` : ""}`, { size: 8, color: C.subtle });
      doc.moveDown(0.6);
    }
  }

  if (r.roadmap.some((p) => p.items.length)) {
    h2("30 / 60 / 90 günlük yol haritası");
    for (const p of r.roadmap) {
      ensure(40);
      para(p.phase, { font: "S", size: 11 });
      if (!p.items.length) para("Bu dönem için ek iş öngörülmedi.", { size: 9, color: C.subtle });
      for (const i of p.items) { ensure(30); para(`• ${i.title}: ${i.action}`, { size: 9.5, color: C.muted, indent: 8 }); }
      doc.moveDown(0.5);
    }
  }

  if (r.services.length) {
    h2("Önerilen Istanbul Marketing hizmetleri");
    for (const s of r.services) { ensure(30); para(s.name, { font: "S", size: 10.5 }); para(s.reasons.join(" · "), { size: 9, color: C.muted }); doc.moveDown(0.4); }
  }

  if (r.findings.length) {
    h2("Kanıta dayalı bulgular");
    for (const f of r.findings) {
      ensure(60);
      para(`${f.name} — ${f.score}/100`, { font: "S", size: 10.5 });
      para(`${f.category} · ${f.state === "MEASURED" ? "Ölçüldü" : "Tahmini"}`, { size: 8, color: C.subtle });
      for (const o of f.observations) { ensure(20); para(`• ${o.source}: ${o.text}`, { size: 9, color: C.muted, indent: 8 }); }
      if (f.recommendation) para(`Öneri: ${f.recommendation}`, { size: 9 });
      doc.moveDown(0.5);
    }
  }

  if (r.strengths.length) { h2("Güçlü yönler"); for (const s of r.strengths) { ensure(20); para(`• ${s.name} (${s.score}): ${s.observation}`, { size: 9, color: C.muted }); } }

  h2("Kapsam ve sınırlamalar");
  for (const l of r.limitations) { ensure(20); para(`• ${l}`, { size: 8.5, color: C.muted }); }

  // Altbilgi ve sayfa numarası
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // altbilgi alt kenar boşluğuna yazılır; pdfkit'in yeni sayfa açmasını önler
    const y = doc.page.height - 36;
    doc.font("R").fontSize(7.5).fillColor(C.subtle);
    doc.text(`Istanbul Marketing Growth Audit™ · ${r.company.name}`, L, y, { width: W / 2, lineBreak: false });
    doc.text(`${i + 1} / ${range.count}`, L + W / 2, y, { width: W / 2, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}
