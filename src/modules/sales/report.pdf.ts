import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PublicReport } from "./report.model.js";
import { trDate } from "./report.html.js";
import { CONTACT, gradeOf } from "../audit/plain-language.js";

// Growth Audit™ PDF raporu. Türkçe karakterler için marka yazı tipi (Plus Jakarta Sans, OFL) gömülür.

const C = { ink: "#07111f", muted: "#5d6470", subtle: "#8a909a", line: "#e6e2da", soft: "#f5f3ef", accent: "#f04432", ok: "#1f8a4c", warn: "#b26a00", bad: "#c2341f" };
const FONT = (weight: string) => require.resolve(`@expo-google-fonts/plus-jakarta-sans/${weight}/PlusJakartaSans_${weight}.ttf`);
const LOGO = path.resolve(process.cwd(), "assets/brand/logo-wordmark-on-light.png");
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
  doc.font("R").fontSize(7.5).fillColor(C.muted).text("/ 100", cx - 50, cy + 2, { width: 100, align: "center" });
  const x0 = L + 190, tw = W - 190 - 16;
  doc.font("S").fontSize(13).fillColor(C.ink).text("Web sitenizin genel puanı", x0, top + 18, { width: tw });
  doc.font("B").fontSize(12).fillColor(bandColor(r.score) === C.ink ? C.ink : bandColor(r.score)).text(gradeOf(r.score), x0, top + 38, { width: tw });
  doc.font("R").fontSize(8.5).fillColor(C.muted).text("Sitenizi altı başlıkta inceledik. 80 ve üzeri iyi, 60–79 geliştirilebilir, 60'ın altı acil iyileştirme gerektirir.", x0, top + 58, { width: tw, lineGap: 1.5 });
  doc.y = top + 124;

  if (r.summary) { h2("Kısaca durum"); para(r.summary.headline, { font: "S", size: 11.5 }); doc.moveDown(0.3); para(r.summary.narrative, { color: C.muted }); }

  h2("Başlık başlık puanlar");
  for (const c of r.categories) {
    ensure(28);
    const y = doc.y;
    doc.font("R").fontSize(10).fillColor(C.ink).text(`${c.name}`, L, y, { width: W - 60 });
    doc.font("S").fontSize(10).fillColor(C.ink).text(c.score == null ? "–" : String(Math.round(c.score)), L + W - 60, y, { width: 60, align: "right" });
    doc.roundedRect(L, y + 15, W, 6, 3).fill("#f0ede7");
    if (c.score != null) doc.roundedRect(L, y + 15, Math.max(4, (W * c.score) / 100), 6, 3).fill(bandColor(c.score));
    doc.y = y + 30;
  }

  if (r.opportunities.length) {
    h2("Önce bunları düzeltin");
    r.opportunities.slice(0, 5).forEach((o, i) => {
      ensure(70);
      const y0 = doc.y;
      if (o.priority === "critical" || o.priority === "high") doc.font("S").fontSize(8).fillColor(o.priority === "critical" ? C.bad : C.warn).text(o.priority === "critical" ? "Acil" : "Önemli", L + W - 90, y0 + 2, { width: 90, align: "right" });
      doc.font("S").fontSize(11).fillColor(C.ink).text(`${i + 1}. ${o.title}`, L, y0, { width: W - 100 });
      doc.moveDown(0.15);
      para(o.why, { color: C.muted, size: 9.5 });
      para(`Ne yapmalı: ${o.action}`, { size: 9.5 });
      doc.moveDown(0.6);
    });
  }

  if (r.roadmap.some((p) => p.items.length)) {
    h2("Adım adım plan");
    for (const p of r.roadmap) {
      if (!p.items.length) continue;
      ensure(40);
      para(p.phase, { font: "S", size: 11 });
      for (const i of p.items) { ensure(20); para(`• ${i.title}`, { size: 9.5, color: C.muted, indent: 8 }); }
      doc.moveDown(0.5);
    }
  }

  if (r.strengths.length) { h2("İyi giden şeyler"); for (const s of r.strengths) { ensure(20); para(`• ${s.name}`, { size: 9.5, color: C.muted }); } }

  // İletişim çağrısı
  ensure(110); doc.moveDown(1.2);
  const cy0 = doc.y;
  doc.roundedRect(L, cy0, W, 96, 10).fill(C.ink);
  doc.font("B").fontSize(14).fillColor("#ffffff").text("Bu sorunları birlikte çözelim", L + 18, cy0 + 16, { width: W - 36 });
  doc.font("R").fontSize(9.5).fillColor("#c9cdd4").text("Raporu 15 dakikalık ücretsiz bir görüşmede sizinle birlikte gözden geçirelim.", L + 18, cy0 + 38, { width: W - 36 });
  doc.font("S").fontSize(10).fillColor("#ffffff").text(`WhatsApp / Telefon: ${CONTACT.phoneDisplay}   ·   ${CONTACT.email}   ·   istanbul.marketing`, L + 18, cy0 + 64, { width: W - 36, link: `https://wa.me/${CONTACT.whatsapp}` });
  doc.y = cy0 + 106;

  h2("Teknik detaylar");
  para(`Analiz tarihi: ${trDate(r.auditDate)} · Veri kapsamı: ${pct(r.coverage)} · Güven düzeyi: ${pct(r.confidence)} · Puanlama sürümü: ${r.scoringVersion}`, { size: 8, color: C.subtle });
  for (const l of r.limitations) { ensure(16); para(`• ${l}`, { size: 8, color: C.subtle }); }

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
