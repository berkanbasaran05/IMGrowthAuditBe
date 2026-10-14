import type { CrawlResult, PageSnapshot } from "./audit.types.js";
import { extractPage, roleOf } from "./extract.js";
import { isAllowed, parseRobots, RobotsRules } from "./robots.js";
import { ROBOTS_AGENT, safeFetch } from "./safe-fetch.js";

// Nazik tarayıcı: robots.txt'ye uyar, istekler arasında bekler, en fazla MAX_PAGES sayfa okur.
// Giriş/oturum, CAPTCHA veya erişim kontrolü olan sayfalar atlanır; aşılmaya çalışılmaz.

const MAX_PAGES = Number(process.env.AUDIT_MAX_PAGES || 6);
const DEFAULT_DELAY_MS = 700;
const ROLE_PRIORITY = ["contact", "about", "services", "references", "blog"];
const SKIP = /\.(pdf|jpe?g|png|gif|webp|svg|zip|rar|docx?|xlsx?|pptx?|mp4|mp3)$|\/(wp-admin|wp-login|login|giris|sepet|cart|checkout|account|hesabim)\b/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadRobots(origin: string, signal?: AbortSignal) {
  try {
    const res = await safeFetch(`${origin}/robots.txt`, { timeoutMs: 8_000, maxBytes: 200_000, accept: "text/plain,*/*", signal });
    if (res.status >= 200 && res.status < 300 && !/<html/i.test(res.body.slice(0, 500))) {
      const rules = parseRobots(res.body, ROBOTS_AGENT);
      return { rules, found: true, status: res.status, text: res.body.slice(0, 4_000) };
    }
    // RFC 9309: 4xx → kısıt yok; 5xx → tamamen kısıtlı kabul edilir.
    if (res.status >= 500) return { rules: { rules: [{ allow: false, pattern: "/" }], sitemaps: [], crawlDelay: null } as RobotsRules, found: false, status: res.status, text: "" };
    return { rules: { rules: [], sitemaps: [], crawlDelay: null } as RobotsRules, found: false, status: res.status, text: "" };
  } catch {
    return { rules: { rules: [], sitemaps: [], crawlDelay: null } as RobotsRules, found: false, status: null, text: "" };
  }
}

async function loadSitemap(candidates: string[], signal?: AbortSignal) {
  for (const url of candidates.slice(0, 3)) {
    try {
      const res = await safeFetch(url, { timeoutMs: 8_000, maxBytes: 3_000_000, accept: "application/xml,text/xml,*/*", signal });
      if (res.status >= 200 && res.status < 300 && /<(urlset|sitemapindex)/i.test(res.body)) {
        return { found: true, url: res.url, urlCount: (res.body.match(/<loc>/gi) || []).length };
      }
    } catch { /* bir sonraki aday denenir */ }
  }
  return { found: false, url: null, urlCount: 0 };
}

export function pickPages(home: PageSnapshot, limit: number): string[] {
  const candidates = home.internalLinks.filter((u) => !SKIP.test(new URL(u).pathname) && u.replace(/\/$/, "") !== home.url.replace(/\/$/, ""));
  const byRole = new Map<string, string>();
  for (const url of candidates) {
    const role = roleOf(url);
    if (role !== "other" && !byRole.has(role)) byRole.set(role, url);
  }
  const chosen = ROLE_PRIORITY.map((r) => byRole.get(r)).filter(Boolean) as string[];
  for (const url of candidates) if (chosen.length < limit && !chosen.includes(url) && new URL(url).pathname.split("/").filter(Boolean).length <= 2) chosen.push(url);
  return chosen.slice(0, limit);
}

export async function crawlSite(start: URL, onProgress?: (stage: string) => Promise<void> | void, signal?: AbortSignal): Promise<CrawlResult> {
  const robots = await loadRobots(start.origin, signal);
  const delay = Math.min(10_000, Math.max(DEFAULT_DELAY_MS, (robots.rules.crawlDelay || 0) * 1000));
  const result: CrawlResult = {
    startUrl: start.toString(), finalUrl: start.toString(), https: start.protocol === "https:", pages: [], failedPages: [], skippedByRobots: [],
    robots: { found: robots.found, status: robots.status, blocksAll: !isAllowed(robots.rules, "/"), sitemaps: robots.rules.sitemaps, text: robots.text },
    sitemap: { found: false, url: null, urlCount: 0 },
  };
  if (result.robots.blocksAll) { result.skippedByRobots.push(start.toString()); return result; }

  const home = await safeFetch(start, { signal });
  result.finalUrl = home.url;
  result.https = new URL(home.url).protocol === "https:";
  if (home.status >= 400 || !/<html|<body|<!doctype/i.test(home.body.slice(0, 2_000))) {
    result.failedPages.push({ url: home.url, status: home.status, error: home.status >= 400 ? `HTTP ${home.status}` : "HTML içerik değil" });
    return result;
  }
  const homeSnap = extractPage(home.body, home.url, { status: home.status, bytes: home.bytes, fetchMs: home.ms, isHome: true });
  result.pages.push(homeSnap);

  const origin = new URL(home.url).origin;
  result.sitemap = await loadSitemap(robots.rules.sitemaps.length ? robots.rules.sitemaps : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`], signal);

  const queue = pickPages(homeSnap, MAX_PAGES - 1);
  for (const [index, url] of queue.entries()) {
    if (signal?.aborted) break;
    const path = new URL(url).pathname + new URL(url).search;
    if (!isAllowed(robots.rules, path)) { result.skippedByRobots.push(url); continue; }
    await onProgress?.(`Sayfa taranıyor (${index + 2}/${queue.length + 1})`);
    await sleep(delay);
    try {
      const res = await safeFetch(url, { signal });
      if (res.status >= 400) { result.failedPages.push({ url, status: res.status, error: `HTTP ${res.status}` }); continue; }
      if (!/text\/html|application\/xhtml/i.test(res.headers.get("content-type") || "text/html")) continue;
      result.pages.push(extractPage(res.body, res.url, { status: res.status, bytes: res.bytes, fetchMs: res.ms }));
    } catch (error: any) {
      result.failedPages.push({ url, status: null, error: error?.name === "TimeoutError" ? "Zaman aşımı" : String(error?.message || error).slice(0, 160) });
    }
  }
  return result;
}
