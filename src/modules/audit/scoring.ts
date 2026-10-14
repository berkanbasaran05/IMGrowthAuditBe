import { CATEGORIES, CategoryScore, ScoreResult, ScoredMetric } from "./audit.types.js";

// Growth Score™ hesaplaması (saf fonksiyonlar; veritabanı ve ağ erişimi yok).
// Kurallar:
//  - Yalnızca MEASURED ve ESTIMATED metrikler puana girer.
//  - UNKNOWN ve FAILED sıfır sayılmaz; puan uygulanabilir ve değerlendirilmiş ağırlıklar üzerinden normalize edilir,
//    eksik kısım "kapsam" (coverage) olarak ayrıca raporlanır.
//  - NOT_APPLICABLE metrikler kapsam paydasına da girmez.

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
export const clampScore = (value: number) => Math.max(0, Math.min(100, value));

export function finalScoreOf(metric: Pick<ScoredMetric, "score" | "reviewerScore">): number | null {
  if (metric.reviewerScore != null) return clampScore(Number(metric.reviewerScore));
  return metric.score == null ? null : clampScore(Number(metric.score));
}

const counts = (metric: ScoredMetric) => (metric.state === "MEASURED" || metric.state === "ESTIMATED") && finalScoreOf(metric) != null;

export function scoreCategory(id: CategoryScore["id"], metrics: ScoredMetric[]): CategoryScore {
  const meta = CATEGORIES.find((c) => c.id === id)!;
  const own = metrics.filter((m) => m.category === id);
  const applicable = own.filter((m) => m.state !== "NOT_APPLICABLE");
  const evaluated = applicable.filter(counts);
  const applicableWeight = applicable.reduce((sum, m) => sum + m.weight, 0);
  const evaluatedWeight = evaluated.reduce((sum, m) => sum + m.weight, 0);
  const score = evaluatedWeight > 0 ? evaluated.reduce((sum, m) => sum + m.weight * finalScoreOf(m)!, 0) / evaluatedWeight : null;
  // İnsan incelemesinden geçen puan tam güvenle sayılır.
  const confidence = evaluatedWeight > 0
    ? evaluated.reduce((sum, m) => sum + m.weight * (m.reviewerScore != null ? 1 : m.confidence ?? 0.5), 0) / evaluatedWeight
    : null;
  return {
    id, name: meta.name, weight: meta.weight,
    score: score == null ? null : round(score),
    coverage: applicableWeight > 0 ? round(evaluatedWeight / applicableWeight, 3) : 0,
    confidence: confidence == null ? null : round(confidence, 3),
    evaluated: evaluated.length, applicable: applicable.length,
  };
}

export function computeGrowthScore(metrics: ScoredMetric[]): ScoreResult {
  const categories = CATEGORIES.map((c) => scoreCategory(c.id, metrics));
  const scored = categories.filter((c) => c.score != null);
  const applicable = categories.filter((c) => c.applicable > 0);
  const scoredWeight = scored.reduce((sum, c) => sum + c.weight, 0);
  const applicableWeight = applicable.reduce((sum, c) => sum + c.weight, 0);
  const overall = scoredWeight > 0 ? scored.reduce((sum, c) => sum + c.weight * c.score!, 0) / scoredWeight : null;
  const coverage = applicableWeight > 0 ? applicable.reduce((sum, c) => sum + c.weight * c.coverage, 0) / applicableWeight : 0;
  // Güven = değerlendirilen metriklerin güveni × kapsam; düşük kapsam, yüksek puanı güvenilir göstermemeli.
  const metricConfidence = scoredWeight > 0 ? scored.reduce((sum, c) => sum + c.weight * (c.confidence ?? 0.5), 0) / scoredWeight : null;
  return {
    overall: overall == null ? null : round(overall),
    coverage: round(coverage, 3),
    confidence: metricConfidence == null ? null : round(metricConfidence * coverage, 3),
    categories,
  };
}

export const scoreBand = (score: number | null) =>
  score == null ? "unknown" : score >= 80 ? "strong" : score >= 60 ? "fair" : score >= 40 ? "weak" : "critical";
