import { addDays, MetricRow } from "./analytics.js";

// Google OAuth 2.0 ve veri kaynakları (Google Ads, GA4, Search Console). Yalnızca okuma kapsamları istenir.
// Gerekli ortam değişkenleri: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI;
// Google Ads için ayrıca GOOGLE_ADS_DEVELOPER_TOKEN (ve MCC kullanılıyorsa GOOGLE_ADS_LOGIN_CUSTOMER_ID).

export type Provider = "google_ads" | "ga4" | "search_console";
export const PROVIDERS: Record<Provider, { name: string; scope: string }> = {
  google_ads: { name: "Google Ads", scope: "https://www.googleapis.com/auth/adwords" },
  ga4: { name: "Google Analytics 4", scope: "https://www.googleapis.com/auth/analytics.readonly" },
  search_console: { name: "Google Search Console", scope: "https://www.googleapis.com/auth/webmasters.readonly" },
};
export const isProvider = (p: string): p is Provider => Object.hasOwn(PROVIDERS, p);
const ADS_VERSION = () => process.env.GOOGLE_ADS_API_VERSION || "v22";

export function oauthConfigured(provider?: Provider) {
  const base = !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GOOGLE_OAUTH_REDIRECT_URI);
  return provider === "google_ads" ? base && !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN : base;
}

export function authorizationUrl(provider: Provider, state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI!, response_type: "code",
    scope: PROVIDERS[provider].scope, access_type: "offline", prompt: "consent", include_granted_scopes: "false", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body), signal: AbortSignal.timeout(20_000) });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google yetkilendirme hatası: ${json.error_description || json.error || res.status}`);
  return json as { access_token: string; refresh_token?: string; scope?: string; expires_in: number };
}
export const exchangeCode = (code: string) => tokenRequest({ code, client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!, redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI!, grant_type: "authorization_code" });
export const refreshAccess = (refreshToken: string) => tokenRequest({ refresh_token: refreshToken, client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!, grant_type: "refresh_token" }).then((t) => t.access_token);
export async function revokeToken(token: string) { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => {}); }

async function gjson(url: string, token: string, init: RequestInit = {}, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extraHeaders }, signal: AbortSignal.timeout(60_000) });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || json?.[0]?.error?.message || `HTTP ${res.status}`;
    throw Object.assign(new Error(`Google API: ${String(msg).slice(0, 240)}`), { status: res.status, retryable: res.status === 429 || res.status >= 500 });
  }
  return json;
}
const adsHeaders = () => ({ "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "", ...(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ? { "login-customer-id": process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, "") } : {}) });

// ---------- Hesap listeleri ----------
export async function listAccounts(provider: Provider, token: string): Promise<{ id: string; name: string }[]> {
  if (provider === "google_ads") {
    const j = await gjson(`https://googleads.googleapis.com/${ADS_VERSION()}/customers:listAccessibleCustomers`, token, {}, adsHeaders());
    return (j.resourceNames || []).map((r: string) => { const id = r.split("/")[1]; return { id, name: `Google Ads ${id.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3")}` }; });
  }
  if (provider === "ga4") {
    const j = await gjson("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200", token);
    return (j.accountSummaries || []).flatMap((a: any) => (a.propertySummaries || []).map((p: any) => ({ id: String(p.property).replace("properties/", ""), name: `${a.displayName} › ${p.displayName}` })));
  }
  const j = await gjson("https://www.googleapis.com/webmasters/v3/sites", token);
  return (j.siteEntry || []).filter((s: any) => s.permissionLevel !== "siteUnverifiedUser").map((s: any) => ({ id: s.siteUrl, name: s.siteUrl }));
}

// ---------- Yanıt ayrıştırıcıları (saf; testlerde örnek yanıtlarla sınanır) ----------
const n = (v: unknown) => Number(v) || 0;
const gaDate = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;

