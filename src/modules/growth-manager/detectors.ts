import { addDays, expectedCtr, fmtMoney, fmtNum, fmtPct, latestDate, MetricRow, num, pctChange, previousWindow, significant, sumWindow, twoProportionZ, windowEnding } from "./analytics.js";

// Money Leak Detector ve Growth Opportunity Detector (kural tabanlı, açıklanabilir).
// İlkeler:
//  - Önemsiz dalgalanmalar için içgörü üretilmez: asgari hacim + göreli değişim + istatistiksel anlamlılık birlikte aranır.
//  - Atfedilmiş dönüşüm olmaması tek başına "boşa harcama" sayılmaz; izleme sorunu ile performans sorunu ayrılır.
//  - Parasal tahminler yalnızca gerekçelendirilebildiğinde, varsayımları ve güven düzeyiyle verilir.

export const DETECTOR_VERSION = "detect-1.0";

export interface Impact { type: "money" | "clicks" | "conversions" | "key_events"; low: number; high: number; currency?: string; period: string; basis: string }
export interface Insight {
  kind: "money_leak" | "growth_opportunity" | "alert";
  detector: string;
  category: "tracking" | "performance" | "budget" | "search" | "website" | "funnel";
  severity: "critical" | "warning" | "info";
  title: string;
  explanation: string;
  evidence: { label: string; value: string; source: string }[];
  assumptions: string[];
  confidence: number;
  estimatedImpact: Impact | null;
  suggestedAction: string;
  fingerprint: string;
  periodStart: string;
  periodEnd: string;
  priority: number;
}

export interface DetectorConfig { currency: string; minWeeklySpend: number; minSessions: number }
export const DEFAULT_CONFIG: DetectorConfig = { currency: "TRY", minWeeklySpend: 1000, minSessions: 300 };

export interface AuditOpportunity { id: string; title: string; action: string; priorityGroup: string; priorityScore: number; confidence: number; service: string | null }

const SEVERITY = { critical: 1, warning: 0.65, info: 0.35 };
export const priorityOf = (severity: Insight["severity"], confidence: number, hasImpact: boolean) => Math.round(100 * SEVERITY[severity] * Math.max(0, Math.min(1, confidence)) * (hasImpact ? 1 : 0.85));
const change = (v: number) => (v === Infinity ? "yeni" : `${v >= 0 ? "+" : "−"}${fmtPct(Math.abs(v))}`);

function make(i: Omit<Insight, "priority">): Insight { return { ...i, priority: priorityOf(i.severity, i.confidence, !!i.estimatedImpact) }; }

