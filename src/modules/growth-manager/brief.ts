import { z } from "zod";
import { aiConfigured, AiUsage, findBannedClaim, structuredCall } from "../audit/ai-client.js";
import { fmtMoney, fmtNum, fmtPct, latestDate, MetricRow, num, pctChange, previousWindow, sumWindow, windowEnding } from "./analytics.js";
import type { Insight } from "./detectors.js";

// Günlük Eylem Brifi: "Bugün en önemli üç iş ne?" sorusuna kanıtlı, kısa cevap.
// Sayılar ölçülmüş veriden gelir; isteğe bağlı AI yalnızca özeti yazar ve verilmeyen sayı kullanamaz.

export interface Kpi { key: string; label: string; source: string; current: number; previous: number; change: number | null; unit: "money" | "count" | "ratio" }
export interface BriefContent {
  date: string; dataThrough: string | null; demo: boolean;
  health: { status: "good" | "attention" | "critical"; summary: string };
  kpis: Kpi[];
  changes: { text: string; direction: "up" | "down"; good: boolean }[];
  alerts: { insightId: string; title: string; reason: string }[];
  opportunities: { insightId: string; title: string; impact: string | null }[];
  actions: { insightId: string; title: string; reason: string; action: string }[];
  missingSources: string[];
}
export interface StoredInsight extends Insight { id: string; status: string }

const SOURCES: Record<string, string> = { google_ads: "Google Ads", ga4: "Google Analytics 4", search_console: "Search Console" };

export function computeKpis(rows: MetricRow[]): { kpis: Kpi[]; dataThrough: string | null } {
  const kpis: Kpi[] = []; let through: string | null = null;
  const add = (key: string, label: string, source: string, unit: Kpi["unit"], cur: number, prev: number) => kpis.push({ key, label, source, unit, current: cur, previous: prev, change: prev > 0 ? pctChange(cur, prev) : null });
  for (const source of ["google_ads", "ga4", "search_console"]) {
    const end = latestDate(rows, source); if (!end) continue;
    if (!through || end > through) through = end;
    const w = windowEnding(end, 7), p = previousWindow(w, 7);
    const a = sumWindow(rows, source, "account", w), b = sumWindow(rows, source, "account", p);
    if (source === "google_ads") {
      add("ads_cost", "Reklam harcaması", source, "money", num(a.cost), num(b.cost));
      add("ads_conversions", "Reklam dönüşümü", source, "count", num(a.conversions), num(b.conversions));
      if (num(a.conversions) > 0 && num(b.conversions) > 0) add("ads_cpa", "Dönüşüm başı maliyet", source, "money", num(a.cost) / num(a.conversions), num(b.cost) / num(b.conversions));
      if (num(a.conversionValue) > 0) add("ads_value", "Dönüşüm değeri (gelir)", source, "money", num(a.conversionValue), num(b.conversionValue));
    } else if (source === "ga4") {
      add("ga4_sessions", "Site oturumu", source, "count", num(a.sessions), num(b.sessions));
      add("ga4_key_events", "Talepler (hedef olay)", source, "count", num(a.keyEvents), num(b.keyEvents));
      if (num(a.sessions) > 0 && num(b.sessions) > 0) add("ga4_rate", "Site dönüşüm oranı", source, "ratio", num(a.keyEvents) / num(a.sessions), num(b.keyEvents) / num(b.sessions));
    } else {
      add("gsc_clicks", "Organik tıklama", source, "count", num(a.clicks), num(b.clicks));
      add("gsc_impressions", "Organik gösterim", source, "count", num(a.impressions), num(b.impressions));
    }
  }
  return { kpis, dataThrough: through };
}

// Kayda değer değişim: en az %15 ve asgari hacim (gürültü değil).
const MIN_VOLUME: Record<string, number> = { ads_cost: 500, ads_conversions: 5, ads_cpa: 0, ads_value: 1000, ga4_sessions: 200, ga4_key_events: 5, ga4_rate: 0, gsc_clicks: 50, gsc_impressions: 500 };
const HIGHER_IS_BETTER: Record<string, boolean> = { ads_cost: true, ads_conversions: true, ads_cpa: false, ads_value: true, ga4_sessions: true, ga4_key_events: true, ga4_rate: true, gsc_clicks: true, gsc_impressions: true };
export function formatKpi(k: Pick<Kpi, "unit">, v: number, currency: string) { return k.unit === "money" ? fmtMoney(v, currency) : k.unit === "ratio" ? fmtPct(v, 1) : fmtNum(v, v < 100 ? 1 : 0); }

function impactText(i: Insight, currency: string) {
  const e = i.estimatedImpact; if (!e) return null;
  const span = (a: string, b: string) => (a === b ? a : `${a}–${b}`);
  if (e.type === "money") return `${span(fmtMoney(e.low, currency), fmtMoney(e.high, currency))} (${e.period})`;
  const unit = e.type === "clicks" ? "tıklama" : e.type === "conversions" ? "dönüşüm" : "talep";
  return `+${span(fmtNum(e.low, 1), fmtNum(e.high, 1))} ${unit} (${e.period})`;
}

