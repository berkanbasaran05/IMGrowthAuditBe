import type { AuditContext, CrawlResult, LeadInfo, MetricResult, ScoreResult, ScoredMetric } from "./audit.types.js";
import { runAnalyst } from "./ai-analyst.js";
import { crawlSite } from "./crawler.js";
import { evaluateDeterministic, METRIC_BY_ID, noWebsiteResults } from "./metrics.js";
import { buildOpportunities, Opportunity } from "./opportunities.js";
import { runPageSpeed } from "./pagespeed.js";
import { FetchBlockedError, normalizeWebsite } from "./safe-fetch.js";
import { computeGrowthScore } from "./scoring.js";

// Denetim boru hattı: doğrula → tara → ölç → (AI) değerlendir → puanla → fırsatları çıkar.
// Veritabanından bağımsızdır; sonuçları AuditService kaydeder.

export class RetryableAuditError extends Error {
  readonly retryable = true;
}

export interface EvidenceRow { kind: string; sourceUrl: string | null; title: string | null; data: Record<string, unknown> }

export interface AuditOutcome {
  status: "completed" | "no_verified_website";
  finalUrl: string | null;
  metrics: ScoredMetric[];
  score: ScoreResult;
  opportunities: Opportunity[];
  evidence: EvidenceRow[];
  summary: Record<string, unknown> | null;
  usage: Record<string, unknown>;
  aiModel: string | null;
  note?: string;
}

export const toScored = (results: MetricResult[]): ScoredMetric[] =>
  results.map((r) => { const d = METRIC_BY_ID.get(r.metricId)!; return { ...r, category: d.category, weight: d.weight, method: d.method }; });

function evidenceRows(crawl: CrawlResult, ctx: AuditContext): EvidenceRow[] {
  const rows: EvidenceRow[] = crawl.pages.map((p) => ({
    kind: "page", sourceUrl: p.url, title: p.title.slice(0, 200) || null,
    data: {
      role: p.role, status: p.status, metaDescription: p.metaDescription, canonical: p.canonical, metaRobots: p.metaRobots, lang: p.lang, viewport: p.viewport,
      h1: p.h1, h2: p.h2, wordCount: p.wordCount, ctas: p.ctas, forms: p.forms, telLinks: p.telLinks.length, mailLinks: p.mailLinks.length,
      whatsappLinks: p.whatsappLinks.length, jsonLdTypes: p.jsonLdTypes, og: p.og, trackers: p.trackers, socialLinks: p.socialLinks,
      images: { total: p.imagesTotal, withoutAlt: p.imagesWithoutAlt }, internalLinks: p.internalLinks.length, bytes: p.bytes, fetchMs: p.fetchMs,
      excerpt: p.text.slice(0, 600),
    },
  }));
  rows.push({ kind: "robots", sourceUrl: new URL("/robots.txt", crawl.finalUrl).toString(), title: "robots.txt", data: { ...crawl.robots, skippedByRobots: crawl.skippedByRobots } });
  rows.push({ kind: "sitemap", sourceUrl: crawl.sitemap.url, title: "XML site haritası", data: crawl.sitemap });
  if (crawl.failedPages.length) rows.push({ kind: "errors", sourceUrl: null, title: "Açılamayan sayfalar", data: { pages: crawl.failedPages } });
  for (const run of [ctx.pagespeed.mobile, ctx.pagespeed.desktop]) {
    if (!run) continue;
    const { screenshot, ...rest } = run;
    rows.push({ kind: "pagespeed", sourceUrl: crawl.finalUrl, title: `PageSpeed (${run.strategy === "mobile" ? "mobil" : "masaüstü"})`, data: rest as Record<string, unknown> });
    if (screenshot) rows.push({ kind: "screenshot", sourceUrl: crawl.finalUrl, title: `Ekran görüntüsü (${run.strategy === "mobile" ? "mobil" : "masaüstü"})`, data: { strategy: run.strategy, dataUri: screenshot } });
  }
  return rows;
}

function noWebsite(reason: string, evidence: EvidenceRow[] = []): AuditOutcome {
  const metrics = toScored(noWebsiteResults(reason));
  return { status: "no_verified_website", finalUrl: null, metrics, score: computeGrowthScore(metrics), opportunities: [], evidence, summary: null, usage: {}, aiModel: null, note: reason };
}

const isRetryableNetwork = (error: any) => error?.name === "TimeoutError" || /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed/i.test(String(error?.cause?.code || error?.message || ""));

export async function runAudit(lead: LeadInfo, progress: (stage: string, pct: number) => Promise<void>, signal?: AbortSignal): Promise<AuditOutcome> {
  const start = normalizeWebsite(lead.website);
  if (!start) return noWebsite("Firma kaydında doğrulanabilir bir web sitesi adresi yok.");

  await progress("Web sitesi doğrulanıyor", 5);
  let crawl: CrawlResult;
  try {
    crawl = await crawlSite(start, (stage) => progress(stage, 25), signal);
  } catch (error: any) {
    if (error instanceof FetchBlockedError) return noWebsite(`Adres taranamaz: ${error.message}`);
    if (/ENOTFOUND|ENODATA/i.test(String(error?.code || error?.cause?.code || error?.message))) return noWebsite(`Alan adı çözümlenemedi (${start.hostname}).`);
    if (isRetryableNetwork(error)) throw new RetryableAuditError(`Siteye ulaşılamadı: ${error?.name === "TimeoutError" ? "zaman aşımı" : error?.message}`);
    throw error;
  }
  if (crawl.robots.blocksAll) return noWebsite("Site robots.txt ile otomatik taramaya kapalı; denetim yapılmadı.", evidenceRows(crawl, { lead, crawl, pagespeed: { mobile: null, desktop: null } }));
  if (!crawl.pages.length) {
    const first = crawl.failedPages[0];
    if (first?.status && first.status >= 500) throw new RetryableAuditError(`Site hata döndürdü (HTTP ${first.status})`);
    return noWebsite(`Ana sayfa açılamadı${first ? ` (${first.error})` : ""}.`, evidenceRows(crawl, { lead, crawl, pagespeed: { mobile: null, desktop: null } }));
  }

  await progress("Performans ölçülüyor (Google Lighthouse)", 45);
  const [mobile, desktop] = await Promise.all([runPageSpeed(crawl.finalUrl, "mobile", signal), runPageSpeed(crawl.finalUrl, "desktop", signal)]);
  const ctx: AuditContext = { lead, crawl, pagespeed: { mobile, desktop } };

  await progress("Teknik ve SEO sinyalleri değerlendiriliyor", 65);
  const deterministic = evaluateDeterministic(ctx);

  await progress("AI analisti marka ve dönüşüm metriklerini değerlendiriyor", 75);
  const analyst = await runAnalyst(ctx, signal);

  await progress("Growth Score hesaplanıyor", 92);
  const metrics = toScored([...deterministic, ...analyst.results]);
  return {
    status: "completed", finalUrl: crawl.finalUrl, metrics, score: computeGrowthScore(metrics), opportunities: buildOpportunities(metrics),
    evidence: evidenceRows(crawl, ctx), summary: analyst.summary ? { ...analyst.summary, source: "ai" } : null,
    usage: { ai: analyst.usage, aiError: analyst.error ?? null, pagespeed: { mobile: mobile.ok, desktop: desktop.ok, keyed: !!process.env.PSI_KEY }, pages: crawl.pages.length },
    aiModel: analyst.usage?.model ?? null,
  };
}
