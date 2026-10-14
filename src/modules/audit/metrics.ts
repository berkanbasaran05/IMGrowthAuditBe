import type { AuditContext, CategoryId, Evidence, MetricMethod, MetricResult, MetricState, PageSnapshot } from "./audit.types.js";

// Growth Score™ V1 metrik kataloğu (SCORING_VERSION gs-1.0).
// - deterministic: HTML/robots/sitemap kanıtından hesaplanır.
// - pagespeed: Google Lighthouse ölçümünden hesaplanır; ölçüm yoksa UNKNOWN.
// - ai: yalnızca toplanan kanıt üzerinden AI analisti puanlar (ai-analyst.ts); teknik ölçüm uyduramaz.
// weight: kategori içi göreli ağırlık. Kategori ağırlıkları audit.types.ts → CATEGORIES.

export interface MetricDefinition {
  id: string;
  category: CategoryId;
  weight: number;
  method: MetricMethod;
  name: string;
  rubric: string;
  service: string; // önerilecek Istanbul Marketing hizmeti
  impact: "high" | "medium" | "low";
  difficulty: "easy" | "medium" | "hard";
  evaluate?: (ctx: AuditContext) => Omit<MetricResult, "metricId">;
}

const r = (state: MetricState, score: number | null, confidence: number | null, evidence: Evidence[], reason: string, recommendation?: string): Omit<MetricResult, "metricId"> =>
  ({ state, score: score == null ? null : Math.round(Math.max(0, Math.min(100, score))), confidence, evidence, reason, recommendation });
const unknown = (reason: string) => r("UNKNOWN", null, null, [], reason);
const ev = (source: string, observation: string): Evidence => ({ source, observation });
const home = (ctx: AuditContext) => ctx.crawl.pages[0];
const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const short = (url: string) => { try { const u = new URL(url); return u.pathname === "/" ? u.hostname : u.pathname; } catch { return url; } };
const digits = (v: string) => v.replace(/\D/g, "").replace(/^90/, "").replace(/^0/, "");
const needPages = (ctx: AuditContext) => (ctx.crawl.pages.length ? null : unknown("Web sitesi sayfaları okunamadı"));
const psi = (ctx: AuditContext, s: "mobile" | "desktop") => (ctx.pagespeed[s]?.ok ? ctx.pagespeed[s]! : null);
const allForms = (pages: PageSnapshot[]) => pages.flatMap((p) => p.forms.map((f) => ({ ...f, url: p.url }))).filter((f) => f.fields > 0);

const AI_RUBRIC_SCALE = "0: hiç yok · 25: belirsiz/çelişkili · 50: kısmen var ama genel · 75: net, küçük eksikler · 100: çok net ve kanıtla desteklenmiş";

