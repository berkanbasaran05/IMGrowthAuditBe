// Ortak analiz yardımcıları (saf fonksiyonlar). Tarihler "YYYY-MM-DD" metni olarak işlenir.

export interface MetricRow {
  source: "google_ads" | "ga4" | "search_console" | string;
  date: string;
  dimensionType: string; // account | campaign | query_28d | page_28d
  dimensionKey: string;
  dimensionLabel?: string | null;
  metrics: Record<string, number | string | null | undefined>;
}

export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
};
export const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

export interface Window { start: string; end: string }
export const windowEnding = (end: string, days: number): Window => ({ start: addDays(end, -(days - 1)), end });
export const previousWindow = (w: Window, days: number): Window => ({ start: addDays(w.start, -days), end: addDays(w.start, -1) });

export function latestDate(rows: MetricRow[], source: string, dimensionType = "account"): string | null {
  let max: string | null = null;
  for (const r of rows) if (r.source === source && r.dimensionType === dimensionType && (!max || r.date > max)) max = r.date;
  return max;
}

export function sumWindow(rows: MetricRow[], source: string, dimensionType: string, w: Window, key?: string): Record<string, number> {
  const out: Record<string, number> = {}; let days = 0;
  for (const r of rows) {
    if (r.source !== source || r.dimensionType !== dimensionType || r.date < w.start || r.date > w.end) continue;
    if (key !== undefined && r.dimensionKey !== key) continue;
    days++;
    for (const [k, v] of Object.entries(r.metrics)) if (typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v)))) out[k] = (out[k] || 0) + num(v);
  }
  return { ...out, _days: days };
}

export const pctChange = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev : cur > 0 ? Infinity : 0);

// İki oran z-testi: oranlardaki değişimin rastlantısal dalgalanma olup olmadığını sınar (|z| ≥ 1.96 ≈ p < 0.05).
export function twoProportionZ(successA: number, trialsA: number, successB: number, trialsB: number): number {
  if (trialsA <= 0 || trialsB <= 0) return 0;
  const pA = successA / trialsA, pB = successB / trialsB, pooled = (successA + successB) / (trialsA + trialsB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / trialsA + 1 / trialsB));
  return se > 0 ? (pA - pB) / se : 0;
}
export const significant = (z: number) => Math.abs(z) >= 1.96;

// Organik arama sonuçlarında konuma göre beklenen tipik tıklama oranı (genel referans eğrisi; sektöre göre değişir).
const CTR_CURVE = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
export const expectedCtr = (position: number) => CTR_CURVE[Math.max(0, Math.min(9, Math.round(position) - 1))];

export const fmtMoney = (v: number, currency = "TRY") => new Intl.NumberFormat("tr-TR", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
export const fmtNum = (v: number, digits = 0) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(v);
export const fmtPct = (v: number, digits = 0) => `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(v * 100)}`;
