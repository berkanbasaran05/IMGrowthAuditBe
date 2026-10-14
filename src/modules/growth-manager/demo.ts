import { addDays, MetricRow } from "./analytics.js";

// Açıkça "DEMO" olarak işaretlenen örnek veri. Gerçek müşteri verisi değildir; yalnızca portalı ve
// dedektörleri bağlantı kurmadan göstermek/sınamak için kullanılır. Üretim deterministiktir (sabit tohum).

function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

export function demoRows(end: string, days = 56): MetricRow[] {
  const rand = rng(42), jitter = (v: number, p = 0.08) => v * (1 + (rand() * 2 - 1) * p);
  const rows: MetricRow[] = [];
  const campaigns = [
    { id: "101", name: "Marka - Arama", clicks: 70, cr: 0.09, cpc: 6, lost: 0.34, value: 1500 },
    { id: "102", name: "Genel Hizmet - Arama", clicks: 95, cr: 0.05, cpc: 14, lost: 0.05, value: 1500 },
    { id: "103", name: "Görüntülü Yeniden Pazarlama", clicks: 40, cr: 0, cpc: 3.6, lost: 0, value: 0 },
  ];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(end, -i), lastWeek = i < 7;
    const acc = { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0 };
    for (const c of campaigns) {
      // Son hafta: genel hizmet kampanyasında harcama artışı ve dönüşüm oranı düşüşü (CPA bozulması senaryosu)
      const boost = lastWeek && c.id === "102" ? 1.45 : 1, crDrop = lastWeek && c.id === "102" ? 0.4 : 1;
      const clicks = Math.round(jitter(c.clicks * boost)), cost = Math.round(clicks * jitter(c.cpc) * 100) / 100;
      const conversions = Math.round(clicks * c.cr * crDrop * jitter(1, 0.25) * 10) / 10;
      const m = { impressions: Math.round(clicks * jitter(14)), clicks, cost, conversions, conversionValue: Math.round(conversions * c.value) };
      rows.push({ source: "google_ads", date, dimensionType: "campaign", dimensionKey: c.id, dimensionLabel: c.name, metrics: { ...m, budgetLostIs: c.lost ? Math.round(jitter(c.lost, 0.15) * 100) / 100 : 0, status: "ENABLED" } });
      for (const k of Object.keys(acc) as (keyof typeof acc)[]) acc[k] += m[k];
    }
    rows.push({ source: "google_ads", date, dimensionType: "account", dimensionKey: "account", metrics: acc });
    const sessions = Math.round(jitter(620)), keyEvents = Math.round(sessions * jitter(0.026, 0.2));
    rows.push({ source: "ga4", date, dimensionType: "account", dimensionKey: "account", metrics: { sessions, keyEvents, engagedSessions: Math.round(sessions * 0.58) } });
    const impressions = Math.round(jitter(5200)), clicks = Math.round(impressions * jitter(0.021));
    rows.push({ source: "search_console", date: addDays(date, -2), dimensionType: "account", dimensionKey: "account", metrics: { clicks, impressions, position: Math.round(jitter(9.4, 0.05) * 10) / 10 } });
  }
  const pages: [string, number, number][] = [["/", 6200, 0.031], ["/hizmetler/implant", 2400, 0.006], ["/iletisim", 950, 0.11], ["/hizmetler/dis-beyazlatma", 1300, 0.004], ["/hakkimizda", 600, 0.012]];
  for (const [p, s, r] of pages) rows.push({ source: "ga4", date: end, dimensionType: "page_28d", dimensionKey: p, dimensionLabel: p, metrics: { sessions: s, keyEvents: Math.round(s * r) } });
  const queries: [string, number, number, number][] = [["kadıköy diş kliniği", 4200, 61, 3.1], ["implant fiyatları", 2600, 31, 5.4], ["diş beyazlatma kadıköy", 1850, 22, 12.3], ["acil diş hekimi", 920, 9, 14.8], ["zirkonyum kaplama", 700, 30, 8.2], ["diş kliniği yorumları", 380, 4, 16.5]];
  for (const [q, impressions, clicks, position] of queries) rows.push({ source: "search_console", date: addDays(end, -2), dimensionType: "query_28d", dimensionKey: q, dimensionLabel: q, metrics: { impressions, clicks, position } });
  return rows;
}