export function buildBrief(input: { date: string; rows: MetricRow[]; insights: StoredInsight[]; currency: string; demo: boolean; connectedSources: string[] }): BriefContent {
  const { kpis, dataThrough } = computeKpis(input.rows);
  const open = input.insights.filter((i) => i.status === "open" || i.status === "acknowledged");
  const changes = kpis.filter((k) => k.change != null && Math.abs(k.change) >= 0.15 && Math.max(k.current, k.previous) >= (MIN_VOLUME[k.key] ?? 0)).map((k) => {
    const up = k.current > k.previous, good = HIGHER_IS_BETTER[k.key] === up;
    return { text: `${k.label} ${formatKpi(k, k.previous, input.currency)} → ${formatKpi(k, k.current, input.currency)} (${up ? "+" : "−"}${fmtPct(Math.abs(k.change!))})`, direction: up ? "up" as const : "down" as const, good: k.key === "ads_cost" ? true : good };
  });
  const critical = open.filter((i) => i.severity === "critical");
  const warnings = open.filter((i) => i.severity === "warning");
  const status = critical.length ? "critical" : warnings.length ? "attention" : "good";
  const kpi = (key: string) => kpis.find((k) => k.key === key);
  const parts: string[] = [];
  const conv = kpi("ads_conversions") || kpi("ga4_key_events");
  if (conv) parts.push(`Son 7 günde ${conv.label.toLocaleLowerCase("tr")}: ${formatKpi(conv, conv.current, input.currency)}${conv.change != null ? ` (önceki haftaya göre ${conv.change >= 0 ? "+" : "−"}${fmtPct(Math.abs(conv.change))})` : ""}.`);
  const cost = kpi("ads_cost"); if (cost) parts.push(`Reklam harcaması ${formatKpi(cost, cost.current, input.currency)}.`);
  parts.push(critical.length ? `${critical.length} kritik konu acil ilgi istiyor.` : warnings.length ? `${warnings.length} konu takip gerektiriyor.` : "Kritik bir sorun görünmüyor.");
  if (!kpis.length) parts.splice(0, parts.length, "Henüz bağlı bir veri kaynağı yok; brif, Google Ads, GA4 veya Search Console bağlandığında oluşur.");

  const ranked = [...open].sort((a, b) => b.priority - a.priority);
  return {
    date: input.date, dataThrough, demo: input.demo,
    health: { status: kpis.length ? status : "attention", summary: parts.join(" ") },
    kpis, changes,
    alerts: critical.slice(0, 5).map((i) => ({ insightId: i.id, title: i.title, reason: i.explanation })),
    opportunities: open.filter((i) => i.kind === "growth_opportunity").sort((a, b) => b.priority - a.priority).slice(0, 3).map((i) => ({ insightId: i.id, title: i.title, impact: impactText(i, input.currency) })),
    actions: ranked.slice(0, 3).map((i) => ({ insightId: i.id, title: i.title, reason: `${i.evidence[0] ? `${i.evidence[0].label}: ${i.evidence[0].value}. ` : ""}Güven ${fmtPct(i.confidence)}.`, action: i.suggestedAction })),
    missingSources: Object.keys(SOURCES).filter((s) => !input.connectedSources.includes(s)).map((s) => SOURCES[s]),
  };
}

// ---- İsteğe bağlı AI yönetici özeti ----
const SummaryOut = z.object({ summary: z.string().min(20).max(700) });
const numbersIn = (t: string) => (t.match(/\d+(?:[.,]\d+)*/g) || []).map((x) => x.replace(/[.,]/g, ""));

// AI metnindeki her sayı, ona verilen olgularda geçmelidir; aksi halde metin reddedilir.
export function summaryGrounded(summary: string, facts: string): boolean {
  const allowed = new Set(numbersIn(facts));
  return numbersIn(summary).every((n) => allowed.has(n) || ["7", "3"].includes(n)) && !findBannedClaim(summary);
}

export async function aiHealthSummary(content: BriefContent, orgName: string): Promise<{ summary: string; usage: AiUsage | null } | null> {
  if (!aiConfigured() || !content.kpis.length) return null;
  const facts = JSON.stringify({ health: content.health, changes: content.changes.map((c) => c.text), alerts: content.alerts.map((a) => a.title), actions: content.actions.map((a) => a.title) });
  const r = await structuredCall({
    system: "Sen bir işletme sahibine günlük kısa yönetici özeti yazan büyüme danışmanısın. Türkçe, sakin ve net yaz. Yalnızca verilen olguları kullan; yeni sayı, tahmin veya garanti ekleme. En fazla 3 cümle.",
    user: `İşletme: ${orgName}\n<facts>\n${facts}\n</facts>\nBu olgulardan 2-3 cümlelik yönetici özeti yaz.`,
    schema: { type: "object", additionalProperties: false, required: ["summary"], properties: { summary: { type: "string" } } },
    validator: SummaryOut, effort: "low", maxTokens: 4_000,
  }).catch(() => null);
  if (!r?.ok || !r.data || !summaryGrounded(r.data.summary, facts)) return null;
  return { summary: r.data.summary, usage: r.usage };
}
