// Google Ads başlangıç formu: tek kaynak. Hem müşteri formu (form.html) hem panel bu şemayı kullanır;
// sunucu yalnızca şemada tanımlı alanları kabul eder.
const YNB = ["Evet", "Hayır", "Bilmiyorum"];

// ph: kutunun içinde görünen örnek yazı. Teknik terim kullanmayın; müşteri okuyup anlayabilmeli.
export const SCHEMA = [
  { id: "firma", title: "1. Sizi tanıyalım", intro: "Önce sizinle nasıl iletişim kuracağımızı yazın.", fields: [
    { id: "firma", label: "Firmanızın adı", type: "text", required: true, ph: "Örn. Yılmaz Diş Kliniği" },
    { id: "yetkili", label: "Adınız ve göreviniz", type: "text", ph: "Örn. Ahmet Yılmaz, işletme sahibi" },
    { id: "telefon", label: "Telefon numaranız", hint: "WhatsApp'tan da yazıyorsanız aynı numara olabilir.", type: "tel", ph: "Örn. 0532 000 00 00" },
    { id: "eposta", label: "E-posta adresiniz", type: "email", ph: "Örn. info@firmaniz.com" },
    { id: "site", label: "İnternet siteniz", hint: "Yoksa boş bırakın.", type: "text", ph: "Örn. www.firmaniz.com" },
    { id: "instagram", label: "Instagram hesabınız", hint: "Yoksa boş bırakın.", type: "text", ph: "Örn. @firmaniz" },
    { id: "adres", label: "Dükkan / ofis adresiniz ve kaç şubeniz var?", type: "textarea", rows: 2, ph: "Örn. Kadıköy, İstanbul. Tek şube." },
  ] },
  { id: "is", title: "2. İşinizi anlatın", intro: "Reklamı en çok kazandıran işlerinize göstereceğiz. Kesin rakam bilmiyorsanız tahmini yazın, olur.", fields: [
    { id: "kazandiran", label: "En çok para kazandığınız 3 hizmet veya ürün hangisi?", hint: "Reklamı önce bunlara yapacağız.", type: "textarea", rows: 3, ph: "Örn.\n1. İmplant\n2. Diş beyazlatma\n3. Kanal tedavisi" },
    { id: "ortKazanc", label: "Bir müşteriden ortalama ne kadar kazanıyorsunuz? (TL)", hint: "Bir müşteri size bir seferde ortalama kaç lira bırakıyor? Yaklaşık yazın.", type: "text", inputmode: "decimal", ph: "Örn. 8000" },
    { id: "hedefMusteri", label: "Ayda kaç yeni müşteri gelsin istersiniz?", type: "text", inputmode: "numeric", ph: "Örn. 20" },
    { id: "maxMaliyet", label: "Yeni bir müşteri için en fazla kaç lira reklam harcamak sizi rahatsız etmez? (TL)", hint: "Bilmiyorsanız boş bırakın, birlikte hesaplarız. Örneğin 8.000 TL kazandığınız müşteri için 800 TL harcamak çoğu zaman uygundur.", type: "text", inputmode: "decimal", ph: "Örn. 800" },
    { id: "farklar", label: "Sizi rakiplerinizden iyi yapan 2–3 şey nedir?", hint: "Yalnızca doğru ve kanıtlayabileceğiniz şeyleri yazın.", type: "textarea", rows: 3, ph: "Örn. 15 yıldır hizmet veriyoruz, aynı gün randevu, ücretsiz muayene" },
    { id: "rakipler", label: "Sizin gibi iş yapan rakipleriniz kimler?", hint: "2–3 firma adı ya da internet sitesi yeter.", type: "textarea", rows: 2, ph: "Örn. Örnek Diş Kliniği, www.ornekdis.com" },
  ] },
  { id: "bolge", title: "3. Nerede ve ne zaman hizmet veriyorsunuz?", intro: "Reklamınızı yalnızca işinize yarayacak yerde ve saatlerde göstereceğiz.", fields: [
    { id: "bolgeler", label: "Hangi şehir ve ilçelerdeki müşterilere hizmet veriyorsunuz?", type: "textarea", rows: 2, ph: "Örn. İstanbul: Kadıköy, Üsküdar, Ataşehir" },
    { id: "disBolgeler", label: "Gitmediğiniz ya da hizmet vermediğiniz yerler var mı?", hint: "Yoksa boş bırakın.", type: "textarea", rows: 2, ph: "Örn. Avrupa yakasına gitmiyoruz" },
    { id: "saatler", label: "Hangi gün ve saatlerde açıksınız?", type: "textarea", rows: 2, ph: "Örn. Hafta içi 09:00–19:00, Cumartesi 10:00–15:00" },
    { id: "haftasonu", label: "Hafta sonu hizmet veriyor musunuz?", type: "choice", options: ["Evet", "Hayır", "Kısmen"] },
  ] },
  { id: "negatif", title: "4. İstemediğiniz müşteriler", intro: "Bazı kişiler sizin yapmadığınız işi arayıp reklamınıza tıklayabilir. Bunu önlemek için neleri yapmadığınızı yazın; paranız boşa gitmesin.", fields: [
    { id: "yapmadiklariniz", label: "Hangi işleri yapmıyorsunuz?", type: "textarea", rows: 3, ph: "Örn. Ücretsiz hizmet vermiyoruz, ikinci el satmıyoruz, toptan satış yapmıyoruz" },
    { id: "istenmeyenKelime", label: "Reklamınızın çıkmasını hiç istemediğiniz kelimeler var mı?", hint: "Yoksa boş bırakın.", type: "textarea", rows: 2, ph: "Örn. ücretsiz, ikinci el, iş ilanı, staj" },
  ] },
  { id: "iletisim", title: "5. Aramalara kim bakacak?", intro: "Reklam çalışınca telefonunuz çalar ve mesajlar gelir. Hızlı dönüş yapmak, müşteriyi kaybetmemenin en önemli yolu.", fields: [
    { id: "aramaKisi", label: "Telefonlara kim bakacak?", type: "text", ph: "Örn. Ayşe Hanım, 0532 000 00 00" },
    { id: "waKisi", label: "WhatsApp mesajlarına kim bakacak?", type: "text", ph: "Örn. Ayşe Hanım, aynı numara" },
    { id: "aramaSaat", label: "Hangi saatlerde telefona bakılabiliyor?", type: "text", ph: "Örn. 09:00–19:00" },
    { id: "donus", label: "Gelen mesaja genelde ne kadar sürede dönebiliyorsunuz?", type: "choice", options: ["30 dk içinde", "Aynı gün", "Ertesi gün"] },
  ] },
  { id: "durum", title: "6. Şu an internette neleriniz var?", intro: "Hangisini bilmiyorsanız \"Bilmiyorum\" seçin, biz kontrol ederiz.", fields: [
    { id: "oncekiAds", label: "Daha önce Google'da reklam verdiniz mi?", type: "choice", options: ["Evet", "Hayır"] },
    { id: "oncekiSonuc", label: "Verdiyseniz nasıl geçti?", hint: "Ne zaman verdiniz, ayda kaç lira harcadınız, sonuç nasıldı?", type: "textarea", rows: 2, ph: "Örn. 2024'te 3 ay, ayda 5.000 TL. Çok arayan oldu ama çoğu alakasızdı." },
    { id: "adsHesap", label: "Google reklam hesabınız var mı?", type: "choice", options: YNB },
    { id: "gbp", label: "Google Haritalar'da firmanız görünüyor mu?", hint: "Google'a firma adınızı yazınca sağda çıkan kutu.", type: "choice", options: YNB },
    { id: "analytics", label: "Sitenizde ziyaretçi sayısını gösteren bir sistem (Google Analytics) var mı?", type: "choice", options: YNB },
    { id: "tekDokunus", label: "Siteniz telefondan açılınca, numaraya dokununca sizi arıyor mu?", type: "choice", options: YNB },
    { id: "https", label: "Siteniz adres çubuğunda kilit işaretiyle (https) açılıyor mu?", type: "choice", options: YNB },
    { id: "fiyatSayfasi", label: "Sitenizde hizmetleriniz veya fiyatlarınız yazıyor mu?", type: "choice", options: ["Evet", "Kısmen", "Hayır"] },
  ] },
  { id: "butce", title: "7. Reklam bütçesi", intro: "Reklam bütçesi doğrudan Google'a ödenir, bizim hizmet ücretimizden ayrıdır. Miktarı siz belirlersiniz ve istediğiniz zaman artırıp azaltabilirsiniz.", fields: [
    { id: "aylikButce", label: "Ayda yaklaşık ne kadar reklam bütçesi ayırabilirsiniz? (TL)", hint: "Bilmiyorsanız boş bırakın, size öneri sunarız.", type: "text", inputmode: "decimal", ph: "Örn. 20000" },
    { id: "baslangic", label: "Nasıl başlamak istersiniz?", type: "choice", options: ["Küçük başlayıp artıralım", "Baştan hedef bütçeyle"] },
    { id: "rapor", label: "Sonuçları ne zaman ve nereden öğrenmek istersiniz?", type: "text", ph: "Örn. Her ayın ilk haftası, WhatsApp'tan" },
  ] },
  { id: "erisim", title: "8. Hesap ve güvenlik", intro: "Google reklam hesabı sizin adınıza açılır; hesabın sahibi hep siz olursunuz. Biz yönetici olarak davet edilip çalışırız. Kredi kartınızı hesaba yalnızca siz girersiniz, bize vermeniz gerekmez. Şifrelerinizi kimseyle paylaşmayın.", fields: [
    { id: "googleEposta", label: "Google (Gmail) e-posta adresiniz", hint: "Hesap davetini bu adrese göndereceğiz.", type: "email", ph: "Örn. firmaniz@gmail.com" },
    { id: "hesapAcilsin", label: "Reklam hesabını sizin için biz açalım mı?", type: "choice", options: ["Evet", "Hesabım var, davet edeceğim"] },
  ] },
  { id: "onay", title: "9. Onay", fields: [
    { id: "onay", label: "Yazdığım bilgilerin doğru olduğunu ve reklam için kullanılmasını kabul ediyorum. Reklam sonuçlarının sektöre ve rekabete göre değişebileceğini, ilk haftaların deneme dönemi olduğunu ve sonuç garantisi verilmediğini biliyorum.", type: "check", required: true },
    { id: "imza", label: "Adınız ve soyadınız", type: "text", required: true, ph: "Örn. Ahmet Yılmaz" },
  ] },
];

