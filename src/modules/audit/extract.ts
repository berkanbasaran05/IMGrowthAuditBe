import * as cheerio from "cheerio";
import type { PageSnapshot } from "./audit.types.js";

// HTML'den denetim sinyallerini çıkarır. Çıktı yalnızca gözlenen gerçeklerdir; yorum içermez.

const TRACKERS: [string, RegExp][] = [
  ["Google Analytics 4", /gtag\(['"]config['"],\s*['"]G-|googletagmanager\.com\/gtag\/js\?id=G-/i],
  ["Google Tag Manager", /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/i],
  ["Google Ads etiketi", /gtag\(['"]config['"],\s*['"]AW-|googletagmanager\.com\/gtag\/js\?id=AW-/i],
  ["Universal Analytics (eski)", /google-analytics\.com\/analytics\.js|UA-\d{4,}-\d+/i],
  ["Meta Pixel", /connect\.facebook\.net\/[^"']*\/fbevents\.js|fbq\(['"]init/i],
  ["TikTok Pixel", /analytics\.tiktok\.com/i],
  ["Microsoft Clarity", /clarity\.ms\/tag/i],
  ["Hotjar", /static\.hotjar\.com/i],
  ["Yandex Metrica", /mc\.yandex\.ru\/metrika/i],
  ["LinkedIn Insight", /snap\.licdn\.com/i],
];
const SOCIAL = /(?:instagram|facebook|linkedin|youtube|tiktok|twitter|x)\.com\//i;
// Kelime sınırı Türkçe harfleri de kapsar (\p{L}); "Facebook" içindeki "book" CTA sayılmaz.
const CTA_WORDS = /(?<!\p{L})(ara|arayın|hemen ara|teklif\p{L}*|randevu\p{L}*|iletişim\p{L}*|bize ulaşın?|başvur\p{L}*|satın al|sipariş\p{L}*|rezervasyon\p{L}*|ücretsiz|demo|keşfet|whatsapp|get started|contact|book|quote|buy|order|call)(?!\p{L})/iu;
const ROLE_PATTERNS: [string, RegExp][] = [
  ["contact", /(iletisim|iletişim|contact|bize-ulasin|ulasim)/i],
  ["about", /(hakkimizda|hakkımızda|about|kurumsal|biz-kimiz)/i],
  ["services", /(hizmet|services|cozum|çözüm|urun|ürün|products|tedavi)/i],
  ["references", /(referans|portfolyo|portfolio|projeler|projects|musterilerimiz|case|basari|başarı)/i],
  ["blog", /(blog|haber|news|makale|articles)/i],
];
export const roleOf = (url: string, isHome = false) => (isHome ? "home" : ROLE_PATTERNS.find(([, re]) => re.test(decodeURIComponent(new URL(url).pathname)))?.[0] || "other");

const clean = (value: string | undefined, max = 300) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const uniq = <T>(items: T[]) => [...new Set(items)];

export function extractPage(html: string, pageUrl: string, meta: { status: number; bytes: number; fetchMs: number; isHome?: boolean }): PageSnapshot {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const host = base.hostname.replace(/^www\./, "");
  const images = $("img");
  const imagesWithoutAlt = images.filter((_, el) => !String($(el).attr("alt") ?? "").trim() && $(el).attr("role") !== "presentation").length;
  const scripts = $("script").map((_, el) => `${$(el).attr("src") || ""} ${$(el).html() || ""}`).get().join("\n");

  const links = $("a[href]").map((_, el) => String($(el).attr("href") || "").trim()).get();
  const absolute = (href: string) => { try { return new URL(href, base); } catch { return null; } };
  const internal: string[] = [], external: string[] = [];
  for (const href of links) {
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    const u = absolute(href);
    if (!u || !/^https?:$/.test(u.protocol)) continue;
    u.hash = "";
    (u.hostname.replace(/^www\./, "") === host ? internal : external).push(u.toString());
  }

  const forms = $("form").map((_, form) => {
    const fields = $(form).find("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea");
    const labelled = fields.filter((__, f) => {
      const id = $(f).attr("id");
      return !!($(f).attr("aria-label") || $(f).attr("placeholder") || (id && $(form).find(`label[for="${id}"]`).length) || $(f).closest("label").length);
    }).length;
    return { fields: fields.length, required: fields.filter("[required]").length, labelled, hasSubmit: $(form).find("button, input[type=submit]").length > 0 };
  }).get();

  const og: Record<string, string> = {};
  $("meta[property^='og:']").each((_, el) => { og[String($(el).attr("property"))] = clean($(el).attr("content"), 200); });

  const jsonLdTypes: string[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      const walk = (node: any) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(walk);
        if (node["@type"]) jsonLdTypes.push(...([] as string[]).concat(node["@type"]));
        if (node["@graph"]) walk(node["@graph"]);
      };
      walk(JSON.parse($(el).html() || ""));
    } catch { jsonLdTypes.push("(geçersiz JSON-LD)"); }
  });

  const ctas = uniq($("a, button").map((_, el) => clean($(el).text(), 60)).get().filter((t) => t && t.length <= 40 && CTA_WORDS.test(t.toLocaleLowerCase("tr")))).slice(0, 12);

  $("script, style, noscript, svg, template").remove();
  const text = clean($("body").text(), 20_000);
  const lower = text.toLocaleLowerCase("tr");
  const hints = (re: RegExp) => uniq((lower.match(re) || []).map((s) => s.trim())).slice(0, 6);

  return {
    url: pageUrl, status: meta.status, role: roleOf(pageUrl, meta.isHome),
    title: clean($("title").first().text(), 200),
    metaDescription: clean($("meta[name='description']").attr("content"), 400),
    canonical: clean($("link[rel='canonical']").attr("href"), 300),
    metaRobots: clean($("meta[name='robots']").attr("content"), 100).toLowerCase(),
    lang: clean($("html").attr("lang"), 20),
    viewport: clean($("meta[name='viewport']").attr("content"), 120),
    h1: $("h1").map((_, el) => clean($(el).text(), 160)).get().filter(Boolean).slice(0, 5),
    h2: $("h2").map((_, el) => clean($(el).text(), 120)).get().filter(Boolean).slice(0, 12),
    wordCount: text ? text.split(/\s+/).length : 0,
    text: text.slice(0, 4_000),
    internalLinks: uniq(internal).slice(0, 200),
    externalLinks: uniq(external).slice(0, 100),
    navLinkCount: $("nav a, header a").length,
    forms,
    telLinks: uniq(links.filter((h) => /^tel:/i.test(h))).slice(0, 5),
    mailLinks: uniq(links.filter((h) => /^mailto:/i.test(h)).map((h) => h.replace(/^mailto:/i, "").split("?")[0])).slice(0, 5),
    whatsappLinks: uniq(links.filter((h) => /wa\.me|api\.whatsapp\.com|whatsapp:/i.test(h))).slice(0, 3),
    ctas,
    jsonLdTypes: uniq(jsonLdTypes).slice(0, 20),
    og,
    imagesTotal: images.length, imagesWithoutAlt,
    trackers: TRACKERS.filter(([, re]) => re.test(scripts) || re.test(html)).map(([name]) => name),
    socialLinks: uniq(external.filter((u) => SOCIAL.test(u))).slice(0, 8),
    hasFavicon: $("link[rel~='icon'], link[rel='apple-touch-icon']").length > 0,
    themeColor: clean($("meta[name='theme-color']").attr("content"), 30),
    logoCandidates: $("img[src*='logo' i], img[alt*='logo' i], img[class*='logo' i], [class*='logo' i] img, svg[class*='logo' i]").length,
    mixedContent: base.protocol === "https:" ? (html.match(/(?:src|href)=["']http:\/\/(?!localhost)[^"']+\.(?:js|css|png|jpe?g|gif|webp|svg)/gi) || []).length : 0,
    privacyLinks: uniq(links.filter((h) => /(kvkk|gizlilik|privacy|cerez|çerez|cookie|aydinlatma|aydınlatma)/i.test(h))).slice(0, 5),
    addressHints: hints(/(mah(?:allesi)?\.?\s|cad(?:desi)?\.?\s|sok(?:ak|\.)\s|no\s?:\s?\d+|bulvar|posta kodu|\b\d{5}\s+[a-zçğıöşü]+\/[a-zçğıöşü]+)/g),
    testimonialHints: hints(/(müşteri yorumları|yorumlar|müşterilerimiz ne diyor|referanslarımız|testimonial|google yorum|değerlendirme|\d[.,]\d\s?★|★{3,})/g),
    referenceHints: hints(/(referanslar|referanslarımız|projelerimiz|portfolyo|portfolio|çalıştığımız markalar|iş ortaklarımız|vaka çalışması|case study)/g),
    legalHints: hints(/(mersis|vergi dairesi|vergi no|ticaret sicil|ltd\. ?şti|a\.ş\.|limited şirketi|anonim şirketi)/g),
    bytes: meta.bytes, fetchMs: meta.fetchMs,
  };
}