export const METRICS: MetricDefinition[] = [
  // ---------------- Marka ve Konumlandırma ----------------
  { id: "brand_value_proposition", category: "brand", weight: 3, method: "ai", name: "Değer önerisi netliği", service: "Web sitesi", impact: "high", difficulty: "medium",
    rubric: `Ana sayfa ilk ekran metinleri (title, H1, ilk paragraflar) firmanın ne yaptığını ve müşteriye hangi sonucu sağladığını açıkça söylüyor mu? ${AI_RUBRIC_SCALE}` },
  { id: "brand_target_audience", category: "brand", weight: 2, method: "ai", name: "Hedef kitle netliği", service: "Web sitesi", impact: "medium", difficulty: "easy",
    rubric: `Sitede hizmetin kime yönelik olduğu (segment, bölge, ihtiyaç) açıkça belirtiliyor mu? ${AI_RUBRIC_SCALE}` },
  { id: "brand_differentiation", category: "brand", weight: 2, method: "ai", name: "Marka farklılaşması", service: "Web sitesi", impact: "medium", difficulty: "medium",
    rubric: `Firma rakiplerinden ayrışan somut nedenler (yöntem, deneyim, kanıt, uzmanlık alanı) sunuyor mu? Genel klişeler ("kaliteli hizmet", "müşteri memnuniyeti") farklılaşma sayılmaz. ${AI_RUBRIC_SCALE}` },
  { id: "brand_messaging_consistency", category: "brand", weight: 1.5, method: "ai", name: "Mesaj tutarlılığı", service: "Web sitesi", impact: "low", difficulty: "easy",
    rubric: `İncelenen sayfalardaki başlıklar, açıklamalar ve hizmet anlatımı birbiriyle tutarlı mı; çelişen veya kopuk mesajlar var mı? ${AI_RUBRIC_SCALE}` },
  { id: "brand_visual_identity", category: "brand", weight: 1.5, method: "deterministic", name: "Görsel kimlik sinyalleri", service: "Web sitesi", impact: "low", difficulty: "easy",
    rubric: "Logo öğesi (40), favicon (25), paylaşım görseli og:image (25), tema rengi (10).",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const h = home(ctx), logo = h.logoCandidates > 0, og = !!h.og["og:image"], theme = !!h.themeColor;
      const score = (logo ? 40 : 0) + (h.hasFavicon ? 25 : 0) + (og ? 25 : 0) + (theme ? 10 : 0);
      return r("ESTIMATED", score, 0.6, [
        ev(h.url, logo ? `${h.logoCandidates} logo öğesi bulundu` : "Logo olarak işaretlenmiş görsel bulunamadı"),
        ev(h.url, h.hasFavicon ? "Favicon tanımlı" : "Favicon tanımı yok"),
        ev(h.url, og ? "og:image paylaşım görseli var" : "og:image paylaşım görseli yok"),
      ], "Logo tespiti dosya/sınıf adına dayanır; bu nedenle tahminidir.", score < 70 ? "Favicon ve sosyal paylaşım görseli (og:image) ekleyerek marka görünürlüğünü tutarlı hale getirin." : undefined);
    } },

  // ---------------- Dijital Deneyim ----------------
  { id: "dx_mobile_usability", category: "experience", weight: 3, method: "deterministic", name: "Mobil uyumluluk", service: "Web sitesi", impact: "high", difficulty: "medium",
    rubric: "width=device-width viewport ve yakınlaştırma açık: 100 · viewport var ama yakınlaştırma kapalı: 70 · viewport yok: 0.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const h = home(ctx), vp = h.viewport.toLowerCase();
      if (!vp.includes("width=device-width")) return r("MEASURED", 0, 0.9, [ev(h.url, vp ? `viewport: "${h.viewport}"` : "viewport meta etiketi yok")], "Sayfa mobil cihaz genişliğine uyarlanmıyor.", "Duyarlı (responsive) tasarım ve width=device-width viewport etiketi kullanın.");
      const noZoom = /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/.test(vp);
      return r("MEASURED", noZoom ? 70 : 100, 0.85, [ev(h.url, `viewport: "${h.viewport}"`)], noZoom ? "Viewport doğru ama kullanıcı yakınlaştırması kapatılmış." : "Viewport mobil uyumlu tanımlı.", noZoom ? "Erişilebilirlik için yakınlaştırmayı engelleyen viewport ayarını kaldırın." : undefined);
    } },
  { id: "dx_navigation", category: "experience", weight: 2, method: "deterministic", name: "Gezinme yapısı", service: "Web sitesi", impact: "medium", difficulty: "medium",
    rubric: "Üst menü/başlık bağlantı sayısı: 3-15 → 100 · 1-2 veya 16-40 → 60 · 40+ → 45 · hiç yok → 20.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const h = home(ctx), n = h.navLinkCount;
      const score = n === 0 ? 20 : n <= 2 ? 60 : n <= 15 ? 100 : n <= 40 ? 60 : 45;
      return r("ESTIMATED", score, 0.6, [ev(h.url, `Başlık/menü içinde ${n} bağlantı, sayfada ${h.internalLinks.length} iç bağlantı`)],
        n === 0 ? "Ana sayfada <nav>/<header> içinde menü bağlantısı bulunamadı." : `Menüde ${n} bağlantı var.`,
        score < 70 ? "Ana hizmetleri, hakkımızda ve iletişim sayfalarını içeren sade bir üst menü kurgulayın." : undefined);
    } },
  { id: "dx_information_architecture", category: "experience", weight: 2, method: "ai", name: "Bilgi mimarisi", service: "Web sitesi", impact: "medium", difficulty: "hard",
    rubric: `İncelenen sayfa listesi, başlıklar ve menüye bakarak; ziyaretçi hizmetleri, firmayı ve iletişimi mantıklı bir sırayla bulabiliyor mu? ${AI_RUBRIC_SCALE}` },
  { id: "dx_cta_visibility", category: "experience", weight: 2.5, method: "deterministic", name: "Harekete geçirici çağrı (CTA) görünürlüğü", service: "Web sitesi", impact: "high", difficulty: "easy",
    rubric: "Ana sayfada CTA metni yok → 10 · 1 CTA → 60 · 2+ CTA ve doğrudan iletişim (telefon/WhatsApp) → 90-100.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const h = home(ctx), direct = h.telLinks.length + h.whatsappLinks.length > 0;
      const score = !h.ctas.length ? (direct ? 45 : 10) : h.ctas.length === 1 ? (direct ? 75 : 60) : direct ? 100 : 80;
      return r("ESTIMATED", score, 0.6, [ev(h.url, h.ctas.length ? `CTA metinleri: ${h.ctas.slice(0, 5).map((c) => `"${c}"`).join(", ")}` : "Ana sayfada eylem çağrısı içeren buton/bağlantı bulunamadı"),
        ev(h.url, direct ? "Tıklanabilir telefon/WhatsApp bağlantısı var" : "Tıklanabilir telefon veya WhatsApp bağlantısı yok")],
        "Görsel konum (ilk ekranda olup olmadığı) ölçülmedi; metin ve bağlantı varlığına göre tahmindir.",
        score < 70 ? "İlk ekrana tek ve net bir ana CTA (ör. \"Ücretsiz keşif randevusu al\") ve tıklanabilir telefon/WhatsApp ekleyin." : undefined);
    } },
  { id: "dx_form_usability", category: "experience", weight: 1.5, method: "deterministic", name: "Form kullanılabilirliği", service: "Web sitesi", impact: "medium", difficulty: "easy",
    rubric: "En iyi form: ≤5 alan 100 · ≤8 alan 75 · daha fazla 50; etiketsiz alan varsa -20; gönder düğmesi yoksa -30. Form yoksa uygulanamaz.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const forms = allForms(ctx.crawl.pages);
      if (!forms.length) return r("NOT_APPLICABLE", null, null, [ev("site", "İncelenen sayfalarda form yok")], "Form bulunmadığı için değerlendirilmedi (form eksikliği 'Talep toplama' metriğinde ele alınır).");
      const scored = forms.map((f) => ({ f, s: (f.fields <= 5 ? 100 : f.fields <= 8 ? 75 : 50) - (f.labelled < f.fields ? 20 : 0) - (f.hasSubmit ? 0 : 30) })).sort((a, b) => b.s - a.s);
      const best = scored[0];
      return r("MEASURED", best.s, 0.8, scored.slice(0, 3).map(({ f }) => ev(f.url, `${f.fields} alan, ${f.required} zorunlu, ${f.labelled} etiketli${f.hasSubmit ? "" : ", gönder düğmesi yok"}`)),
        `En kullanışlı form ${best.f.fields} alanlı.`, best.s < 70 ? "Talep formunu ad, telefon ve ihtiyaç alanlarına indirin; her alana görünür etiket ekleyin." : undefined);
    } },
  { id: "dx_accessibility", category: "experience", weight: 1, method: "pagespeed", name: "Erişilebilirlik (Lighthouse)", service: "Web sitesi", impact: "low", difficulty: "medium",
    rubric: "Lighthouse mobil erişilebilirlik puanı doğrudan kullanılır.",
    evaluate: (ctx) => {
      const m = psi(ctx, "mobile");
      if (m?.categories?.accessibility == null) return unknown(ctx.pagespeed.mobile?.error ? `PageSpeed ölçümü alınamadı: ${ctx.pagespeed.mobile.error}` : "PageSpeed ölçümü yapılmadı");
      const s = m.categories.accessibility;
      return r("MEASURED", s, 0.9, [ev("pagespeed:mobile", `Lighthouse erişilebilirlik: ${s}/100`)], "Google Lighthouse mobil ölçümü.", s < 80 ? "Kontrast, alternatif metin ve form etiketi eksiklerini giderin." : undefined);
    } },

  // ---------------- Teknoloji ve Performans ----------------
  { id: "tech_https", category: "technology", weight: 2, method: "deterministic", name: "HTTPS yapılandırması", service: "Web sitesi", impact: "high", difficulty: "easy",
    rubric: "HTTPS ve karışık içerik yok: 100 · HTTPS ama http kaynak yükleniyor: 70 · HTTPS yok: 0.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const mixed = ctx.crawl.pages.reduce((s, p) => s + p.mixedContent, 0);
      if (!ctx.crawl.https) return r("MEASURED", 0, 0.95, [ev(ctx.crawl.finalUrl, "Site HTTP üzerinden sunuluyor")], "Bağlantı şifrelenmiyor; tarayıcılar 'güvenli değil' uyarısı gösterir.", "SSL sertifikası kurup tüm trafiği HTTPS'e yönlendirin.");
      return r("MEASURED", mixed ? 70 : 100, 0.9, [ev(ctx.crawl.finalUrl, "Site HTTPS üzerinden sunuluyor"), ...(mixed ? [ev("site", `${mixed} adet http:// kaynak (karışık içerik)`)] : [])],
        mixed ? "HTTPS var ancak bazı kaynaklar şifresiz yükleniyor." : "HTTPS doğru yapılandırılmış.", mixed ? "Görsel, script ve stil dosyalarını https:// adresinden yükleyin." : undefined);
    } },
  { id: "tech_lighthouse_performance", category: "technology", weight: 3, method: "pagespeed", name: "Lighthouse performansı", service: "Web sitesi", impact: "high", difficulty: "medium",
    rubric: "Mobil performans %70 + masaüstü %30 ağırlıkla; yalnızca biri varsa o kullanılır.",
    evaluate: (ctx) => {
      const m = psi(ctx, "mobile")?.categories?.performance, d = psi(ctx, "desktop")?.categories?.performance;
      if (m == null && d == null) return unknown(`PageSpeed ölçümü alınamadı${ctx.pagespeed.mobile?.error ? ": " + ctx.pagespeed.mobile.error : ""}`);
      const s = m != null && d != null ? m * 0.7 + d * 0.3 : (m ?? d)!;
      return r("MEASURED", s, 0.9, [...(m != null ? [ev("pagespeed:mobile", `Mobil performans ${m}/100`)] : []), ...(d != null ? [ev("pagespeed:desktop", `Masaüstü performans ${d}/100`)] : [])],
        "Google Lighthouse laboratuvar ölçümü.", s < 70 ? "Görselleri sıkıştırın, kullanılmayan JavaScript'i kaldırın ve önbellekleme ekleyin." : undefined);
    } },
  { id: "tech_core_web_vitals", category: "technology", weight: 3, method: "pagespeed", name: "Core Web Vitals", service: "Web sitesi", impact: "high", difficulty: "hard",
    rubric: "LCP ≤2,5 sn / CLS ≤0,1 / INP ≤200 ms → 100; 'iyileştirilmeli' aralığı → 60; zayıf → 20. Gerçek kullanıcı (CrUX) verisi varsa ölçülmüş, yalnızca laboratuvar verisi varsa (INP yerine TBT) tahmini sayılır.",
    evaluate: (ctx) => {
      const m = psi(ctx, "mobile");
      if (!m) return unknown("PageSpeed ölçümü alınamadı");
      const band = (v: number | undefined, good: number, poor: number) => (v == null ? null : v <= good ? 100 : v <= poor ? 60 : 20);
      const f = m.field;
      if (f && (f.lcpMs != null || f.inpMs != null)) {
        const parts = [band(f.lcpMs, 2500, 4000), band(f.cls, 0.1, 0.25), band(f.inpMs, 200, 500)].filter((x): x is number => x != null);
        return r("MEASURED", avg(parts), 0.9, [ev("pagespeed:crux", `Gerçek kullanıcı verisi: LCP ${f.lcpMs ?? "?"} ms, CLS ${f.cls ?? "?"}, INP ${f.inpMs ?? "?"} ms`)], "Chrome kullanıcı deneyimi (CrUX) saha verisi.", avg(parts) < 70 ? "En büyük içerik öğesini (LCP) hızlandırın ve düzen kaymalarını giderin." : undefined);
      }
      const l = m.lab || {};
      const parts = [band(l.lcpMs, 2500, 4000), band(l.cls, 0.1, 0.25), band(l.tbtMs, 200, 600)].filter((x): x is number => x != null);
      if (!parts.length) return unknown("Web Vitals değerleri raporlanmadı");
      return r("ESTIMATED", avg(parts), 0.6, [ev("pagespeed:mobile", `Laboratuvar: LCP ${Math.round(l.lcpMs ?? 0)} ms, CLS ${l.cls?.toFixed(3) ?? "?"}, TBT ${Math.round(l.tbtMs ?? 0)} ms`)],
        "Sitenin yeterli gerçek kullanıcı verisi yok; laboratuvar ölçümünden tahmin edildi.", avg(parts) < 70 ? "Mobilde LCP ve ana iş parçacığı engelleme süresini düşürün." : undefined);
    } },
  { id: "tech_technical_errors", category: "technology", weight: 2, method: "deterministic", name: "Teknik hatalar", service: "Web sitesi", impact: "medium", difficulty: "medium",
    rubric: "100'den: her hatalı sayfa (4xx/5xx/zaman aşımı) -25, karışık içerikli sayfa -10. Lighthouse 'en iyi uygulamalar' puanı varsa ortalamaya katılır.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const failed = ctx.crawl.failedPages, mixedPages = ctx.crawl.pages.filter((p) => p.mixedContent > 0).length;
      let score = 100 - failed.length * 25 - mixedPages * 10;
      const bp = psi(ctx, "mobile")?.categories?.["best-practices"];
      if (bp != null) score = (score + bp) / 2;
      return r("MEASURED", score, 0.8, [
        ...failed.slice(0, 4).map((f) => ev(f.url, `Açılmadı: ${f.error}`)),
        ev("site", `${ctx.crawl.pages.length} sayfa başarıyla okundu`),
        ...(bp != null ? [ev("pagespeed:mobile", `Lighthouse en iyi uygulamalar: ${bp}/100`)] : []),
      ], failed.length ? `${failed.length} sayfa hatalı döndü.` : "İncelenen sayfalarda HTTP hatası yok.", score < 70 ? "Kırık bağlantıları ve hata veren sayfaları düzeltin; konsol hatalarını giderin." : undefined);
    } },
  { id: "tech_resource_optimization", category: "technology", weight: 2, method: "pagespeed", name: "Kaynak optimizasyonu", service: "Web sitesi", impact: "medium", difficulty: "medium",
    rubric: "Mobil toplam sayfa ağırlığı ≤1,5 MB → 100 · ≤3 MB → 70 · ≤5 MB → 40 · daha fazla → 15; 300 ms üzeri kazanım fırsatı başına -5.",
    evaluate: (ctx) => {
      const m = psi(ctx, "mobile");
      if (!m || m.totalBytes == null) return unknown("PageSpeed kaynak ölçümü alınamadı");
      const mb = m.totalBytes / 1_048_576, ops = m.opportunities || [];
      const score = (mb <= 1.5 ? 100 : mb <= 3 ? 70 : mb <= 5 ? 40 : 15) - ops.length * 5;
      return r("MEASURED", score, 0.85, [ev("pagespeed:mobile", `Toplam sayfa ağırlığı ${mb.toFixed(2)} MB`), ...ops.slice(0, 3).map((o) => ev("pagespeed:mobile", `${o.title} (≈${o.savingsMs} ms kazanım)`))],
        "Lighthouse kaynak ve fırsat denetimleri.", score < 70 ? "Görselleri WebP/AVIF'e çevirin, boyutlandırın ve kullanılmayan kodları kaldırın." : undefined);
    } },

  // ---------------- Arama ve Bulunabilirlik ----------------
  { id: "seo_titles", category: "search", weight: 3, method: "deterministic", name: "Sayfa başlıkları (title)", service: "SEO", impact: "high", difficulty: "easy",
    rubric: "Sayfa başına: 15-65 karakter → 100 · var ama çok kısa/uzun → 60 · yok → 0. Tekrarlanan başlık başına -10.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const pages = ctx.crawl.pages, titles = pages.map((p) => p.title.toLocaleLowerCase("tr")).filter(Boolean);
      const dup = titles.length - new Set(titles).size;
      const score = avg(pages.map((p) => (!p.title ? 0 : p.title.length >= 15 && p.title.length <= 65 ? 100 : 60))) - dup * 10;
      return r("MEASURED", score, 0.95, pages.slice(0, 5).map((p) => ev(p.url, p.title ? `"${p.title}" (${p.title.length} karakter)` : "title etiketi yok")),
        dup ? `${dup} sayfada aynı başlık tekrar ediyor.` : "Başlıklar sayfa sayfa incelendi.", score < 80 ? "Her sayfaya hizmet + konum içeren, 50-60 karakterlik benzersiz bir başlık yazın." : undefined);
    } },
  { id: "seo_meta_descriptions", category: "search", weight: 2, method: "deterministic", name: "Meta açıklamalar", service: "SEO", impact: "medium", difficulty: "easy",
    rubric: "Sayfa başına: 50-170 karakter → 100 · var ama kısa/uzun → 60 · yok → 0.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const pages = ctx.crawl.pages;
      const score = avg(pages.map((p) => (!p.metaDescription ? 0 : p.metaDescription.length >= 50 && p.metaDescription.length <= 170 ? 100 : 60)));
      return r("MEASURED", score, 0.95, pages.slice(0, 5).map((p) => ev(p.url, p.metaDescription ? `${p.metaDescription.length} karakterlik açıklama` : "meta description yok")),
        `${pages.filter((p) => !p.metaDescription).length}/${pages.length} sayfada açıklama eksik.`, score < 80 ? "Her sayfa için arama sonucunda tıklatacak 140-160 karakterlik açıklama yazın." : undefined);
    } },
  { id: "seo_indexability", category: "search", weight: 3, method: "deterministic", name: "Dizine eklenebilirlik", service: "SEO", impact: "high", difficulty: "easy",
    rubric: "Ana sayfada noindex veya robots.txt tam engel → 0 · başka alan adına canonical → 40 · sorun yok → 100.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const h = home(ctx), evidence: Evidence[] = [];
      if (ctx.crawl.robots.blocksAll) return r("MEASURED", 0, 0.95, [ev("robots.txt", "Tüm site arama motorlarına kapalı (Disallow: /)")], "Site robots.txt ile engellenmiş.", "robots.txt'deki genel engeli kaldırın.");
      if (/noindex/.test(h.metaRobots)) return r("MEASURED", 0, 0.95, [ev(h.url, `meta robots: "${h.metaRobots}"`)], "Ana sayfa arama dizinine kapalı.", "Ana sayfadaki noindex etiketini kaldırın.");
      let score = 100;
      if (h.canonical) {
        try { if (new URL(h.canonical, h.url).hostname.replace(/^www\./, "") !== new URL(h.url).hostname.replace(/^www\./, "")) { score = 40; evidence.push(ev(h.url, `canonical başka alan adını gösteriyor: ${h.canonical}`)); } else evidence.push(ev(h.url, "canonical aynı alan adını gösteriyor")); } catch { /* geçersiz canonical yok sayılır */ }
      } else evidence.push(ev(h.url, "canonical etiketi yok (zorunlu değil)"));
      const noindexPages = ctx.crawl.pages.filter((p) => /noindex/.test(p.metaRobots)).length;
      if (noindexPages) { score -= 15 * noindexPages; evidence.push(ev("site", `${noindexPages} sayfada noindex`)); }
      evidence.push(ev(h.url, `HTTP ${h.status}, meta robots: ${h.metaRobots || "tanımsız (index)"}`));
      return r("MEASURED", score, 0.9, evidence, score === 100 ? "Ana sayfa dizine eklenebilir." : "Dizine eklemeyi kısıtlayan ayar var.", score < 100 ? "noindex ve canonical ayarlarını gözden geçirin." : undefined);
    } },
  { id: "seo_sitemap_robots", category: "search", weight: 2, method: "deterministic", name: "Site haritası ve robots.txt", service: "SEO", impact: "medium", difficulty: "easy",
    rubric: "robots.txt var → 50 · XML site haritası var ve URL içeriyor → 50.",
    evaluate: (ctx) => {
      const { robots, sitemap } = ctx.crawl;
      if (!ctx.crawl.pages.length && !robots.found) return unknown("Site okunamadı");
      const score = (robots.found ? 50 : 0) + (sitemap.found && sitemap.urlCount > 0 ? 50 : 0);
      return r("MEASURED", score, 0.95, [ev("robots.txt", robots.found ? `robots.txt var${robots.sitemaps.length ? `, ${robots.sitemaps.length} sitemap bildirimi` : ""}` : `robots.txt bulunamadı (HTTP ${robots.status ?? "-"})`),
        ev(sitemap.url || "sitemap.xml", sitemap.found ? `Site haritasında ${sitemap.urlCount} URL` : "XML site haritası bulunamadı")],
        "robots.txt ve XML site haritası kontrol edildi.", score < 100 ? "XML site haritası oluşturup robots.txt içinde bildirin ve Search Console'a gönderin." : undefined);
    } },
  { id: "seo_structured_data", category: "search", weight: 2, method: "deterministic", name: "Yapılandırılmış veri", service: "SEO", impact: "medium", difficulty: "easy",
    rubric: "İşletme şeması (Organization/LocalBusiness ve alt türleri) → 100 · başka geçerli şema → 60 · geçersiz JSON-LD → 30 · yok → 0.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const types = [...new Set(ctx.crawl.pages.flatMap((p) => p.jsonLdTypes))];
      const business = types.some((t) => /Organization|LocalBusiness|Corporation|Store|Restaurant|Dentist|Clinic|Physician|Service|Business|Hotel|Agency|Shop|Salon/i.test(t));
      const valid = types.filter((t) => t !== "(geçersiz JSON-LD)");
      const score = business ? 100 : valid.length ? 60 : types.length ? 30 : 0;
      return r("MEASURED", score, 0.9, [ev("site", types.length ? `JSON-LD türleri: ${types.join(", ")}` : "JSON-LD yapılandırılmış veri bulunamadı")],
        business ? "İşletme şeması mevcut." : "Arama motorları için işletme şeması eksik.", score < 100 ? "Adres, telefon, çalışma saatleri ve logo içeren LocalBusiness şeması ekleyin." : undefined);
    } },
  { id: "seo_headings", category: "search", weight: 1.5, method: "deterministic", name: "Başlık hiyerarşisi", service: "SEO", impact: "low", difficulty: "easy",
    rubric: "Sayfa başına tek H1 → 100 · birden fazla H1 → 70 · H1 yok → 20.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const pages = ctx.crawl.pages, score = avg(pages.map((p) => (p.h1.length === 1 ? 100 : p.h1.length > 1 ? 70 : 20)));
      return r("MEASURED", score, 0.9, pages.slice(0, 5).map((p) => ev(p.url, p.h1.length ? `${p.h1.length} H1: "${p.h1[0]}"` : "H1 yok")),
        "Sayfa başlık yapısı incelendi.", score < 80 ? "Her sayfada ana konuyu anlatan tek bir H1 kullanın." : undefined);
    } },
  { id: "seo_content_linking", category: "search", weight: 2, method: "deterministic", name: "İçerik ve iç bağlantılar", service: "SEO", impact: "medium", difficulty: "medium",
    rubric: "Ana sayfa kelime sayısı ≥300 → 100 · ≥150 → 70 · ≥50 → 40 · daha az → 15; 5'ten az iç bağlantı -20.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const h = home(ctx), w = h.wordCount, links = h.internalLinks.length;
      const score = (w >= 300 ? 100 : w >= 150 ? 70 : w >= 50 ? 40 : 15) - (links < 5 ? 20 : 0);
      return r("ESTIMATED", score, 0.7, [ev(h.url, `Ana sayfada yaklaşık ${w} kelime, ${links} iç bağlantı`), ev("site", `${ctx.crawl.pages.length} sayfa incelendi${ctx.crawl.sitemap.urlCount ? `, site haritasında ${ctx.crawl.sitemap.urlCount} URL` : ""}`)],
        "İçerik miktarı ölçüldü; içerik kalitesi bu metrikte değerlendirilmez.", score < 70 ? "Hizmet başına ayrı, en az 300 kelimelik sayfalar oluşturup ana sayfadan bağlantı verin." : undefined);
    } },

  // ---------------- Büyüme ve Dönüşüm ----------------
  { id: "conv_path_clarity", category: "conversion", weight: 2.5, method: "ai", name: "Dönüşüm yolu netliği", service: "Web sitesi", impact: "high", difficulty: "medium",
    rubric: `Ziyaretçinin bir sonraki adımı (ara, teklif iste, randevu al) sayfa metinlerinde ve CTA'larda açık mı, tek bir ana eyleme yönlendiriliyor mu? ${AI_RUBRIC_SCALE}` },
  { id: "conv_lead_capture", category: "conversion", weight: 3, method: "deterministic", name: "Talep toplama kanalları", service: "Google Ads", impact: "high", difficulty: "easy",
    rubric: "Gönderilebilir form 40 + tıklanabilir telefon 25 + WhatsApp 20 + e-posta bağlantısı 15.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const pages = ctx.crawl.pages, form = allForms(pages).some((f) => f.hasSubmit);
      const tel = pages.some((p) => p.telLinks.length), wa = pages.some((p) => p.whatsappLinks.length), mail = pages.some((p) => p.mailLinks.length);
      const score = (form ? 40 : 0) + (tel ? 25 : 0) + (wa ? 20 : 0) + (mail ? 15 : 0);
      return r("MEASURED", score, 0.85, [ev("site", `Form: ${form ? "var" : "yok"} · Telefon bağlantısı: ${tel ? "var" : "yok"} · WhatsApp: ${wa ? "var" : "yok"} · E-posta: ${mail ? "var" : "yok"}`)],
        "İncelenen sayfalardaki iletişim kanalları sayıldı.", score < 70 ? "Teklif/randevu formu ve tıklanabilir WhatsApp butonu ekleyerek talep toplama kanallarını artırın." : undefined);
    } },
  { id: "conv_landing_quality", category: "conversion", weight: 2, method: "ai", name: "Açılış sayfası kalitesi", service: "Google Ads", impact: "medium", difficulty: "medium",
    rubric: `Reklam trafiği gönderilecek ana sayfa/hizmet sayfası; teklif, fayda, kanıt ve eylem çağrısını tek akışta veriyor mu? ${AI_RUBRIC_SCALE}` },
  { id: "conv_friction", category: "conversion", weight: 1.5, method: "deterministic", name: "Dönüşüm sürtünmesi", service: "Web sitesi", impact: "medium", difficulty: "easy",
    rubric: "İletişime tek tıkla ulaşım 50 + en kısa form: ≤4 alan 50 · ≤6 alan 40 · ≤9 alan 25 · daha fazla 10 (form yoksa telefon/WhatsApp varlığı 40).",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const h = home(ctx), forms = allForms(ctx.crawl.pages);
      const contactLink = h.internalLinks.some((u) => /(iletisim|iletişim|contact)/i.test(decodeURIComponent(u)));
      const oneClick = contactLink || h.telLinks.length > 0 || h.whatsappLinks.length > 0;
      const min = forms.length ? Math.min(...forms.map((f) => f.fields)) : null;
      const formPart = min == null ? (h.telLinks.length || h.whatsappLinks.length ? 40 : 0) : min <= 4 ? 50 : min <= 6 ? 40 : min <= 9 ? 25 : 10;
      return r("ESTIMATED", (oneClick ? 50 : 0) + formPart, 0.6, [ev(h.url, oneClick ? "Ana sayfadan iletişime tek tıkla ulaşılabiliyor" : "Ana sayfada iletişim bağlantısı/telefon yok"), ev("site", min == null ? "Form yok" : `En kısa form ${min} alanlı`)],
        "Tıklama sayısı ve form uzunluğu üzerinden tahmin.", (oneClick ? 50 : 0) + formPart < 70 ? "İletişimi her sayfadan tek tıkla erişilebilir yapın ve formu kısaltın." : undefined);
    } },
  { id: "conv_tracking_readiness", category: "conversion", weight: 2, method: "deterministic", name: "Ölçüm ve izleme hazırlığı", service: "Google Ads", impact: "high", difficulty: "easy",
    rubric: "GA4 veya GTM → 60 · + reklam/piksel etiketi (Google Ads, Meta) → +25 · + davranış analizi (Clarity/Hotjar) → +15 · yalnızca eski Universal Analytics → 20 · hiç yok → 0.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const t = new Set(ctx.crawl.pages.flatMap((p) => p.trackers));
      const base = t.has("Google Analytics 4") || t.has("Google Tag Manager") ? 60 : t.has("Universal Analytics (eski)") ? 20 : 0;
      const ads = t.has("Google Ads etiketi") || t.has("Meta Pixel") || t.has("TikTok Pixel") || t.has("LinkedIn Insight") ? 25 : 0;
      const ux = t.has("Microsoft Clarity") || t.has("Hotjar") ? 15 : 0;
      const score = base ? base + ads + ux : ads ? 30 : 0;
      return r("MEASURED", score, 0.8, [ev("site", t.size ? `Tespit edilen etiketler: ${[...t].join(", ")}` : "Sayfa kaynağında analitik veya reklam etiketi bulunamadı")],
        "Etiketler sayfa kaynağından tespit edildi; çerez onayından sonra yüklenen etiketler görünmeyebilir.", score < 70 ? "GA4 ve Google Ads dönüşüm etiketini Tag Manager üzerinden kurup form/arama dönüşümlerini ölçün." : undefined);
    } },

  // ---------------- Güven ve Otorite ----------------
  { id: "trust_contact_transparency", category: "trust", weight: 3, method: "deterministic", name: "İletişim şeffaflığı", service: "Web sitesi", impact: "medium", difficulty: "easy",
    rubric: "Telefon 25 + e-posta 25 + açık adres 25 + iletişim sayfası 25.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const pages = ctx.crawl.pages, text = pages.map((p) => p.text).join(" ");
      const phone = pages.some((p) => p.telLinks.length) || /(\+90|0)\s?\(?[2-5]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/.test(text);
      const email = pages.some((p) => p.mailLinks.length) || /[\w.+-]+@[\w-]+\.[\w.]+/.test(text);
      const address = pages.some((p) => p.addressHints.length), contactPage = pages.some((p) => p.role === "contact");
      const score = (phone ? 25 : 0) + (email ? 25 : 0) + (address ? 25 : 0) + (contactPage ? 25 : 0);
      return r("MEASURED", score, 0.8, [ev("site", `Telefon: ${phone ? "var" : "yok"} · E-posta: ${email ? "var" : "yok"} · Adres: ${address ? "var" : "bulunamadı"} · İletişim sayfası: ${contactPage ? "var" : "yok"}`)],
        "İletişim bilgileri sayfa metinlerinde arandı.", score < 75 ? "Telefon, e-posta ve açık adresi her sayfanın alt bilgisinde gösterin." : undefined);
    } },
  { id: "trust_case_studies", category: "trust", weight: 2, method: "deterministic", name: "Referanslar ve vaka çalışmaları", service: "Web sitesi", impact: "medium", difficulty: "medium",
    rubric: "Referans/proje sayfası → 100 · metinde referans ifadesi → 60 · yok → 0.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const page = ctx.crawl.pages.find((p) => p.role === "references");
      const linked = ctx.crawl.pages[0].internalLinks.find((u) => /(referans|portfolyo|portfolio|projeler|projects)/i.test(decodeURIComponent(u)));
      const hints = ctx.crawl.pages.flatMap((p) => p.referenceHints);
      const score = page || linked ? 100 : hints.length ? 60 : 0;
      return r("ESTIMATED", score, 0.6, [ev(page?.url || linked || "site", page || linked ? "Referans/proje sayfası var" : hints.length ? `Metinde: ${[...new Set(hints)].slice(0, 3).join(", ")}` : "Referans veya proje içeriği bulunamadı")],
        "Sayfa adı ve metin ifadelerine göre tahmin.", score < 70 ? "Somut sonuç içeren 2-3 müşteri hikâyesi veya proje sayfası yayınlayın." : undefined);
    } },
  { id: "trust_testimonials", category: "trust", weight: 2, method: "deterministic", name: "Müşteri yorumları ve sosyal kanıt", service: "Sosyal medya", impact: "medium", difficulty: "easy",
    rubric: "Yorum/puan şeması (Review, AggregateRating) → 100 · sitede yorum bölümü ifadesi → 70 · yok → 0.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const schema = ctx.crawl.pages.some((p) => p.jsonLdTypes.some((t) => /Review|AggregateRating/i.test(t)));
      const hints = [...new Set(ctx.crawl.pages.flatMap((p) => p.testimonialHints))];
      const score = schema ? 100 : hints.length ? 70 : 0;
      return r("ESTIMATED", score, 0.6, [ev("site", schema ? "Review/AggregateRating şeması var" : hints.length ? `Metinde: ${hints.slice(0, 3).join(", ")}` : "Sitede müşteri yorumu bulunamadı")],
        "Site içi sosyal kanıt arandı; Google Haritalar yorumları bu metriğe dahil değildir.", score < 70 ? "Google yorumlarından seçilmiş, isim ve tarihli müşteri görüşlerini sitede gösterin." : undefined);
    } },
  { id: "trust_info_consistency", category: "trust", weight: 1.5, method: "deterministic", name: "Firma bilgisi tutarlılığı", service: "SEO", impact: "low", difficulty: "easy",
    rubric: "Kayıttaki telefon, e-posta ve firma adı sitede geçiyor mu; eşleşen kontrol oranı × 100. Karşılaştırılacak veri yoksa bilinmiyor.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const pages = ctx.crawl.pages, text = pages.map((p) => `${p.title} ${p.text}`).join(" ").toLocaleLowerCase("tr");
      const siteDigits = new Set([...pages.flatMap((p) => p.telLinks.map(digits)), ...(text.match(/(?:\+?90|0)?[\s(]*[2-5]\d{2}[\s)]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/g) || []).map(digits)]);
      const checks: [string, boolean][] = [];
      const leadPhones = (ctx.lead.phone || "").split(/[\/,;]/).map(digits).filter((d) => d.length === 10);
      if (leadPhones.length) checks.push(["Telefon", leadPhones.some((d) => siteDigits.has(d))]);
      if (ctx.lead.email) checks.push(["E-posta", text.includes(ctx.lead.email.toLowerCase()) || pages.some((p) => p.mailLinks.some((m) => m.toLowerCase() === ctx.lead.email!.toLowerCase()))]);
      const nameToken = (ctx.lead.name || "").toLocaleLowerCase("tr").split(/\s+/).find((t) => t.length >= 4);
      if (nameToken) checks.push(["Firma adı", text.includes(nameToken)]);
      if (!checks.length) return unknown("Karşılaştırılacak kayıt bilgisi yok");
      const score = (checks.filter(([, ok]) => ok).length / checks.length) * 100;
      return r("MEASURED", score, 0.75, checks.map(([k, ok]) => ev("site", `${k}: kayıttaki bilgi sitede ${ok ? "bulundu" : "bulunamadı"}`)),
        "CRM kaydı ile site içeriği karşılaştırıldı.", score < 100 ? "Telefon, e-posta ve firma adını site, Google İşletme Profili ve sosyal hesaplarda aynı yazın." : undefined);
    } },
  { id: "trust_signals", category: "trust", weight: 1.5, method: "deterministic", name: "Güven sinyalleri", service: "Web sitesi", impact: "low", difficulty: "easy",
    rubric: "HTTPS 20 + KVKK/gizlilik metni 30 + yasal firma bilgisi (unvan, MERSİS, vergi no) 25 + sosyal medya bağlantısı 25.",
    evaluate: (ctx) => {
      const miss = needPages(ctx); if (miss) return miss;
      const pages = ctx.crawl.pages, privacy = pages.some((p) => p.privacyLinks.length), legal = pages.some((p) => p.legalHints.length), social = pages.some((p) => p.socialLinks.length);
      const score = (ctx.crawl.https ? 20 : 0) + (privacy ? 30 : 0) + (legal ? 25 : 0) + (social ? 25 : 0);
      return r("MEASURED", score, 0.75, [ev("site", `HTTPS: ${ctx.crawl.https ? "var" : "yok"} · KVKK/gizlilik: ${privacy ? "var" : "yok"} · Yasal unvan/MERSİS: ${legal ? "var" : "yok"} · Sosyal medya: ${social ? "var" : "yok"}`)],
        "Güven unsurları sayfa kaynağında arandı.", score < 70 ? "KVKK aydınlatma metni, şirket unvanı ve sosyal medya bağlantılarını alt bilgiye ekleyin." : undefined);
    } },
];

export const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]));
export const AI_METRICS = METRICS.filter((m) => m.method === "ai");

export function evaluateDeterministic(ctx: AuditContext): MetricResult[] {
  return METRICS.filter((m) => m.evaluate).map((m) => {
    try { return { metricId: m.id, ...m.evaluate!(ctx) }; }
    catch (error: any) { return { metricId: m.id, state: "FAILED" as const, score: null, confidence: null, evidence: [], reason: `Değerlendirme hatası: ${String(error?.message || error).slice(0, 160)}` }; }
  });
}

// Doğrulanmış web sitesi yoksa tüm metrikler UNKNOWN'dır; site denetimi uydurulmaz.
export function noWebsiteResults(reason: string): MetricResult[] {
  return METRICS.map((m) => ({ metricId: m.id, state: "UNKNOWN" as const, score: null, confidence: null, evidence: [], reason }));
}
