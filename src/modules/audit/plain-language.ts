// Müşteriye dönük sade dil: rapor (/r/:token, PDF) ve herkese açık analiz API'si bu adları kullanır.
// İç panel etiketleri (CATEGORIES, METRICS.name) değişmez.

export const CATEGORY_PLAIN: Record<string, string> = {
  brand: "Marka mesajı",
  experience: "Kullanım kolaylığı",
  technology: "Hız ve teknik altyapı",
  search: "Google'da bulunma",
  conversion: "Müşteriye dönüştürme",
  trust: "Güven",
};
export const categoryPlain = (id: string, fallback?: string) => CATEGORY_PLAIN[id] || fallback || id;

// Metrik → müşteriye gösterilecek sade başlık (sorun olarak) ve neden önemli olduğu.
export const METRIC_PLAIN: Record<string, { name: string; title: string; why: string }> = {
  brand_value_proposition: { name: "Ne yaptığınızın anlaşılması", title: "Ziyaretçi ne yaptığınızı hemen anlamıyor", why: "Ana sayfaya gelen kişi birkaç saniyede ne sunduğunuzu ve ona ne kazandıracağınızı göremezse siteden çıkar." },
  brand_target_audience: { name: "Kime hitap ettiğiniz", title: "Kime hizmet verdiğiniz net değil", why: "Doğru müşteri kendini sitede tanıyamazsa size ulaşma olasılığı düşer." },
  brand_differentiation: { name: "Rakiplerden farkınız", title: "Sizi rakiplerden ayıran şey öne çıkmıyor", why: "Fark net değilse müşteri sizi yalnızca fiyata göre karşılaştırır." },
  brand_messaging_consistency: { name: "Mesaj tutarlılığı", title: "Sayfalar arasında mesaj farklılaşıyor", why: "Tutarsız anlatım güveni azaltır ve markanın akılda kalmasını zorlaştırır." },
  brand_visual_identity: { name: "Logo ve görsel kimlik", title: "Logo ve görsel kimlik eksik görünüyor", why: "Tutarlı bir görünüm profesyonel ve güvenilir bir izlenim bırakır." },
  dx_mobile_usability: { name: "Telefonda kullanım", title: "Site telefonda rahat kullanılmıyor", why: "Ziyaretçilerin çoğu telefondan gelir; zor kullanılan site müşteri kaybettirir." },
  dx_navigation: { name: "Menü ve gezinme", title: "Aranan bilgiye ulaşmak zor", why: "Menü karışıksa ziyaretçi aradığını bulamadan ayrılır." },
  dx_information_architecture: { name: "Sayfa düzeni", title: "Bilgiler dağınık yerleşmiş", why: "Düzenli sayfalar ziyaretçinin karar vermesini kolaylaştırır." },
  dx_cta_visibility: { name: "Arama / iletişim butonları", title: "\"Ara\", \"Teklif al\" gibi butonlar yeterince görünmüyor", why: "Ziyaretçiye ne yapacağını açıkça söylemezseniz size ulaşmadan çıkar." },
  dx_form_usability: { name: "İletişim formu", title: "İletişim formu doldurması zahmetli", why: "Uzun veya karışık formlar yarıda bırakılır." },
  dx_accessibility: { name: "Herkes için okunabilirlik", title: "Bazı içerikler zor okunuyor", why: "Küçük yazı, düşük kontrast gibi sorunlar özellikle yaşlı ziyaretçileri zorlar." },
  tech_https: { name: "Güvenli bağlantı", title: "Site güvenli bağlantı (kilit simgesi) sorunu yaşıyor", why: "Tarayıcı \"güvenli değil\" uyarısı gösterirse ziyaretçi siteden çıkar." },
  tech_lighthouse_performance: { name: "Sayfa hızı", title: "Site yavaş açılıyor", why: "Yavaş açılan sayfayı ziyaretçiler beklemeden kapatır; Google da hızlı siteleri öne çıkarır." },
  tech_core_web_vitals: { name: "Gerçek kullanıcı deneyimi", title: "Sayfa açılırken kullanıcılar bekliyor veya içerik kayıyor", why: "Google, ziyaretçilerin yaşadığı gecikmeleri sıralamada dikkate alır." },
  tech_technical_errors: { name: "Bozuk sayfa ve bağlantılar", title: "Sitede çalışmayan sayfa veya bağlantılar var", why: "Hata veren sayfalar hem ziyaretçiyi hem Google'ı olumsuz etkiler." },
  tech_resource_optimization: { name: "Görsel ve dosya boyutları", title: "Görseller ve dosyalar gereğinden ağır", why: "Büyük dosyalar sayfayı özellikle mobil internette yavaşlatır." },
  seo_titles: { name: "Google'da görünen başlıklar", title: "Google'da görünen sayfa başlıkları zayıf", why: "Arama sonucunda görünen başlık, tıklanıp tıklanmayacağınızı belirler." },
  seo_meta_descriptions: { name: "Google'da görünen açıklamalar", title: "Google'da görünen kısa açıklamalar eksik", why: "İyi bir açıklama, aramada sizi seçme nedeni verir." },
  seo_indexability: { name: "Google'ın siteyi görebilmesi", title: "Google bazı sayfaları göremiyor", why: "Google'ın göremediği sayfa aramalarda hiç çıkmaz." },
  seo_sitemap_robots: { name: "Google'a yol gösteren dosyalar", title: "Google'a sitenizi tanıtan dosyalar eksik", why: "Bu dosyalar Google'ın tüm sayfalarınızı bulmasını hızlandırır." },
  seo_structured_data: { name: "Google için firma bilgileri", title: "Google firmanızın bilgilerini tam okuyamıyor", why: "Adres, telefon, çalışma saati gibi bilgiler doğru işaretlenince aramada daha dikkat çekici görünürsünüz." },
  seo_headings: { name: "Sayfa başlık düzeni", title: "Sayfa içi başlıklar düzensiz", why: "Net başlıklar hem okuyucunun hem Google'ın içeriği anlamasını sağlar." },
  seo_content_linking: { name: "İçerik zenginliği", title: "Sitede yeterli içerik ve sayfalar arası bağlantı yok", why: "Hizmetlerinizi anlatan içerik, Google'da daha fazla aramada çıkmanızı sağlar." },
  conv_path_clarity: { name: "Size ulaşma yolu", title: "Ziyaretçinin size nasıl ulaşacağı net değil", why: "Teklif almak veya aramak için izlenecek adım açık değilse talep gelmez." },
  conv_lead_capture: { name: "İletişim kanalları", title: "Size ulaşmanın kolay yolları eksik", why: "Telefon, WhatsApp ve form tek dokunuşla ulaşılabilir olmalı." },
  conv_landing_quality: { name: "Reklam sayfası kalitesi", title: "Reklamdan gelen ziyaretçiyi karşılayan sayfa zayıf", why: "Reklama para ödeyip zayıf bir sayfaya yönlendirmek bütçeyi boşa harcar." },
  conv_friction: { name: "Talep bırakma kolaylığı", title: "Talep bırakmak gereğinden zor", why: "Her ek adım, size ulaşacak müşteri sayısını azaltır." },
  conv_tracking_readiness: { name: "Sonuçları ölçme", title: "Siteden kaç müşteri geldiği ölçülemiyor", why: "Ölçüm yoksa reklam ve pazarlama harcamasının işe yarayıp yaramadığını bilemezsiniz." },
  trust_contact_transparency: { name: "İletişim bilgileri", title: "Adres ve iletişim bilgileri yeterince açık değil", why: "Açık adres ve telefon, gerçek ve ulaşılabilir bir firma olduğunuzu gösterir." },
  trust_case_studies: { name: "Referanslar", title: "Yaptığınız işlerden örnek yok", why: "Önceki işler, yeni müşterinin size güvenmesinin en kolay yoludur." },
  trust_testimonials: { name: "Müşteri yorumları", title: "Müşteri yorumları görünmüyor", why: "Başka müşterilerin memnuniyeti, karar vermeyi hızlandırır." },
  trust_info_consistency: { name: "Firma bilgisi tutarlılığı", title: "Firma bilgileri farklı yerlerde farklı yazıyor", why: "Tutarsız ad, adres veya telefon hem müşteriyi hem Google'ı karıştırır." },
  trust_signals: { name: "Güven işaretleri", title: "Güven veren işaretler (belge, ödül, garanti) eksik", why: "Belgeler ve garantiler, ilk kez gelen ziyaretçinin çekincesini azaltır." },
};