export function parseAdsCampaignRows(results: any[]): MetricRow[] {
  const rows: MetricRow[] = [], account = new Map<string, Record<string, number>>();
  for (const r of results) {
    const date = r.segments?.date; if (!date) continue;
    const m = { impressions: n(r.metrics?.impressions), clicks: n(r.metrics?.clicks), cost: n(r.metrics?.costMicros) / 1e6, conversions: n(r.metrics?.conversions), conversionValue: n(r.metrics?.conversionsValue) };
    rows.push({ source: "google_ads", date, dimensionType: "campaign", dimensionKey: String(r.campaign?.id), dimensionLabel: r.campaign?.name || null,
      metrics: { ...m, budgetLostIs: n(r.metrics?.searchBudgetLostImpressionShare), status: r.campaign?.status || "" } });
    const acc = account.get(date) || { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0 };
    for (const k of Object.keys(m) as (keyof typeof m)[]) acc[k] += m[k];
    account.set(date, acc);
  }
  for (const [date, m] of account) rows.push({ source: "google_ads", date, dimensionType: "account", dimensionKey: "account", metrics: m });
  return rows;
}

export function parseGa4Daily(json: any): MetricRow[] {
  return (json.rows || []).map((r: any) => ({ source: "ga4", date: gaDate(r.dimensionValues[0].value), dimensionType: "account", dimensionKey: "account",
    metrics: { sessions: n(r.metricValues[0]?.value), keyEvents: n(r.metricValues[1]?.value), engagedSessions: n(r.metricValues[2]?.value) } }));
}
export function parseGa4Pages(json: any, end: string): MetricRow[] {
  return (json.rows || []).map((r: any) => ({ source: "ga4", date: end, dimensionType: "page_28d", dimensionKey: String(r.dimensionValues[0].value).slice(0, 300), dimensionLabel: String(r.dimensionValues[0].value).slice(0, 300),
    metrics: { sessions: n(r.metricValues[0]?.value), keyEvents: n(r.metricValues[1]?.value) } }));
}
export function parseGscDaily(json: any): MetricRow[] {
  return (json.rows || []).map((r: any) => ({ source: "search_console", date: r.keys[0], dimensionType: "account", dimensionKey: "account", metrics: { clicks: n(r.clicks), impressions: n(r.impressions), position: n(r.position) } }));
}
export function parseGscQueries(json: any, end: string): MetricRow[] {
  return (json.rows || []).map((r: any) => ({ source: "search_console", date: end, dimensionType: "query_28d", dimensionKey: String(r.keys[0]).slice(0, 300), dimensionLabel: String(r.keys[0]).slice(0, 300),
    metrics: { clicks: n(r.clicks), impressions: n(r.impressions), position: n(r.position) } }));
}

// ---------- Veri çekme ----------
export async function fetchRows(provider: Provider, token: string, accountId: string, end: string, days = 56): Promise<MetricRow[]> {
  const start = addDays(end, -(days - 1)), start28 = addDays(end, -27);
  if (provider === "google_ads") {
    const cid = accountId.replace(/-/g, "");
    const query = `SELECT segments.date, campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.search_budget_lost_impression_share FROM campaign WHERE segments.date BETWEEN '${start}' AND '${end}'`;
    const results: any[] = []; let pageToken: string | undefined;
    do {
      const j = await gjson(`https://googleads.googleapis.com/${ADS_VERSION()}/customers/${cid}/googleAds:search`, token, { method: "POST", body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }) }, adsHeaders());
      results.push(...(j.results || [])); pageToken = j.nextPageToken;
    } while (pageToken && results.length < 50_000);
    return parseAdsCampaignRows(results);
  }
  if (provider === "ga4") {
    const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(accountId)}:runReport`;
    const daily = await gjson(url, token, { method: "POST", body: JSON.stringify({ dateRanges: [{ startDate: start, endDate: end }], dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }, { name: "keyEvents" }, { name: "engagedSessions" }], limit: 1000 }) });
    const pages = await gjson(url, token, { method: "POST", body: JSON.stringify({ dateRanges: [{ startDate: start28, endDate: end }], dimensions: [{ name: "landingPage" }], metrics: [{ name: "sessions" }, { name: "keyEvents" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 200 }) });
    return [...parseGa4Daily(daily), ...parseGa4Pages(pages, end)];
  }
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(accountId)}/searchAnalytics/query`;
  const daily = await gjson(url, token, { method: "POST", body: JSON.stringify({ startDate: start, endDate: end, dimensions: ["date"], rowLimit: 1000 }) });
  const queries = await gjson(url, token, { method: "POST", body: JSON.stringify({ startDate: start28, endDate: end, dimensions: ["query"], rowLimit: 1000 }) });
  return [...parseGscDaily(daily), ...parseGscQueries(queries, end)];
}
