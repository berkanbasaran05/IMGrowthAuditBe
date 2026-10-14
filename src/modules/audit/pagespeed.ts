import type { PageSpeedRun } from "./audit.types.js";

// Google PageSpeed Insights (Lighthouse) ölçümü. PSI_KEY olmadan da çalışır ancak kota düşüktür.
// Ölçüm alınamazsa ilgili metrikler UNKNOWN kalır; değer tahmin edilmez.

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export async function runPageSpeed(url: string, strategy: "mobile" | "desktop", signal?: AbortSignal): Promise<PageSpeedRun> {
  const params = new URLSearchParams({ url, strategy });
  for (const c of ["performance", "accessibility", "best-practices", "seo"]) params.append("category", c);
  if (process.env.PSI_KEY) params.set("key", process.env.PSI_KEY);
  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, {
      signal: AbortSignal.any([AbortSignal.timeout(90_000), ...(signal ? [signal] : [])]),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || !json.lighthouseResult) return { strategy, ok: false, error: json?.error?.message?.slice(0, 200) || `PageSpeed HTTP ${res.status}` };
    const lh = json.lighthouseResult, audits = lh.audits || {};
    const categories: Record<string, number> = {};
    for (const [key, value] of Object.entries<any>(lh.categories || {})) if (typeof value?.score === "number") categories[key] = Math.round(value.score * 100);
    const fieldMetrics = json.loadingExperience?.metrics;
    const field = fieldMetrics ? {
      category: json.loadingExperience.overall_category,
      lcpMs: num(fieldMetrics.LARGEST_CONTENTFUL_PAINT_MS?.percentile),
      cls: num(fieldMetrics.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile) != null ? fieldMetrics.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : undefined,
      inpMs: num(fieldMetrics.INTERACTION_TO_NEXT_PAINT?.percentile),
    } : null;
    const opportunities = Object.values<any>(audits)
      .filter((a) => a?.details?.type === "opportunity" && (num(a.details.overallSavingsMs) || 0) >= 300)
      .sort((a, b) => (b.details.overallSavingsMs || 0) - (a.details.overallSavingsMs || 0))
      .slice(0, 6)
      .map((a) => ({ id: a.id, title: a.title, savingsMs: Math.round(a.details.overallSavingsMs), savingsBytes: num(a.details.overallSavingsBytes) }));
    return {
      strategy, ok: true, categories,
      lab: {
        lcpMs: num(audits["largest-contentful-paint"]?.numericValue), cls: num(audits["cumulative-layout-shift"]?.numericValue),
        tbtMs: num(audits["total-blocking-time"]?.numericValue), fcpMs: num(audits["first-contentful-paint"]?.numericValue),
        speedIndexMs: num(audits["speed-index"]?.numericValue),
      },
      field, totalBytes: num(audits["total-byte-weight"]?.numericValue), opportunities,
      screenshot: typeof audits["final-screenshot"]?.details?.data === "string" ? audits["final-screenshot"].details.data : undefined,
    };
  } catch (error: any) {
    return { strategy, ok: false, error: error?.name === "TimeoutError" ? "PageSpeed zaman aşımı" : String(error?.message || error).slice(0, 200) };
  }
}