const FIELDS = Object.fromEntries(SCHEMA.flatMap((s) => s.fields.map((f) => [f.id, f])));

export function cleanAnswers(raw) {
  const out = {};
  const src = raw && typeof raw === "object" ? raw : {};
  for (const [id, f] of Object.entries(FIELDS)) {
    let v = src[id];
    if (v == null) continue;
    if (f.type === "check") { out[id] = v === true || v === "true"; continue; }
    v = String(v).replace(/\r/g, "").trim().slice(0, f.type === "textarea" ? 2000 : 300);
    if (!v) continue;
    if (f.type === "choice" && !f.options.includes(v)) continue;
    out[id] = v;
  }
  return out;
}

export function missingRequired(a) {
  return Object.values(FIELDS).filter((f) => f.required && !(f.type === "check" ? a[f.id] === true : String(a[f.id] || "").trim())).map((f) => f.id);
}

const str = (v, n) => String(v ?? "").slice(0, n);
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const bools = (v, n) => Array.from({ length: n }, (_, i) => !!(Array.isArray(v) && v[i]));

// Kampanya planı: yalnızca bilinen alanlar, boyut sınırlı
export function cleanPlan(p) {
  const s = p && typeof p === "object" ? p : {};
  const num = (k) => str(s[k], 40);
  return {
    avgRevenue: num("avgRevenue"), avgProfit: num("avgProfit"), maxCpa: num("maxCpa"),
    targetCustomers: num("targetCustomers"), closeRate: num("closeRate"), budgetOverride: num("budgetOverride"),
    assumptions: str(s.assumptions, 2000),
    network: str(s.network, 600), location: str(s.location, 600), schedule: str(s.schedule, 600), device: str(s.device, 600),
    campaigns: arr(s.campaigns, 12).map((c) => ({ name: str(c?.name, 120), service: str(c?.service, 120), daily: str(c?.daily, 30), region: str(c?.region, 200), strategy: str(c?.strategy, 400) })),
    groups: arr(s.groups, 30).map((g) => ({ name: str(g?.name, 120), keywords: str(g?.keywords, 1500), match: str(g?.match, 40), note: str(g?.note, 400) })),
    negatives: str(s.negatives, 4000),
    headlines: arr(s.headlines, 15).map((x) => str(x, 80)),
    descriptions: arr(s.descriptions, 4).map((x) => str(x, 200)),
    extensions: str(s.extensions, 1500),
    checks: { track: bools(s.checks?.track, 6), launch: bools(s.checks?.launch, 10) },
    notes: str(s.notes, 4000),
    approvedBy: str(s.approvedBy, 120), approvedAt: str(s.approvedAt, 20), launchApproved: !!s.launchApproved,
  };
}
