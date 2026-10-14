import { gradeOf } from "../audit/plain-language.js";
import type { PublicReport } from "./report.model.js";

// Pazarlama sitesindeki rapor sayfası (istanbul.marketing/analiz/rapor/<token>) için müşteriye dönük JSON.
// Yalnızca PublicReport'tan türetilir; satış verisi (lead score, notlar, aşama) bu modele hiç girmez.

export const DEFAULT_BACKEND_BASE = "https://customer.istanbul.marketing";
const trim = (v: string) => v.replace(/\/$/, "");

// Müşteriye verilen rapor bağlantısı: PUBLIC_SITE_REPORT_BASE varsa site sayfası, yoksa eski /r/:token.
export function reportLink(token: string, backendBase: string) {
  const site = process.env.PUBLIC_SITE_REPORT_BASE?.trim();
  return site ? `${trim(site)}/${token}` : `${trim(backendBase)}/r/${token}`;
}
// PDF ve kart görseli her zaman backend'den sunulur (site bağlantısından bağımsız).
export const reportAssets = (token: string, backendBase: string) => ({
  pdfUrl: `${trim(backendBase)}/r/${token}/pdf`,
  cardUrl: `${trim(backendBase)}/r/${token}/card.png`,
});

export type Status = "good" | "improve" | "urgent";
export type Level = "high" | "medium" | "low";
export type Effort = "easy" | "medium" | "hard";

export interface CustomerReport {
  domain: string | null;
  companyName: string;
  auditDate: string;
  score: number | null;
  grade: string;
  gradeText: string;
  summary: string;
  categories: { key: string; name: string; description: string; score: number; status: Status }[];
  priorities: { title: string; why: string; impact: Level; effort: Effort; service: string | null }[];
  strengths: string[];
  roadmap: { d30: string[]; d60: string[]; d90: string[] };
  recommendedServices: { key: string; name: string; why: string }[];
  pdfUrl: string;
  cardUrl: string;
  limitations: string[];
}

const CATEGORY_DESC: Record<string, string> = {
  brand: "Ziyaretçinin ne yaptığınızı ve sizi neden seçmesi gerektiğini anlaması.",
  experience: "Sitenin telefonda ve bilgisayarda rahat kullanılması.",
  technology: "Sayfaların hızlı, güvenli ve hatasız açılması.",
  search: "Müşterilerin sizi Google aramalarında bulabilmesi.",
  conversion: "Ziyaretçinin arama, mesaj veya form ile size ulaşması.",
  trust: "Yeni ziyaretçinin size güvenmesini sağlayan bilgiler.",
};
const SERVICE_KEY: Record<string, string> = { "Web sitesi": "web", SEO: "seo", "Google Ads": "google-ads", "Sosyal medya": "social-media" };
const serviceKey = (name: string) => SERVICE_KEY[name] || name.toLocaleLowerCase("tr").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const statusOf = (score: number): Status => (score >= 80 ? "good" : score >= 60 ? "improve" : "urgent");
const GRADE_TEXT: Record<Status, string> = {
  good: "Siteniz genel olarak iyi durumda; küçük iyileştirmelerle daha fazla müşteri kazanabilirsiniz.",
  improve: "Temel sağlam, ancak bazı eksikler size gelebilecek müşteri sayısını düşürüyor.",
  urgent: "Önemli eksikler var; bunlar giderilmeden site size beklenen müşteriyi getirmez.",
};
const level = (v: string): Level => (v === "high" || v === "low" ? v : "medium");
const effort = (v: string): Effort => (v === "easy" || v === "hard" ? v : "medium");

export function sentences(text: string, max = 3) {
  const parts = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [];
  return parts.slice(0, max).map((s) => s.trim()).join(" ");
}

export function toCustomerReport(r: PublicReport, urls: { pdfUrl: string; cardUrl: string }): CustomerReport {
  const score = r.score == null ? null : Math.round(r.score);
  const categories = r.categories.filter((c) => c.score != null).map((c) => {
    const s = Math.round(Number(c.score));
    return { key: c.id, name: c.name, description: CATEGORY_DESC[c.id] || "", score: s, status: statusOf(s) };
  });
  const priorities = r.opportunities.slice(0, 5).map((o) => ({ title: o.title, why: o.why, impact: level(o.impact), effort: effort(o.difficulty), service: o.service }));
  const weakest = [...categories].sort((a, b) => a.score - b.score)[0];
  const fallback = score == null
    ? "Bu analizde genel puan hesaplanamadı. Yapılabilen kontrollerin sonuçlarını aşağıda bulabilirsiniz."
    : `Siteniz 100 üzerinden ${score} puan aldı.${weakest && weakest.status !== "good" ? ` En çok gelişme alanı: ${weakest.name.toLocaleLowerCase("tr")}.` : ""}${priorities.length ? " Aşağıda önce yapılması gereken işleri sıraladık." : ""}`;
  const raw = r.summary ? [r.summary.headline, r.summary.narrative].filter(Boolean).join(". ").replace(/\.\.+/g, ".") : "";
  let domain: string | null = null;
  try { domain = r.company.website ? new URL(/^https?:/.test(r.company.website) ? r.company.website : `https://${r.company.website}`).hostname.replace(/^www\./, "") : null; } catch { domain = null; }
  const titles = (i: number) => r.roadmap[i]?.items.map((x) => x.title) || [];
  return {
    domain, companyName: r.company.name, auditDate: r.auditDate, score,
    grade: gradeOf(score), gradeText: score == null ? "Puan hesaplanamadı; yine de bulunan eksikleri aşağıda görebilirsiniz." : GRADE_TEXT[statusOf(score)],
    summary: sentences(raw || fallback, 3),
    categories, priorities,
    strengths: r.strengths.slice(0, 5).map((s) => s.name),
    roadmap: { d30: titles(0), d60: titles(1), d90: titles(2) },
    recommendedServices: r.services.slice(0, 4).map((s) => ({ key: serviceKey(s.name), name: s.name, why: s.reasons.length ? `Şu konuları çözer: ${s.reasons.join("; ")}.` : "" })),
    pdfUrl: urls.pdfUrl, cardUrl: urls.cardUrl,
    limitations: r.limitations,
  };
}
