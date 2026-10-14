// Growth Audit™ ortak tipleri. Puanlama tanımları sürümlüdür; geçmiş denetimler kendi sürümüyle açıklanabilir kalır.

export const SCORING_VERSION = "gs-1.0";
export const RUBRIC_VERSION = "rubric-1.0";
export const PROMPT_VERSION = "analyst-1.1";

export type CategoryId = "brand" | "experience" | "technology" | "search" | "conversion" | "trust";
export type MetricState = "MEASURED" | "ESTIMATED" | "UNKNOWN" | "NOT_APPLICABLE" | "FAILED";
export type MetricMethod = "deterministic" | "pagespeed" | "ai";

export const CATEGORIES: { id: CategoryId; name: string; weight: number }[] = [
  { id: "brand", name: "Marka ve Konumlandırma", weight: 15 },
  { id: "experience", name: "Dijital Deneyim", weight: 20 },
  { id: "technology", name: "Teknoloji ve Performans", weight: 15 },
  { id: "search", name: "Arama ve Bulunabilirlik", weight: 20 },
  { id: "conversion", name: "Büyüme ve Dönüşüm", weight: 20 },
  { id: "trust", name: "Güven ve Otorite", weight: 10 },
];

export interface Evidence {
  source: string; // sayfa URL'si veya "robots.txt", "pagespeed:mobile" gibi kaynak adı
  observation: string;
}

export interface MetricResult {
  metricId: string;
  state: MetricState;
  score: number | null; // 0-100; yalnızca MEASURED/ESTIMATED için dolu
  confidence: number | null; // 0-1
  evidence: Evidence[];
  reason: string;
  recommendation?: string;
  modelVersion?: string;
  promptVersion?: string;
}

export interface ScoredMetric extends MetricResult {
  category: CategoryId;
  weight: number;
  method: MetricMethod;
  reviewerScore?: number | null;
}

export interface CategoryScore {
  id: CategoryId;
  name: string;
  weight: number;
  score: number | null;
  coverage: number; // değerlendirilen ağırlık / uygulanabilir ağırlık
  confidence: number | null;
  evaluated: number;
  applicable: number;
}

export interface ScoreResult {
  overall: number | null;
  coverage: number;
  confidence: number | null;
  categories: CategoryScore[];
}

// Sayfa çıkarım sonucu: AI'ya da yalnızca bu yapılandırılmış özet gider, ham HTML gitmez.
export interface PageSnapshot {
  url: string;
  status: number;
  role: string; // home, contact, about, services, references, blog, other
  title: string;
  metaDescription: string;
  canonical: string;
  metaRobots: string;
  lang: string;
  viewport: string;
  h1: string[];
  h2: string[];
  wordCount: number;
  text: string; // kısaltılmış görünür metin
  internalLinks: string[];
  externalLinks: string[];
  navLinkCount: number;
  forms: { fields: number; required: number; labelled: number; hasSubmit: boolean }[];
  telLinks: string[];
  mailLinks: string[];
  whatsappLinks: string[];
  ctas: string[];
  jsonLdTypes: string[];
  og: Record<string, string>;
  imagesTotal: number;
  imagesWithoutAlt: number;
  trackers: string[];
  socialLinks: string[];
  hasFavicon: boolean;
  themeColor: string;
  logoCandidates: number;
  mixedContent: number;
  privacyLinks: string[];
  addressHints: string[];
  testimonialHints: string[];
  referenceHints: string[];
  legalHints: string[];
  bytes: number;
  fetchMs: number;
}

export interface CrawlResult {
  startUrl: string;
  finalUrl: string;
  https: boolean;
  pages: PageSnapshot[];
  failedPages: { url: string; status: number | null; error: string }[];
  skippedByRobots: string[];
  robots: { found: boolean; status: number | null; blocksAll: boolean; sitemaps: string[]; text: string };
  sitemap: { found: boolean; url: string | null; urlCount: number };
}

export interface PageSpeedRun {
  strategy: "mobile" | "desktop";
  ok: boolean;
  error?: string;
  categories?: Record<string, number>;
  lab?: { lcpMs?: number; cls?: number; tbtMs?: number; fcpMs?: number; speedIndexMs?: number };
  field?: { category?: string; lcpMs?: number; cls?: number; inpMs?: number } | null;
  totalBytes?: number;
  opportunities?: { id: string; title: string; savingsMs?: number; savingsBytes?: number }[];
  screenshot?: string; // data URI (PageSpeed "final-screenshot")
}

export interface LeadInfo {
  id: string;
  name: string;
  sector?: string;
  city?: string;
  district?: string;
  phone?: string;
  email?: string;
  website?: string;
  instagram?: string;
  services?: string[];
}

export interface AuditContext {
  lead: LeadInfo;
  crawl: CrawlResult;
  pagespeed: { mobile: PageSpeedRun | null; desktop: PageSpeedRun | null };
}