const firstMetric = (ids: unknown): string | null => (Array.isArray(ids) && ids.length ? String(ids[0]) : null);
export const metricPlainName = (id: string, fallback?: string) => METRIC_PLAIN[id]?.name || fallback || id;
// Fırsat için müşteri başlığı/nedeni; eşleşme yoksa kayıttaki metne düşer.
export function opportunityPlain(o: { metricIds?: unknown; title?: string; problem?: string }) {
  const p = METRIC_PLAIN[firstMetric(o.metricIds) || ""];
  return { title: p?.title || String(o.title || "").replace(/ iyileştirilmeli$/, ""), why: p?.why || String(o.problem || "") };
}

// Genel puan için sözlü değerlendirme.
export const gradeOf = (score: number | null, locale: "tr" | "en" = "tr") =>
  score == null ? (locale === "en" ? "Not available" : "Hesaplanamadı")
    : score >= 80 ? (locale === "en" ? "Good" : "İyi")
    : score >= 60 ? (locale === "en" ? "Room to improve" : "Geliştirilebilir")
    : (locale === "en" ? "Needs urgent improvement" : "Acil iyileştirme gerekli");

// Raporun sonundaki iletişim çağrısı (ortamdan değiştirilebilir).
export const CONTACT = {
  phone: process.env.REPORT_CONTACT_PHONE || "+905435932224",
  phoneDisplay: process.env.REPORT_CONTACT_PHONE_DISPLAY || "0543 593 22 24",
  whatsapp: process.env.REPORT_CONTACT_WHATSAPP || "905435932224",
  email: process.env.REPORT_CONTACT_EMAIL || "business@istanbul.marketing",
  site: "https://istanbul.marketing",
};
