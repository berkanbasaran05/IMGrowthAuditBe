import { CATEGORIES } from "../audit/audit.types.js";
import { METRIC_BY_ID } from "../audit/metrics.js";

// Müşteriye gösterilebilir Growth Audit raporu (saf dönüşüm). İç satış bilgileri — lead score, notlar,
// aşama, arama kayıtları, yetkili bilgisi, inceleme gerekçeleri — bilerek dışarıda bırakılır.

export interface ReportLead { name: string; sector?: string; city?: string; district?: string; website?: string }

export interface PublicReport {
  company: { name: string; sector: string | null; location: string | null; website: string | null };
  auditDate: string;
  scoringVersion: string;
  score: number | null;
  coverage: number | null;
  confidence: number | null;
  categories: { id: string; name: string; weight: number; score: number | null; coverage: number }[];
  summary: { headline: string; narrative: string; strengths: string[]; weaknesses: string[] } | null;
  strengths: { name: string; score: number; observation: string }[];
  findings: { name: string; category: string; score: number; state: "MEASURED" | "ESTIMATED"; observations: { source: string; text: string }[]; recommendation: string | null }[];
  opportunities: { title: string; problem: string; action: string; service: string | null; priority: string; impact: string; difficulty: string; basis: string; confidence: number }[];
  services: { name: string; reasons: string[] }[];
  roadmap: { phase: string; items: { title: string; action: string }[] }[];
  limitations: string[];
}

const SOURCE_LABEL: Record<string, string> = { site: "Site geneli", "pagespeed:mobile": "Google Lighthouse (mobil)", "pagespeed:desktop": "Google Lighthouse (masaüstü)", "pagespeed:crux": "Chrome kullanıcı verisi", "robots.txt": "robots.txt" };
export const sourceLabel = (s: string) => SOURCE_LABEL[s] || (/^https?:/.test(s) ? s.replace(/^https?:\/\//, "").replace(/\/$/, "") : s);
const n = (v: unknown) => (v == null ? null : Number(v));

export function buildReport(audit: any, lead: ReportLead): PublicReport {
  const metrics: any[] = audit.metrics || [];
  const scored = metrics.filter((m) => (m.state === "MEASURED" || m.state === "ESTIMATED") && m.finalScore != null);
  const catName = (id: string) => CATEGORIES.find((c) => c.id === id)?.name || id;

  const findings = scored.filter((m) => m.finalScore < 70 && (m.evidence || []).length)
    .sort((a, b) => a.finalScore - b.finalScore)
    .map((m) => ({
      name: METRIC_BY_ID.get(m.metricId)?.name || m.metricId, category: catName(m.category), score: Math.round(m.finalScore), state: m.state,
      observations: (m.evidence || []).slice(0, 3).map((e: any) => ({ source: sourceLabel(String(e.source)), text: String(e.observation) })),
      recommendation: m.recommendation || null,
    }));
  const strengths = scored.filter((m) => m.finalScore >= 80 && (m.evidence || []).length)
    .sort((a, b) => b.finalScore - a.finalScore).slice(0, 6)
    .map((m) => ({ name: METRIC_BY_ID.get(m.metricId)?.name || m.metricId, score: Math.round(m.finalScore), observation: String(m.evidence[0].observation) }));

  const opps = (audit.opportunities || []).filter((o: any) => o.status !== "dismissed" && o.status !== "done");
  const opportunities = opps.map((o: any) => ({
    title: o.title, problem: o.problem, action: o.action, service: o.service, priority: o.priorityGroup, impact: o.impact,
    difficulty: o.difficulty, basis: o.basis, confidence: Number(o.confidence),
  }));

  const byService = new Map<string, { weight: number; reasons: string[] }>();
  for (const o of opps) {
    if (!o.service) continue;
    const cur = byService.get(o.service) || { weight: 0, reasons: [] };
    cur.weight += o.priorityScore; if (cur.reasons.length < 3) cur.reasons.push(o.title.replace(/ iyileştirilmeli$/, ""));
    byService.set(o.service, cur);
  }
  const services = [...byService.entries()].sort((a, b) => b[1].weight - a[1].weight).map(([name, v]) => ({ name, reasons: v.reasons }));

  // 30/60/90 gün: kolay işler önce, orta zorluk ikinci, zor işler üçüncü dönemde. Her dönemde öncelik sırası korunur.
  const phase = (d: string) => opps.filter((o: any) => o.difficulty === d).slice(0, 5).map((o: any) => ({ title: o.title.replace(/ iyileştirilmeli$/, ""), action: o.action }));
  const roadmap = [
    { phase: "İlk 30 gün", items: phase("easy") },
    { phase: "31–60 gün", items: phase("medium") },
    { phase: "61–90 gün", items: phase("hard") },
  ];

  const unknown = metrics.filter((m) => m.state === "UNKNOWN" || m.state === "FAILED").length;
  const limitations = [
    ...(unknown ? [`${unknown} metrik bu denetimde ölçülemedi; Growth Score yalnızca ölçülebilen metriklerden hesaplandı ve eksikler sıfır sayılmadı.`] : []),
    "Bulgular denetim tarihinde herkese açık web sitesinden toplanan verilere dayanır; giriş gerektiren sayfalar incelenmez.",
    "Bu rapor gelir, sıralama veya reklam sonucu garantisi vermez.",
  ];

  const s = audit.summary;
  return {
    company: {
      name: lead.name, sector: lead.sector || null, location: [lead.district, lead.city].filter(Boolean).join(", ") || null,
      website: audit.finalUrl || lead.website || null,
    },
    auditDate: new Date(audit.finishedAt || audit.createdAt).toISOString(),
    scoringVersion: audit.scoringVersion,
    score: n(audit.overallScore), coverage: n(audit.coverage), confidence: n(audit.confidence),
    categories: (audit.categoryScores || []).map((c: any) => ({ id: c.id, name: c.name, weight: c.weight, score: c.score, coverage: c.coverage })),
    summary: s && s.headline ? { headline: s.headline, narrative: s.narrative, strengths: s.strengths || [], weaknesses: s.weaknesses || [] } : null,
    strengths, findings, opportunities, services, roadmap, limitations,
  };
}