export function detectMoneyLeaks(rows: MetricRow[], cfg: DetectorConfig = DEFAULT_CONFIG): Insight[] {
  const out: Insight[] = [];
  const money = (v: number) => fmtMoney(v, cfg.currency);
  const adsEnd = latestDate(rows, "google_ads");
  const gaEnd = latestDate(rows, "ga4");

  if (adsEnd) {
    const cur = windowEnding(adsEnd, 7), prev = previousWindow(cur, 7);
    const a = sumWindow(rows, "google_ads", "account", cur), b = sumWindow(rows, "google_ads", "account", prev);
    const cost = num(a.cost), costP = num(b.cost), conv = num(a.conversions), convP = num(b.conversions), clicks = num(a.clicks), clicksP = num(b.clicks);
    const cpa = conv > 0 ? cost / conv : null, cpaP = convP > 0 ? costP / convP : null;
    const z = twoProportionZ(conv, clicks, convP, clicksP);
    const w28 = windowEnding(adsEnd, 28), a28 = sumWindow(rows, "google_ads", "account", w28);

    // 1) Dönüşüm takibi hiç yok veya bozuk
    if (num(a28.clicks) >= 200 && num(a28.conversions) === 0) {
      out.push(make({
        kind: "money_leak", detector: "ads_tracking_missing", category: "tracking", severity: "critical",
        title: "Google Ads hesabında son 28 günde hiç dönüşüm kaydı yok",
        explanation: `${fmtNum(num(a28.clicks))} tıklamaya rağmen hiç dönüşüm kaydedilmedi. Bu genellikle dönüşüm takibinin kurulmadığını veya bozulduğunu gösterir; kampanyaların sonuç üretmediği anlamına gelmeyebilir.`,
        evidence: [{ label: "28 gün tıklama", value: fmtNum(num(a28.clicks)), source: "Google Ads" }, { label: "28 gün harcama", value: money(num(a28.cost)), source: "Google Ads" }, { label: "28 gün dönüşüm", value: "0", source: "Google Ads" }],
        assumptions: ["Hesapta dönüşüm eylemi tanımlı olsa bile etiket sitede tetiklenmiyor olabilir."],
        confidence: 0.7, estimatedImpact: null,
        suggestedAction: "Google Ads dönüşüm eylemlerini ve sitedeki etiketi (GA4/Tag Manager) test edin; form gönderimi ve aramaları dönüşüm olarak tanımlayın.",
        fingerprint: "ads_tracking_missing:account", periodStart: w28.start, periodEnd: w28.end,
      }));
    } else if (cost >= cfg.minWeeklySpend && convP >= 5) {
      // İzleme mi performans mı? GA4 hedef olayları aynı dönemde sabitse, Ads tarafında izleme sorunu daha olası.
      let gaStable = false;
      if (gaEnd) {
        const g = sumWindow(rows, "ga4", "account", cur), gP = sumWindow(rows, "ga4", "account", prev);
        gaStable = num(gP.keyEvents) >= 5 && pctChange(num(g.keyEvents), num(gP.keyEvents)) > -0.15;
      }
      const convDrop = pctChange(conv, convP), costUp = pctChange(cost, costP);
      const trackingSuspect = (conv === 0 && convP >= 5) || (gaStable && convDrop <= -0.5);
      // 2) Harcama artarken dönüşüm düşüyor
      if (costUp >= 0.15 && convDrop <= -0.2 && (significant(z) || trackingSuspect)) {
        const extra = !trackingSuspect && cpaP ? Math.max(0, cost - conv * cpaP) : 0;
        out.push(make({
          kind: "money_leak", detector: "ads_spend_up_conversions_down", category: trackingSuspect ? "tracking" : "performance", severity: trackingSuspect || convDrop <= -0.5 ? "critical" : "warning",
          title: trackingSuspect ? "Reklam dönüşümleri aniden düştü — olası izleme sorunu" : "Harcama artarken dönüşümler düşüyor",
          explanation: trackingSuspect
            ? `Son 7 günde dönüşümler ${change(convDrop)} değişti${gaStable ? " ancak GA4'teki hedef olaylar sabit kaldı" : ""}. Bu tablo, kampanya performansından çok dönüşüm etiketinde bir sorun olduğunu düşündürüyor.`
            : `Son 7 günde harcama ${change(costUp)} artarken dönüşümler ${change(convDrop)} değişti. Tıklama başına dönüşüm oranındaki düşüş istatistiksel olarak anlamlı (z=${z.toFixed(1)}).`,
          evidence: [
            { label: "Harcama (7 gün)", value: `${money(cost)} (önceki ${money(costP)})`, source: "Google Ads" },
            { label: "Dönüşüm (7 gün)", value: `${fmtNum(conv, 1)} (önceki ${fmtNum(convP, 1)})`, source: "Google Ads" },
            { label: "Dönüşüm oranı", value: `${clicks ? fmtPct(conv / clicks, 1) : "–"} (önceki ${clicksP ? fmtPct(convP / clicksP, 1) : "–"})`, source: "Google Ads" },
            ...(gaEnd ? [{ label: "GA4 hedef olayları", value: gaStable ? "sabit" : "düştü", source: "GA4" }] : []),
          ],
          assumptions: trackingSuspect ? ["GA4 ile Google Ads aynı dönüşümleri ölçüyor varsayılmıştır."] : ["Tahmin, mevcut dönüşümlerin önceki haftanın dönüşüm başı maliyetiyle elde edilebileceğini varsayar.", "Dönüşüm gecikmesi (geç raporlanan dönüşümler) son günleri olduğundan düşük gösterebilir."],
          confidence: trackingSuspect ? 0.6 : 0.75,
          estimatedImpact: extra > 0 ? { type: "money", low: Math.round(extra * 0.6), high: Math.round(extra), currency: cfg.currency, period: "son 7 gün", basis: "Önceki haftanın dönüşüm başı maliyetine göre fazladan harcanan tutar" } : null,
          suggestedAction: trackingSuspect ? "Önce dönüşüm etiketini doğrulayın (Tag Assistant, Google Ads → Dönüşümler → durum). Sorun yoksa kampanya değişikliklerini gözden geçirin." : "Son hafta yapılan teklif/bütçe/reklam değişikliklerini inceleyin; dönüşüm getirmeyen arama terimlerini negatif anahtar kelime olarak ekleyin.",
          fingerprint: "ads_spend_up_conversions_down:account", periodStart: cur.start, periodEnd: cur.end,
        }));
      } else if (cpa && cpaP && convP >= 10 && conv >= 5 && pctChange(cpa, cpaP) >= 0.3 && significant(z)) {
        // 3) Dönüşüm başı maliyet bozuluyor
        const extra = Math.max(0, cost - conv * cpaP);
        out.push(make({
          kind: "money_leak", detector: "ads_cpa_increase", category: "performance", severity: "warning",
          title: "Dönüşüm başı maliyet belirgin şekilde arttı",
          explanation: `Dönüşüm başı maliyet ${money(cpaP)} → ${money(cpa)} (${change(pctChange(cpa, cpaP))}). Dönüşüm oranındaki düşüş istatistiksel olarak anlamlı (z=${z.toFixed(1)}).`,
          evidence: [{ label: "CPA (7 gün)", value: money(cpa), source: "Google Ads" }, { label: "CPA (önceki 7 gün)", value: money(cpaP), source: "Google Ads" }, { label: "Dönüşüm", value: `${fmtNum(conv, 1)} / ${fmtNum(convP, 1)}`, source: "Google Ads" }],
          assumptions: ["Tahmin, aynı dönüşüm sayısının önceki CPA ile elde edilebileceğini varsayar."],
          confidence: 0.7,
          estimatedImpact: extra > 0 ? { type: "money", low: Math.round(extra * 0.6), high: Math.round(extra), currency: cfg.currency, period: "son 7 gün", basis: "Önceki CPA'ya göre fazladan harcanan tutar" } : null,
          suggestedAction: "CPA'sı en çok artan kampanya ve anahtar kelimeleri belirleyin; teklif stratejisini ve hedef CPA'yı gözden geçirin.",
          fingerprint: "ads_cpa_increase:account", periodStart: cur.start, periodEnd: cur.end,
        }));
      }
    }

    // 4) Atfedilebilir sonucu olmayan kampanyalar (hesapta izleme çalışırken)
    const w14 = windowEnding(adsEnd, 14), acc14 = sumWindow(rows, "google_ads", "account", w14);
    if (num(acc14.conversions) >= 5) {
      const accCpa = num(acc14.cost) / num(acc14.conversions);
      const campaigns = [...new Set(rows.filter((r) => r.source === "google_ads" && r.dimensionType === "campaign" && r.date >= w14.start).map((r) => r.dimensionKey))];
      const zero = campaigns.map((key) => ({ key, label: rows.find((r) => r.dimensionKey === key && r.dimensionType === "campaign")?.dimensionLabel || key, s: sumWindow(rows, "google_ads", "campaign", w14, key) }))
        .filter((c) => num(c.s.conversions) === 0 && num(c.s.cost) >= Math.max(cfg.minWeeklySpend, 2 * accCpa))
        .sort((x, y) => num(y.s.cost) - num(x.s.cost)).slice(0, 3);
      for (const c of zero) out.push(make({
        kind: "money_leak", detector: "ads_campaign_no_conversions", category: "performance", severity: "warning",
        title: `"${c.label}" kampanyası 14 günde atfedilebilir dönüşüm üretmedi`,
        explanation: `Kampanya ${money(num(c.s.cost))} harcadı ve ${fmtNum(num(c.s.clicks))} tıklama aldı, ancak bu kampanyaya atfedilen dönüşüm yok. Hesabın geri kalanında dönüşüm kaydedildiği için izleme genel olarak çalışıyor görünüyor. Bu tek başına harcamanın boşa gittiğini kanıtlamaz (ör. marka bilinirliği, başka kanala atfedilen dönüşümler).`,
        evidence: [{ label: "Harcama (14 gün)", value: money(num(c.s.cost)), source: "Google Ads" }, { label: "Tıklama", value: fmtNum(num(c.s.clicks)), source: "Google Ads" }, { label: "Hesap CPA (14 gün)", value: money(accCpa), source: "Google Ads" }],
        assumptions: ["Kampanyanın hedefi dönüşüm (talep) üretmektir.", "Atıf modeli: Google Ads varsayılan atıf modeli."],
        confidence: 0.6,
        estimatedImpact: { type: "money", low: 0, high: Math.round(num(c.s.cost)), currency: cfg.currency, period: "son 14 gün", basis: "Atfedilebilir dönüşüm üretmeyen harcama (kayıp değil, risk altındaki tutar)" },
        suggestedAction: "Arama terimleri raporunu inceleyin, alakasız sorguları negatif ekleyin; sonuç değişmezse bütçeyi dönüşüm getiren kampanyalara kaydırmayı değerlendirin.",
        fingerprint: `ads_campaign_no_conversions:${c.key}`, periodStart: w14.start, periodEnd: w14.end,
      }));
    }
  }

  if (gaEnd) {
    const w28 = windowEnding(gaEnd, 28), g28 = sumWindow(rows, "ga4", "account", w28);
    if (num(g28.sessions) >= 500 && num(g28.keyEvents) === 0) {
      out.push(make({
        kind: "money_leak", detector: "ga4_key_events_missing", category: "tracking", severity: "warning",
        title: "GA4'te hedef olay (dönüşüm) ölçülmüyor",
        explanation: `Son 28 günde ${fmtNum(num(g28.sessions))} oturum var ama hiç hedef olay (key event) kaydedilmedi. Form, arama ve WhatsApp tıklamaları ölçülmediği için hangi kanalın talep getirdiği bilinemiyor.`,
        evidence: [{ label: "Oturum (28 gün)", value: fmtNum(num(g28.sessions)), source: "GA4" }, { label: "Hedef olay", value: "0", source: "GA4" }],
        assumptions: [], confidence: 0.75, estimatedImpact: null,
        suggestedAction: "GA4'te form gönderimi, telefon ve WhatsApp tıklamalarını hedef olay olarak işaretleyin.",
        fingerprint: "ga4_key_events_missing:account", periodStart: w28.start, periodEnd: w28.end,
      }));
    } else {
      const cur = windowEnding(gaEnd, 7), prev = previousWindow(cur, 7);
      const g = sumWindow(rows, "ga4", "account", cur), gP = sumWindow(rows, "ga4", "account", prev);
      const rate = num(g.sessions) ? num(g.keyEvents) / num(g.sessions) : 0, rateP = num(gP.sessions) ? num(gP.keyEvents) / num(gP.sessions) : 0;
      const z = twoProportionZ(num(g.keyEvents), num(g.sessions), num(gP.keyEvents), num(gP.sessions));
      if (num(g.sessions) >= cfg.minSessions && num(gP.keyEvents) >= 10 && rateP > 0 && pctChange(rate, rateP) <= -0.25 && significant(z)) {
        out.push(make({
          kind: "money_leak", detector: "ga4_conversion_rate_drop", category: "funnel", severity: "warning",
          title: "Sitenin dönüşüm oranı belirgin şekilde düştü",
          explanation: `Oturum başına hedef olay oranı ${fmtPct(rateP, 1)} → ${fmtPct(rate, 1)} (${change(pctChange(rate, rateP))}); değişim istatistiksel olarak anlamlı (z=${z.toFixed(1)}).`,
          evidence: [{ label: "Oturum", value: `${fmtNum(num(g.sessions))} (önceki ${fmtNum(num(gP.sessions))})`, source: "GA4" }, { label: "Hedef olay", value: `${fmtNum(num(g.keyEvents))} (önceki ${fmtNum(num(gP.keyEvents))})`, source: "GA4" }],
          assumptions: ["Trafik kaynağı karışımındaki değişim oranı etkileyebilir."], confidence: 0.7, estimatedImpact: null,
          suggestedAction: "Formların ve iletişim düğmelerinin çalıştığını kontrol edin; son değişen sayfaları ve trafik kaynaklarını inceleyin.",
          fingerprint: "ga4_conversion_rate_drop:account", periodStart: cur.start, periodEnd: cur.end,
        }));
      }
    }
  }
  return out;
}

