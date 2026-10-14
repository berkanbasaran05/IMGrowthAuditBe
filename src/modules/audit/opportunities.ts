import type { Evidence, ScoredMetric } from "./audit.types.js";
import { finalScoreOf } from "./scoring.js";
import { METRIC_BY_ID } from "./metrics.js";

// Büyüme fırsatları: düşük puanlı ve kanıtlı metriklerden üretilir.
// Öncelik = Etki × Güven × Kolaylık (0-100'e normalize). Formül şeffaftır ve bileşenleri saklanır.
// Finansal etki (kayıp gelir, ROI) hesaplanmaz; etki nitel olarak verilir.

export interface Opportunity {
  metricIds: string[];
  title: string;
  problem: string;
  evidence: Evidence[];
  impact: "high" | "medium" | "low";
  basis: "observed" | "hypothesis";
  confidence: number;
  difficulty: "easy" | "medium" | "hard";
  action: string;
  service: string | null;
  priorityScore: number;
  priorityGroup: "critical" | "high" | "medium" | "low";
}

const IMPACT = { high: 5, medium: 3, low: 1.5 };
const EASE = { easy: 5, medium: 3, hard: 1.5 };
export const OPPORTUNITY_THRESHOLD = 70;
// Sorun cümlesinde eksikliği anlatan gözlemler, olumlu gözlemlerden önce gelir.
const NEGATIVE = /(yok|bulunamadı|eksik|açılmadı|hata|kapalı|tekrar ediyor|engellen|düşük)/i;

export function priorityOf(impact: Opportunity["impact"], confidence: number, difficulty: Opportunity["difficulty"], score: number) {
  // Açık (100 - puan) etkiyi büyütür; çok düşük puanlı metrik aynı etki sınıfında öne çıkar.
  const gap = Math.max(0.3, (100 - score) / 100);
  const raw = (IMPACT[impact] / 5) * gap * Math.max(0, Math.min(1, confidence)) * (EASE[difficulty] / 5);
  return Math.round(raw * 100);
}

export const groupOf = (priority: number): Opportunity["priorityGroup"] => (priority >= 45 ? "critical" : priority >= 25 ? "high" : priority >= 10 ? "medium" : "low");

export function buildOpportunities(metrics: ScoredMetric[]): Opportunity[] {
  const out: Opportunity[] = [];
  for (const m of metrics) {
    const score = finalScoreOf(m);
    if (score == null || score >= OPPORTUNITY_THRESHOLD || (m.state !== "MEASURED" && m.state !== "ESTIMATED")) continue;
    const def = METRIC_BY_ID.get(m.metricId);
    if (!def || !m.recommendation || !m.evidence.length) continue; // kanıtsız fırsat üretilmez
    const confidence = m.reviewerScore != null ? 1 : m.confidence ?? 0.5;
    const priorityScore = priorityOf(def.impact, confidence, def.difficulty, score);
    out.push({
      // Kural tabanlı metrikte "reason" yöntem notudur; sorun gözlenen kanıtla anlatılır. AI metriğinde gerekçe sorunun kendisidir.
      metricIds: [m.metricId], title: `${def.name} iyileştirilmeli`,
      problem: def.method === "ai" ? m.reason : [...m.evidence].sort((a, b) => Number(NEGATIVE.test(b.observation)) - Number(NEGATIVE.test(a.observation))).slice(0, 2).map((e) => e.observation).join(" · "),
      evidence: m.evidence.slice(0, 4),
      impact: def.impact, basis: m.state === "MEASURED" && def.method !== "ai" ? "observed" : "hypothesis", confidence,
      difficulty: def.difficulty, action: m.recommendation, service: def.service, priorityScore, priorityGroup: groupOf(priorityScore),
    });
  }
  return out.sort((a, b) => b.priorityScore - a.priorityScore);
}