export function detectGrowthOpportunities(rows: MetricRow[], cfg: DetectorConfig = DEFAULT_CONFIG, audit?: { id: string; opportunities: AuditOpportunity[]; finishedAt?: string } | null): Insight[] {
  const out: Insight[] = [];
  const money = (v: number) => fmtMoney(v, cfg.currency);

  // 1) Search Console: çok gösterim alan ama düşük tıklanan sorgular
  const gscEnd = latestDate(rows, "search_console", "query_28d");
  if (gscEnd) {
    const queries = rows.filter((r) => r.source === "search_console" && r.dimensionType === "query_28d" && r.date === gscEnd)
      .map((r) => ({ q: r.dimensionLabel || r.dimensionKey, impr: num(r.metrics.impressions), clicks: num(r.metrics.clicks), pos: num(r.metrics.position) }));
    const lowCtr = queries.filter((q) => q.impr >= 200 && q.pos > 0 && q.pos <= 10 && q.clicks / q.impr < 0.5 * expectedCtr(q.pos))
      .map((q) => ({ ...q, extra: Math.max(0, q.impr * (0.75 * expectedCtr(q.pos)) - q.clicks) })).sort((a, b) => b.extra - a.extra).slice(0, 5);
    if (lowCtr.length) {
      const total = lowCtr.reduce((s, q) => s + q.extra, 0);
      out.push(make({
        kind: "growth_opportunity", detector: "gsc_low_ctr_queries", category: "search", severity: "info",
        title: `${lowCtr.length} arama sorgusunda ilk sayfadasınız ama az tıklanıyorsunuz`,
        explanation: "Bu sorgularda sıralamanız iyi, ancak tıklama oranı aynı konumdaki tipik orandan belirgin şekilde düşük. Başlık ve açıklama metinlerini iyileştirmek daha fazla ziyaretçi getirebilir.",
        evidence: lowCtr.map((q) => ({ label: `"${q.q}"`, value: `${fmtNum(q.impr)} gösterim · ${fmtPct(q.clicks / q.impr, 1)} tıklama oranı · ort. konum ${fmtNum(q.pos, 1)}`, source: "Search Console (28 gün)" })),
        assumptions: ["Tahmin, tıklama oranının aynı konumdaki tipik oranın %75'ine çıkabileceğini varsayar; sektöre ve arama sonucu özelliklerine göre değişir."],
        confidence: 0.5,
        estimatedImpact: { type: "clicks", low: Math.round(total * 0.5), high: Math.round(total), period: "28 gün", basis: "Ek organik tıklama" },
        suggestedAction: "Bu sorgulara karşılık gelen sayfaların başlık (title) ve meta açıklamalarını sorguyu ve net faydayı içerecek şekilde yeniden yazın.",
        fingerprint: "gsc_low_ctr_queries:site", periodStart: addDays(gscEnd, -27), periodEnd: gscEnd,
      }));
    }
    const striking = queries.filter((q) => q.impr >= 300 && q.pos > 10 && q.pos <= 20).sort((a, b) => b.impr - a.impr).slice(0, 5);
    if (striking.length) out.push(make({
      kind: "growth_opportunity", detector: "gsc_striking_distance", category: "search", severity: "info",
      title: `${striking.length} sorguda ikinci sayfanın başındasınız`,
      explanation: "Bu sorgular çok aranıyor ve siteniz 11–20. sıralarda. İlk sayfaya çıkmak için içerik ve iç bağlantı desteği genellikle en hızlı organik büyüme alanıdır.",
      evidence: striking.map((q) => ({ label: `"${q.q}"`, value: `${fmtNum(q.impr)} gösterim · ort. konum ${fmtNum(q.pos, 1)}`, source: "Search Console (28 gün)" })),
      assumptions: [], confidence: 0.55, estimatedImpact: null,
      suggestedAction: "Her sorgu için ilgili sayfayı genişletin (SSS, örnekler, yerel bilgiler) ve sitenin güçlü sayfalarından iç bağlantı verin.",
      fingerprint: "gsc_striking_distance:site", periodStart: addDays(gscEnd, -27), periodEnd: gscEnd,
    }));
  }

  // 2) Google Ads: bütçe nedeniyle gösterim kaybeden, verimli kampanyalar
  const adsEnd = latestDate(rows, "google_ads");
  if (adsEnd) {
    const w14 = windowEnding(adsEnd, 14), acc = sumWindow(rows, "google_ads", "account", w14);
    const accCpa = num(acc.conversions) > 0 ? num(acc.cost) / num(acc.conversions) : null;
    const keys = [...new Set(rows.filter((r) => r.source === "google_ads" && r.dimensionType === "campaign" && r.date >= w14.start).map((r) => r.dimensionKey))];
    const limited = keys.map((key) => {
      const days = rows.filter((r) => r.source === "google_ads" && r.dimensionType === "campaign" && r.dimensionKey === key && r.date >= w14.start && r.date <= w14.end);
      const s = sumWindow(rows, "google_ads", "campaign", w14, key);
      const lost = days.length ? days.reduce((t, r) => t + num(r.metrics.budgetLostIs), 0) / days.length : 0;
      return { key, label: days[0]?.dimensionLabel || key, s, lost, cpa: num(s.conversions) ? num(s.cost) / num(s.conversions) : null };
    }).filter((c) => accCpa && c.lost >= 0.2 && num(c.s.conversions) >= 5 && c.cpa != null && c.cpa <= accCpa).sort((a, b) => b.lost - a.lost).slice(0, 2);
    for (const c of limited) {
      const extra = num(c.s.conversions) * (Math.min(c.lost, 0.5) / (1 - Math.min(c.lost, 0.5)));
      out.push(make({
        kind: "growth_opportunity", detector: "ads_budget_limited", category: "budget", severity: "info",
        title: `"${c.label}" kampanyası verimli ama bütçe yüzünden gösterim kaybediyor`,
        explanation: `Kampanya, gösterimlerin ortalama ${fmtPct(c.lost)}'ini bütçe yetersizliğinden kaybediyor ve dönüşüm başı maliyeti (${money(c.cpa!)}) hesap ortalamasının (${money(accCpa!)}) altında.`,
        evidence: [{ label: "Bütçe nedeniyle kaybedilen gösterim payı", value: fmtPct(c.lost), source: "Google Ads (14 gün)" }, { label: "Dönüşüm", value: fmtNum(num(c.s.conversions), 1), source: "Google Ads (14 gün)" }, { label: "CPA", value: money(c.cpa!), source: "Google Ads (14 gün)" }],
        assumptions: ["Ek bütçenin getirisi azalan verimle gelir; tahmin, kaybedilen gösterimlerin dönüşüm oranının mevcut oranın %25–50'si olacağını varsayar."],
        confidence: 0.45,
        estimatedImpact: { type: "conversions", low: Math.round(extra * 0.25 * 10) / 10, high: Math.round(extra * 0.5 * 10) / 10, period: "14 gün", basis: "Bütçe artışıyla tahmini ek dönüşüm" },
        suggestedAction: "Bu kampanyanın günlük bütçesini kademeli artırmayı (ör. %20) değerlendirin; bütçeyi dönüşüm getirmeyen kampanyalardan kaydırın. Değişiklik onayınız olmadan yapılmaz.",
        fingerprint: `ads_budget_limited:${c.key}`, periodStart: w14.start, periodEnd: w14.end,
      }));
    }
  }

  // 3) GA4: çok trafik alan ama düşük dönüşen açılış sayfaları
  const pageEnd = latestDate(rows, "ga4", "page_28d"), gaEnd = latestDate(rows, "ga4");
  if (pageEnd && gaEnd) {
    const site = sumWindow(rows, "ga4", "account", windowEnding(gaEnd, 28));
    const siteRate = num(site.sessions) ? num(site.keyEvents) / num(site.sessions) : 0;
    if (num(site.keyEvents) >= 20 && siteRate > 0) {
      const pages = rows.filter((r) => r.source === "ga4" && r.dimensionType === "page_28d" && r.date === pageEnd)
        .map((r) => ({ page: r.dimensionLabel || r.dimensionKey, s: num(r.metrics.sessions), k: num(r.metrics.keyEvents) }))
        .filter((p) => p.s >= 300 && p.k / p.s < 0.5 * siteRate && significant(twoProportionZ(p.k, p.s, num(site.keyEvents), num(site.sessions))))
        .map((p) => ({ ...p, extra: Math.max(0, p.s * 0.75 * siteRate - p.k) })).sort((a, b) => b.extra - a.extra).slice(0, 3);
      if (pages.length) {
        const total = pages.reduce((s, p) => s + p.extra, 0);
        out.push(make({
          kind: "growth_opportunity", detector: "ga4_low_converting_pages", category: "website", severity: "info",
          title: `${pages.length} açılış sayfası çok trafik alıyor ama az dönüşüyor`,
          explanation: `Bu sayfaların dönüşüm oranı site ortalamasının (${fmtPct(siteRate, 1)}) yarısından düşük. Sayfa içi çağrı, form ve güven unsurlarını iyileştirmek en hızlı etkiyi verebilir.`,
          evidence: pages.map((p) => ({ label: p.page, value: `${fmtNum(p.s)} oturum · ${fmtPct(p.k / p.s, 1)} dönüşüm`, source: "GA4 (28 gün)" })),
          assumptions: ["Tahmin, sayfaların site ortalamasının %75'ine ulaşabileceğini varsayar; sayfa amacı farklıysa (blog vb.) geçerli olmayabilir."],
          confidence: 0.5,
          estimatedImpact: { type: "key_events", low: Math.round(total * 0.5), high: Math.round(total), period: "28 gün", basis: "Ek hedef olay (talep)" },
          suggestedAction: "Sayfalara ilk ekranda net bir çağrı (ara / teklif al / WhatsApp), kısa form ve müşteri yorumları ekleyin; değişiklik sonrası 2 hafta ölçün.",
          fingerprint: "ga4_low_converting_pages:site", periodStart: addDays(pageEnd, -27), periodEnd: pageEnd,
        }));
      }
    }
  }

  // 4) Growth Audit bulguları
  const top = (audit?.opportunities || []).filter((o) => o.priorityGroup === "critical" || o.priorityGroup === "high").slice(0, 3);
  if (audit && top.length) {
    const end = (audit.finishedAt || new Date().toISOString()).slice(0, 10);
    out.push(make({
      kind: "growth_opportunity", detector: "growth_audit_priorities", category: "website", severity: "info",
      title: `Growth Audit: ${top.length} öncelikli web sitesi iyileştirmesi`,
      explanation: "Son Growth Audit'te kanıtla tespit edilen ve yüksek öncelikli iyileştirmeler.",
      evidence: top.map((o) => ({ label: o.title.replace(/ iyileştirilmeli$/, ""), value: o.action, source: "Growth Audit" })),
      assumptions: [], confidence: Math.round((top.reduce((s, o) => s + o.confidence, 0) / top.length) * 100) / 100, estimatedImpact: null,
      suggestedAction: top[0].action, fingerprint: `growth_audit_priorities:${audit.id}`, periodStart: end, periodEnd: end,
    }));
  }
  return out;
}

export function runDetectors(rows: MetricRow[], cfg: DetectorConfig = DEFAULT_CONFIG, audit?: Parameters<typeof detectGrowthOpportunities>[2]): Insight[] {
  return [...detectMoneyLeaks(rows, cfg), ...detectGrowthOpportunities(rows, cfg, audit)].sort((a, b) => b.priority - a.priority);
}
