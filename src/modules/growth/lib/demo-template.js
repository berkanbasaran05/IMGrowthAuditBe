// Firmaya özel, çok sayfalı demo site motoru.
// Tasarım sistemi sabit (public/demo-assets); içerik, renkler ve görseller firmanın marka dosyasından (lead.demo) gelir.
import { signImg } from "../api/img.js";
import { ARTICLES, FAQ_GROUPS, LOCAL } from "./sector-content.js";
import { PRESETS, presetKey, GLY2 } from "./sector-presets.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https:\/\/[^\s"'<>]+$/i.test(String(u || "")) ? String(u) : "");
const prox = (u) => (u ? `/api/img?u=${encodeURIComponent(u)}&s=${signImg(u)}` : "");
export const slugify = (s) => String(s || "").toLocaleLowerCase("tr").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const initials = (n) => String(n || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toLocaleUpperCase("tr");
const tel = (p) => String(p || "").split("/")[0].replace(/[^\d+]/g, "");
const wa = (p) => { let d = tel(p).replace(/^\+/, ""); if (d.startsWith("0")) d = "90" + d.slice(1); return d.length >= 11 ? d : ""; };

// Tasarım yönleri
const DIRS = {
  editorial: { display: "Newsreader", dw: 500, dls: "-.015em", body: "Hanken Grotesk", font: "Newsreader:opsz,wght@6..72,400;6..72,500&family=Hanken+Grotesk:wght@400;500;600;700", bg: "#FFFFFF", bg2: "#F6F4F0", rs: "2px", rm: "2px", rl: "2px", rb: "2px" },
  modern: { display: "Schibsted Grotesk", dw: 600, dls: "-.025em", body: "Hanken Grotesk", font: "Schibsted+Grotesk:wght@500;600;700&family=Hanken+Grotesk:wght@400;500;600;700", bg: "#FFFFFF", bg2: "#F4F5F6", rs: "3px", rm: "4px", rl: "4px", rb: "3px" },
  klinik: { display: "Onest", dw: 600, dls: "-.02em", body: "Onest", font: "Onest:wght@400;500;600;700", bg: "#FFFFFF", bg2: "#F3F6F6", rs: "4px", rm: "6px", rl: "6px", rb: "4px" },
  sicak: { display: "Young Serif", dw: 400, dls: "-.01em", body: "Hanken Grotesk", font: "Young+Serif&family=Hanken+Grotesk:wght@400;500;600;700", bg: "#FFFCF7", bg2: "#F6EFE5", rs: "4px", rm: "6px", rl: "6px", rb: "4px" },
  endustriyel: { display: "Archivo", dw: 700, dls: "-.02em", body: "Archivo", font: "Archivo:wght@400;500;600;700;800", bg: "#FFFFFF", bg2: "#F2F2F0", rs: "0px", rm: "0px", rl: "0px", rb: "0px" },
  boutique: { display: "Gilda Display", dw: 400, dls: "0", body: "Jost", font: "Gilda+Display&family=Jost:wght@400;500;600", bg: "#FDFBF8", bg2: "#F4EFE9", rs: "0px", rm: "0px", rl: "0px", rb: "0px" },
};

// Sektör ön ayarları (yalnızca firma verisi eksikse kullanılır)
const SECTORS = {
  veteriner: { dir: "editorial", accent: "#1F6F5C", ink: "#10231E", label: "Veteriner kliniği",
    steps: [["Randevu alın", "Telefon ya da WhatsApp'tan size uygun saati seçin."], ["Muayene", "Dostunuzu dikkatle inceleyip durumu açıkça anlatalım."], ["Tedavi ve takip", "Tedavi planını birlikte yapalım, kontrolleri hatırlatalım."]],
    form: { title: "Randevu talebi", button: "WhatsApp ile randevu iste", date: "Tercih ettiğiniz gün" },
    usps: [["Özenli hekimlik", "Evcil dostunuzun sağlığı için dikkatli ve sakin bir yaklaşım."], ["Randevulu, beklemesiz", "Zamanınızı ve dostunuzun konforunu önemsiyoruz."], ["Şeffaf bilgilendirme", "Her adımda ne yapıldığını ve nedenini açıkça anlatıyoruz."]],
    faq: [["Randevu almam gerekiyor mu?", "Randevulu gelmeniz bekleme süresini kısaltır; telefon ya da WhatsApp ile hızlıca randevu alabilirsiniz."], ["Aşı takvimini siz mi takip ediyorsunuz?", "Aşı ve kontrol zamanlarını sizin için planlayıp hatırlatabiliriz."], ["Acil durumda ne yapmalıyım?", "Önce telefonla ulaşın; durumu değerlendirip size en hızlı yolu söyleriz."]] },
  guzellik: { dir: "boutique", accent: "#8A3B4C", ink: "#26121A", label: "Salon",
    steps: [["Randevu", "WhatsApp'tan birkaç saniyede yerinizi ayırtın."], ["Danışma", "Tarzınızı ve beklentinizi birlikte konuşalım."], ["Uygulama", "Sonucu birlikte görelim."]],
    form: { title: "Randevu talebi", button: "WhatsApp ile randevu iste", date: "Tercih ettiğiniz gün" },
    usps: [["Size özel yaklaşım", "Yüz hattınıza ve tarzınıza uygun kişisel öneriler."], ["Özenli ürünler", "Saç ve cilt sağlığını koruyan profesyonel ürünler."], ["Kolay randevu", "WhatsApp'tan birkaç saniyede yerinizi ayırtın."]],
    faq: [["Randevusuz gelebilir miyim?", "Uygunluk durumuna göre mümkün; beklememek için randevu almanızı öneririz."], ["Fiyat bilgisi alabilir miyim?", "Hizmete göre değişir; WhatsApp'tan yazarsanız hemen bilgi verelim."]] },
  pastane: { dir: "sicak", accent: "#9A4A22", ink: "#2A160A", label: "Pastane",
    steps: [["Sipariş verin", "Ürününüzü ve teslim gününü bize iletin."], ["Hazırlık", "Siparişinizi özenle, taze hazırlayalım."], ["Teslim", "Belirlenen saatte hazır olsun."]],
    form: { title: "Sipariş talebi", button: "WhatsApp ile sipariş ver", date: "Teslim günü" },
    usps: [["Her gün taze", "Ürünlerimizi her sabah aynı özenle hazırlıyoruz."], ["Özel gün siparişleri", "Kutlamalarınız için size özel pastalar."], ["Aynı lezzet", "Müşterilerimizin bizi tercih etme sebebi."]],
    faq: [["Pasta siparişini ne kadar önce vermeliyim?", "Özel tasarım pastalar için en az 2 gün önceden sipariş vermenizi öneririz."], ["Toplu sipariş alıyor musunuz?", "Evet, ofis ve etkinlikler için toplu sipariş alıyoruz."]] },
  nakliyat: { dir: "endustriyel", accent: "#1E3A8A", ink: "#0B1633", label: "Nakliyat",
    steps: [["Yerinde ekspertiz", "Eşyalarınızı yerinde görüp net fiyat verelim."], ["Planlama", "Tarih, ekip ve araç planını birlikte yapalım."], ["Taşıma ve kurulum", "Paketleme, taşıma ve kurulumu eksiksiz tamamlayalım."]],
    form: { title: "Ekspertiz talebi", button: "WhatsApp ile teklif iste", date: "Taşınma tarihi" },
    usps: [["Özenli paketleme", "Eşyalarınızı taşıma öncesinde dikkatle hazırlıyoruz."], ["Net fiyat", "Yerinde ekspertiz ile sürprizsiz fiyat."], ["Zamanında teslim", "Planlanan gün ve saatte, eksiksiz."]],
    faq: [["Fiyat nasıl belirleniyor?", "Eşya miktarı, kat ve mesafeye göre; ekspertiz sonrası net fiyat verilir."], ["Paketleme yapıyor musunuz?", "Evet, istenirse paketleme ve kurulum ekibimiz tarafından yapılır."]] },
  genel: { dir: "modern", accent: "#1F2937", ink: "#0B0F17", label: "İşletme",
    steps: [["İletişim", "Arayın ya da WhatsApp'tan yazın."], ["Planlama", "İhtiyacınızı birlikte netleştirelim."], ["Hizmet", "Söz verdiğimiz zamanda, eksiksiz."]],
    form: { title: "Bilgi talebi", button: "WhatsApp ile gönder", date: "Tercih ettiğiniz gün" },
    usps: [["Deneyim", "İşimizi özenle yapıyoruz."], ["Hızlı iletişim", "Sorularınıza kısa sürede dönüyoruz."], ["Memnuniyet", "Tekrar tercih edilen işletme olmak için çalışıyoruz."]],
    faq: [["Nasıl ulaşabilirim?", "Telefonla arayabilir ya da WhatsApp'tan yazabilirsiniz."]] },
};
// Genişletilmiş ön ayarlar (sector-presets.js) aynı biçime çevrilir; base: makale/SSS/araç kütüphanesi anahtarı
const BASE = { kuafor: "guzellik", berber: "guzellik", estetik: "guzellik" };
for (const [k, P] of Object.entries(PRESETS)) SECTORS[k] = { dir: P.dir, accent: P.accent, ink: P.ink, label: P.label, steps: P.steps, form: P.form, usps: P.usps, faq: P.faq, h: P.h, sub: P.sub, services: P.services, base: BASE[k] || "genel", gk: k };
export function sectorOf(sector = "") {
  const s = sector.toLocaleLowerCase("tr");
  if (/pastane|fırın|firin|tatlı|börek|baklava/.test(s)) return SECTORS.pastane;
  const pk = presetKey(s); if (pk && !/veteriner|pet|nakliyat|lojistik/.test(s)) return SECTORS[pk];
  if (/veteriner|pet/.test(s)) return SECTORS.veteriner;
  if (/kuaför|kuafor|berber|güzellik|guzellik|estetik|salon|nail|cilt/.test(s)) return SECTORS.guzellik;
  if (/pastane|fırın|firin|kafe|cafe|restoran|tatlı|börek/.test(s)) return SECTORS.pastane;
  if (/nakliyat|lojistik|taşıma|kargo/.test(s)) return SECTORS.nakliyat;
  return SECTORS.genel;
}
export const presetFor = sectorOf;
const sectorKey = (sector = "") => { const S = sectorOf(sector); return S.base || Object.keys(SECTORS).find((k) => SECTORS[k] === S) || "genel"; };
const glyKey = (sector = "") => { const S = sectorOf(sector); return S.gk || Object.keys(SECTORS).find((k) => SECTORS[k] === S) || "genel"; };
// Panelin hızlı demo metni veya boş içerik: sektör ön ayarıyla zenginleştirilir
const GENERIC = /^(Hizmetlerimiz|Danışmanlık|Destek)$/;
function enrich(d0, S, lead) {
  const generic = !d0.level && (!(d0.services || []).length || (d0.services || []).some((x) => GENERIC.test(x.t || "")));
  if (!S.services) return d0;
  if (!generic) return (d0.services || []).length ? d0 : { ...d0, services: S.services.map(([t, d]) => ({ t, d })) };
  const dist = lead.district || "İstanbul";
  return { ...d0, headline: S.h.replace(/\{d\}/g, dist), sub: S.sub, services: S.services.map(([t, d]) => ({ t, d })), usps: undefined, why: undefined, faq: undefined, steps: undefined };
}
const fill = (t, M) => String(t).replace(/\{n\}/g, M.name).replace(/\{d\}/g, M.lead.district || "İstanbul");

function onColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return "#fff";
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.62 ? "#111111" : "#FFFFFF";
}
const hex = (h) => (/^#[0-9a-f]{6}$/i.test(h || "") ? h : "");
const DAYKEY = { pzt: 1, pazartesi: 1, sal: 2, salı: 2, çar: 3, çarşamba: 3, per: 4, perşembe: 4, cum: 5, cuma: 5, cmt: 6, cumartesi: 6, paz: 0, pazar: 0 };

// İçeriği tek biçime getir
export function model(lead) {
  const S = sectorOf(lead.sector), d = enrich(lead.demo || {}, S, lead);
  const dirKey = DIRS[d.direction] ? d.direction : S.dir, dir = DIRS[dirKey];
  const pal = d.palette || {};
  const p = hex(pal.primary) || hex(d.color) || S.accent;
  const images = (d.images || []).map(safeUrl).filter(Boolean).slice(0, 16).map(prox);
  const services = (d.services || []).filter((s) => s && s.t).slice(0, 8).map((s, i) => ({
    slug: slugify(s.slug || s.t) || "hizmet-" + (i + 1), t: s.t, d: s.d || "", long: s.long || "", includes: (s.includes || []).slice(0, 10),
    duration: s.duration || "", price: s.price || "", image: prox(safeUrl(s.image)) || (images.length > 1 ? images[1 + (i % (images.length - 1))] : ""), faq: (s.faq || []).slice(0, 5),
  }));
  const hoursTable = (d.hoursTable || []).filter((x) => x && x.d).slice(0, 7).map((x) => ({ d: x.d, h: x.h, k: DAYKEY[String(x.d).toLocaleLowerCase("tr").replace(/\.$/, "")] ?? -1 }));
  return {
    lead, d, S, dirKey, dir, images, services, hoursTable,
    name: lead.name, p, onP: onColor(p), ink: hex(pal.ink) || S.ink, bg: hex(pal.bg) || dir.bg, bg2: hex(pal.bg2) || dir.bg2,
    logo: prox(safeUrl(d.logo)), phone: tel(lead.phone), phoneTxt: String(lead.phone || "").split("/")[0].trim(), wa: wa(lead.phone),
    ig: String(lead.instagram || "").replace(/^@/, ""), place: [lead.district, lead.city || "İstanbul"].filter(Boolean).join(", "),
    story: (d.story?.length ? d.story : d.about ? [d.about] : []).slice(0, 6),
    usps: (d.usps?.length ? d.usps.map((x) => [x.t, x.d]) : d.why?.length ? d.why.map((x) => [x.t, x.d]) : S.usps).slice(0, 6),
    values: (d.values || []).slice(0, 6), stats: (d.stats || []).filter((x) => x && x.v).slice(0, 4),
    team: (d.team || []).filter((x) => x && x.name).slice(0, 8).map((x) => ({ ...x, image: prox(safeUrl(x.image)) })),
    menu: (d.menu || []).filter((c) => c && (c.items || []).length).slice(0, 8),
    reviews: (d.reviews || []).filter((r) => r && r.text).slice(0, 6),
    faq: (d.faq?.length ? d.faq.map((x) => [x.q, x.a]) : S.faq).slice(0, 8),
    steps: (d.steps?.length ? d.steps.map((x) => [x.t, x.d]) : S.steps).slice(0, 4),
    form: { ...S.form, ...(d.form || {}) },
    sk: sectorKey(lead.sector), gk: glyKey(lead.sector),
    hero: ["split", "full", "center"].includes(d.heroVariant) ? d.heroVariant : ["split", "full", "center"][[...String(lead.id || lead.name)].reduce((a, c) => a + c.charCodeAt(0), 0) % 3],
  };
}
export function extras(M) {
  const arts = [...(M.d.articles || []).filter((a) => a && a.t && a.body), ...(ARTICLES[M.sk] || [])].map((a) => ({ ...a, slug: slugify(a.slug || a.t) }));
  const groups = [...(M.d.faq?.length ? [["Sık sorulanlar", M.d.faq.map((x) => [x.q, x.a])]] : []), ...(FAQ_GROUPS[M.sk] || FAQ_GROUPS.genel)];
  return { arts, groups, local: (LOCAL[M.sk] || LOCAL.genel)(M.name, M.lead.district || "İstanbul") };
}
export function pagesOf(M) {
  const P = [["", "Ana sayfa"]];
  if (M.services.length) P.push(["hizmetler", "Hizmetler"]);
  if (M.menu.length) P.push(["urunler", M.d.menuTitle || "Ürünler"]);
  P.push(["hakkimizda", "Hakkımızda"]);
  if (M.images.length >= 4) P.push(["galeri", "Galeri"]);
  P.push(["blog", "Blog"]);
  P.push(["iletisim", "İletişim"]);
  return P;
}
// Menüde görünmeyen ama sitede bulunan sayfalar
const hiddenPages = (M) => [...(TOOLS[M.sk] ? [[TOOLS[M.sk][0], TOOLS[M.sk][1]]] : []), ["calisma-ilkelerimiz", "Çalışma ilkelerimiz"], ["kariyer", "Kariyer"], ...nearOf(M).map((x) => ["bolge/" + slugify(x), x]), ...M.team.map((t) => ["ekip/" + slugify(t.name), t.name]), ["sss", "Sık sorulan sorular"], ["randevu", M.form.title], ["bolge", extras(M).local.h], ...(M.reviews.length ? [["yorumlar", "Yorumlar"]] : []), ["kvkk", "KVKK aydınlatma metni"], ["gizlilik", "Gizlilik politikası"], ["cerez", "Çerez politikası"], ["site-haritasi", "Site haritası"]];

// ---------- Parçalar ----------
const U = (base, path, q) => `${base}${path ? "/" + path : ""}${q}`;
function header(M, base, q, cur) {
  const nav = pagesOf(M).filter(([k]) => k !== "");
  const mk = M.logo ? `<img src="${esc(M.logo)}" alt="" onerror="this.parentNode.textContent='${esc(initials(M.name))}'">` : esc(initials(M.name));
  const today = M.hoursTable.find((x) => x.k === new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" })).getDay());
  const top = `<div class="topbar"><div class="wrap"><div class="tl">${M.phone ? `<a href="tel:${esc(M.phone)}">${esc(M.phoneTxt)}</a>` : ""}${today ? `<span>Bugün ${esc(today.h)}</span>` : M.d.hours ? `<span>${esc(M.d.hours)}</span>` : ""}<span class="hide-m">${esc(M.d.address || M.place)}</span></div><div class="tr">${M.ig ? `<a href="https://instagram.com/${esc(M.ig)}" target="_blank" rel="noopener">Instagram</a>` : ""}${M.wa ? `<a href="https://wa.me/${M.wa}" target="_blank" rel="noopener">WhatsApp</a>` : ""}${M.lead.email ? `<a class="hide-m" href="mailto:${esc(M.lead.email)}">${esc(M.lead.email)}</a>` : ""}</div></div></div>`;
  return `${top}<header class="hd"><div class="wrap">
  <a class="logo" href="${U(base, "", q)}"><span class="mk">${mk}</span><b>${esc(M.name)}</b></a>
  <nav class="nav">${nav.map(([k, t]) => k === "hizmetler" && M.services.length ? `<div class="dd"><a href="${U(base, k, q)}"${cur === k || cur.startsWith(k + "/") ? ' aria-current="page"' : ""}>${esc(t)}</a><div class="ddm">${M.services.map((s) => `<a href="${U(base, "hizmetler/" + s.slug, q)}"><b>${esc(s.t)}</b><span>${esc(s.d)}</span></a>`).join("")}<a class="all" href="${U(base, "hizmetler", q)}">Tüm hizmetler →</a></div></div>` : `<a href="${U(base, k, q)}"${cur === k || cur.startsWith(k + "/") ? ' aria-current="page"' : ""}>${esc(t)}</a>`).join("")}</nav>
  ${M.wa ? `<a class="btn sm" href="${U(base, "randevu", q)}">${esc(M.form.title)}</a>` : M.phone ? `<a class="btn sm" href="tel:${esc(M.phone)}">Hemen arayın</a>` : ""}
  <button class="mt" id="mt" aria-label="Menü" aria-expanded="false"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
</div><nav class="mnav" id="mnav">${pagesOf(M).map(([k, t]) => `<a href="${U(base, k, q)}">${esc(t)}</a>`).join("")}</nav></header>`;
}
const media = (src, alt, cls = "", extra = "") => src
  ? `<div class="media ${cls}" ${extra}><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" onerror="this.parentNode.classList.add('ph');this.remove()"></div>`
  : `<div class="media ph ${cls}" ${extra}><span>${esc(initials(alt))}</span></div>`;
const ctas = (M, base, q) => `<div class="ctas">${M.wa ? `<a class="btn" href="${U(base, "iletisim", q)}#talep">${esc(M.form.title)}</a>` : ""}${M.phone ? `<a class="btn ghost" href="tel:${esc(M.phone)}">${esc(M.phoneTxt)}</a>` : ""}</div>`;
function statsBar(M) {
  const L = M.lead, items = [...M.stats.map((s) => [s.v, s.l])];
  // Puan yalnızca kaynağı belliyse ve rakamlarda zaten yoksa eklenir
  if (L.rating && L.reviews && items.length < 4 && !items.some(([v]) => String(v).includes(String(L.rating)))) items.push([`★ ${L.rating}`, `${L.reviews} değerlendirme`]);
  if (M.d.since && items.length < 4) items.push([M.d.since, "yılından beri"]);
  if (L.district && items.length < 4) items.push([L.district, L.city || "İstanbul"]);
  if (items.length < 4) items.push([M.hoursTable.length ? "Haftanın 6 günü" : "Randevu ile", M.d.hours || "Hızlı dönüş"]);
  return `<div class="band"><div class="wrap"><div class="stats">${items.slice(0, 4).map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("")}</div></div></div>`;
}
const svcList = (M, base, q, list) => `<div class="slist">${list.map((s, i) => `<a class="srow rv" href="${U(base, "hizmetler/" + s.slug, q)}"><span class="sn">${String(i + 1).padStart(2, "0")}</span><span class="st"><b>${esc(s.t)}</b><span>${esc(s.d)}</span></span><span class="sa" aria-hidden="true">→</span></a>`).join("")}</div>`;
const svcCards = (M, base, q, list) => `<div class="svcs">${list.map((s, i) => `<a class="svc rv" href="${U(base, "hizmetler/" + s.slug, q)}">${s.image ? `<div class="im"><img src="${esc(s.image)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></div>` : ""}<div class="bd"><span class="n">${String(i + 1).padStart(2, "0")}</span><h3>${esc(s.t)}</h3><p>${esc(s.d)}</p><span class="more">Detaylar</span></div></a>`).join("")}</div>`;
const quotes = (M) => M.reviews.length ? `<section class="alt"><div class="wrap"><div class="shead"><div><span class="eyebrow">Yorumlar</span><h2>Müşterilerimiz ne diyor?</h2></div><p class="muted">Google'daki gerçek yorumlardan.</p></div>
  <div class="quotes">${M.reviews.slice(0, 3).map((r) => `<div class="quote rv"><span class="st">${"★".repeat(Math.max(1, Math.min(5, +r.stars || 5)))}</span><p>“${esc(r.text)}”</p><span>${esc(r.name || "Google yorumu")}</span></div>`).join("")}</div></div></section>` : "";
const stepsSec = (M) => `<section><div class="wrap"><div class="shead"><div><span class="eyebrow">Süreç</span><h2>${esc(M.d.stepsTitle || "Nasıl çalışıyoruz?")}</h2></div></div>
  <div class="steps" style="--n:${M.steps.length}">${M.steps.map(([t, x], i) => `<div class="step rv"><b>${i + 1}</b><h3>${esc(t)}</h3><p>${esc(x)}</p></div>`).join("")}</div></div></section>`;
const faqSec = (list, title = "Merak edilenler") => list.length ? `<section><div class="wrap faq-g"><div><span class="eyebrow">Sık sorulan sorular</span><h2>${esc(title)}</h2><p class="muted" style="margin-top:14px">Aradığınız cevabı bulamadıysanız bize yazın.</p></div>
  <div class="faq">${list.map(([q, a], i) => `<details${i === 0 ? " open" : ""}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div></div></section>` : "";
function hoursList(M) {
  if (M.hoursTable.length) return `<div class="contact-list hours">${M.hoursTable.map((x) => `<div data-k="${x.k}"><span>${esc(x.d)}</span><b>${esc(x.h)}</b></div>`).join("")}</div>`;
  return M.d.hours ? `<div class="contact-list"><div><span>Çalışma saatleri</span><b>${esc(M.d.hours)}</b></div></div>` : "";
}
function bookForm(M, preset = "") {
  if (!M.wa) return "";
  const opts = [...M.services.map((s) => s.t), ...(M.menu.length ? ["Ürün siparişi"] : []), "Diğer"];
  return `<form class="form rv" data-wa>
  <div class="two"><label>Adınız<input name="ad" required autocomplete="name"></label><label>Telefon<input name="tel" type="tel" autocomplete="tel" placeholder="05xx xxx xx xx"></label></div>
  <div class="two"><label>Konu<select name="hizmet">${opts.map((o) => `<option${o === preset ? " selected" : ""}>${esc(o)}</option>`).join("")}</select></label><label>${esc(M.form.date)}<input name="gun" type="date"></label></div>
  <label>Not<textarea name="not" placeholder="Kısaca belirtin"></textarea></label>
  <button class="btn" type="submit">${esc(M.form.button)}</button><small>Gönder'e dokununca WhatsApp açılır; mesajı siz gönderirsiniz.</small></form>`;
}
const ctaBand = (M, base, q) => `<section class="tight"><div class="wrap"><div class="cta rv"><div><h2>${esc(M.d.ctaTitle || "Size nasıl yardımcı olabiliriz?")}</h2><p>${esc(M.d.ctaText || "Arayın ya da yazın; en kısa sürede dönüş yapalım.")}</p></div>
  <div class="ctas">${M.wa ? `<a class="btn" href="${U(base, "iletisim", q)}#talep">${esc(M.form.title)}</a>` : ""}${M.phone ? `<a class="btn ghost" href="tel:${esc(M.phone)}">Arayın</a>` : ""}</div></div></div></section>`;
function footer(M, base, q, bannerHref) {
  return `<footer class="ft"><div class="wrap"><div class="grid">
  <div><div class="big">${esc(M.name)}</div><span>${esc(M.d.tagline || M.d.sub || M.S.label + " · " + M.place)}</span></div>
  <div><h5>Sayfalar</h5>${pagesOf(M).map(([k, t]) => `<a href="${U(base, k, q)}">${esc(t)}</a>`).join("")}<a href="${U(base, "sss", q)}">Sık sorulan sorular</a>${M.reviews.length ? `<a href="${U(base, "yorumlar", q)}">Yorumlar</a>` : ""}<a href="${U(base, "bolge", q)}">${esc(extras(M).local.h)}</a>${TOOLS[M.sk] ? `<a href="${U(base, TOOLS[M.sk][0], q)}">${esc(TOOLS[M.sk][1])}</a>` : ""}<a href="${U(base, "calisma-ilkelerimiz", q)}">Çalışma ilkelerimiz</a><a href="${U(base, "kariyer", q)}">Kariyer</a></div>
  <div><h5>Hizmetler</h5>${M.services.slice(0, 6).map((s) => `<a href="${U(base, "hizmetler/" + s.slug, q)}">${esc(s.t)}</a>`).join("") || `<span>${esc(M.S.label)}</span>`}</div>
  <div><h5>İletişim</h5>${M.phone ? `<a href="tel:${esc(M.phone)}">${esc(M.phoneTxt)}</a>` : ""}${M.wa ? `<a href="https://wa.me/${M.wa}" target="_blank" rel="noopener">WhatsApp</a>` : ""}${M.ig ? `<a href="https://instagram.com/${esc(M.ig)}" target="_blank" rel="noopener">@${esc(M.ig)}</a>` : ""}${M.lead.email ? `<a href="mailto:${esc(M.lead.email)}">${esc(M.lead.email)}</a>` : ""}<span>${esc(M.d.address || M.place)}</span></div>
</div><div class="bottom"><span>© ${new Date().getFullYear()} ${esc(M.name)}. Tüm hakları saklıdır. · <a href="${U(base, "kvkk", q)}">KVKK</a> · <a href="${U(base, "gizlilik", q)}">Gizlilik</a> · <a href="${U(base, "cerez", q)}">Çerezler</a> · <a href="${U(base, "site-haritasi", q)}">Site haritası</a></span><span>Tasarım önerisi · <a href="https://www.istanbul.marketing" target="_blank" rel="noopener">istanbul.marketing</a> · <a href="${esc(bannerHref)}">Bu siteyi istiyorum</a></span></div></div></footer>
${M.phone || M.wa ? `<div class="mbar">${M.phone ? `<a class="btn" href="tel:${esc(M.phone)}">Ara</a>` : ""}${M.wa ? `<a class="btn ghost" href="https://wa.me/${M.wa}" target="_blank" rel="noopener">WhatsApp</a>` : ""}</div>` : ""}`;
}
const gal = (M, list, cls = "") => `<div class="gal ${cls}">${list.map((u, i) => `<figure class="rv${i % 5 === 0 ? " big" : ""}"><img src="${esc(u)}" alt="${esc(M.name)}" loading="lazy" onerror="this.parentNode.remove()"></figure>`).join("")}</div>`;
const phead = (M, base, q, crumbs, eyebrow, title, lede) => `<section class="phead"><div class="wrap"><div class="crumbs"><a href="${U(base, "", q)}">Ana sayfa</a>${crumbs.map(([t, h]) => ` / ${h ? `<a href="${U(base, h, q)}">${esc(t)}</a>` : esc(t)}`).join("")}</div><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(title)}</h1>${lede ? `<p class="lede">${esc(lede)}</p>` : ""}</div></section>`;
const bookSec = (M, h, lede, preset = "", alt = "") => M.wa ? `<section class="${alt}" id="talep"><div class="wrap book"><div class="rv"><span class="eyebrow">${esc(M.form.title)}</span><h2 style="margin:16px 0 18px">${esc(h)}</h2><p class="lede">${esc(lede)}</p>${M.hoursTable.length ? `<p style="margin-top:24px"><span class="open" data-open hidden></span></p>` : ""}</div>${bookForm(M, preset)}</div></section>` : "";

// ---------- Sayfalar ----------
function pHome(M, base, q) {
  const hero = M.images[0], ed = (M.hero === "full" || (M.dirKey === "editorial" && M.hero !== "center")) && hero;
  const heroHtml = ed
    ? `<section class="hero full"><div class="cover"><img src="${esc(hero)}" alt="${esc(M.name)}" fetchpriority="high"><div class="wrap"><span class="eyebrow">${esc(M.S.label)} · ${esc(M.lead.district || "İstanbul")}</span><h1 style="max-width:900px;margin:22px 0 22px">${esc(M.d.headline || M.name)}</h1><p class="lede" style="margin-bottom:34px">${esc(M.d.sub || "")}</p>${ctas(M, base, q)}</div></div></section>`
    : `<section class="hero"><div class="wrap grid"><div><span class="eyebrow">${esc(M.S.label)} · ${esc(M.lead.district || "İstanbul")}</span><h1>${esc(M.d.headline || M.name)}</h1><p class="lede">${esc(M.d.sub || "")}</p>${ctas(M, base, q)}</div>
      <div style="position:relative;width:100%">${media(hero, M.name).replace('loading="lazy"', 'fetchpriority="high"')}${M.lead.rating || M.d.hours ? `<div class="chip"><span class="dot">★</span><div><small>${esc(M.place)}</small><b>${M.lead.rating ? `${esc(M.lead.rating)}${M.lead.reviews ? ` · ${esc(M.lead.reviews)} yorum` : ""}` : esc(M.d.hours)}</b></div></div>` : ""}</div></div></section>`;
  const storyImg = M.images[1] || M.images[0];
  return `${heroHtml}
${statsBar(M)}
${M.story.length ? `<section><div class="wrap split"><div class="story rv"><span class="eyebrow">${esc(M.d.storyEyebrow || "Hikâyemiz")}</span><h2 style="margin-top:16px">${esc(M.d.aboutTitle || M.name)}</h2><p class="lede">${esc(M.story[0])}</p>${M.story[1] ? `<p class="muted">${esc(M.story[1])}</p>` : ""}<a class="link" href="${U(base, "hakkimizda", q)}">Hakkımızda</a></div>${media(storyImg, M.name, "rv")}</div></section>` : ""}
${M.services.length ? `<section class="alt"><div class="wrap"><div class="shead"><div><span class="eyebrow">Hizmetler</span><h2>${esc(M.d.servicesTitle || "Neler yapıyoruz?")}</h2><p class="lede">${esc(M.d.servicesIntro || "İhtiyacınıza uygun hizmeti seçin, detaylarına göz atın.")}</p></div><a class="btn ghost" href="${U(base, "hizmetler", q)}">Tüm hizmetler</a></div>${svcList(M, base, q, M.services.slice(0, 6))}</div></section>` : ""}
<section class="usp"><div class="wrap usp-g"><div><span class="eyebrow">Yaklaşımımız</span><h2>${esc(M.d.uspTitle || "Farkımız")}</h2>${M.d.tagline ? `<p class="lede" style="margin-top:18px">${esc(M.d.tagline)}</p>` : ""}</div><div class="usps">${M.usps.slice(0, 3).map(([t, x], i) => `<div class="rv"><span class="un">${String(i + 1).padStart(2, "0")}</span><div><b>${esc(t)}</b><p class="muted">${esc(x)}</p></div></div>`).join("")}</div></div></section>
${M.images.length >= 3 ? `<section><div class="wrap"><div class="shead"><div><span class="eyebrow">Galeri</span><h2>Bizden kareler</h2></div>${M.images.length >= 4 ? `<a class="btn ghost" href="${U(base, "galeri", q)}">Tüm galeri</a>` : ""}</div>${gal(M, M.images.slice(1, 6))}</div></section>` : ""}
${M.menu.length ? `<section class="alt"><div class="wrap"><div class="shead"><div><span class="eyebrow">${esc(M.d.menuTitle || "Ürünler")}</span><h2>${esc(M.d.menuHeadline || "Öne çıkanlar")}</h2></div><a class="btn ghost" href="${U(base, "urunler", q)}">Tümünü gör</a></div>
  <div class="menu">${M.menu.slice(0, 2).map((c) => `<div class="rv"><h3>${esc(c.cat)}</h3>${c.items.slice(0, 5).map((it) => `<div class="mi"><div><b>${esc(it.name)}</b>${it.desc ? `<p>${esc(it.desc)}</p>` : ""}</div>${it.price ? `<span>${esc(it.price)}</span>` : ""}</div>`).join("")}</div>`).join("")}</div></div></section>` : ""}
${TOOLS[M.sk] && M.sk !== "guzellik" ? `<section class="tight alt"><div class="wrap"><div class="cta rv tool-cta"><div><span class="eyebrow">Ücretsiz araç</span><h2 style="margin-top:12px">${esc(TOOLS[M.sk][1])}</h2><p>${esc(TOOLS[M.sk][2])}</p></div><div class="ctas"><a class="btn inv" href="${U(base, TOOLS[M.sk][0], q)}">Hemen deneyin</a></div></div></div></section>` : ""}
${stepsSec(M)}
${quotes(M)}
${bookSec(M, "Hemen yazın, size dönelim", "Formu doldurun; bilgileriniz WhatsApp mesajı olarak hazırlanır, tek dokunuşla gönderirsiniz.")}
${faqSec(M.faq)}
${ctaBand(M, base, q)}`;
}
const pServices = (M, base, q) => `${phead(M, base, q, [["Hizmetler"]], "Hizmetler", M.d.servicesTitle || "Neler yapıyoruz?", M.d.servicesIntro || "Her hizmetin detayına göz atın, sorularınız için bize yazın.")}
<section><div class="wrap">${svcCards(M, base, q, M.services)}</div></section>${stepsSec(M)}${ctaBand(M, base, q)}`;
function pService(M, base, q, slug) {
  const s = M.services.find((x) => x.slug === slug); if (!s) return null;
  const others = M.services.filter((x) => x.slug !== slug).slice(0, 3);
  return `${phead(M, base, q, [["Hizmetler", "hizmetler"], [s.t]], M.S.label, s.t, s.d)}
<section><div class="wrap two-col"><div>
  ${s.image ? media(s.image, s.t, "rv", 'style="aspect-ratio:16/9;margin-bottom:48px"') : ""}
  <div class="prose">${(s.long ? s.long.split(/\n+/) : [s.d]).filter(Boolean).map((x) => `<p>${esc(x)}</p>`).join("")}</div>
  ${s.includes.length ? `<h3 style="margin-top:48px">Neler dahil?</h3><ul class="includes">${s.includes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
</div><aside class="aside"><div class="card"><h4>${esc(s.t)}</h4><div class="kv">${s.duration ? `<div><span>Süre</span><b>${esc(s.duration)}</b></div>` : ""}<div><span>Fiyat</span><b>${esc(s.price || "Bilgi için yazın")}</b></div><div><span>Konum</span><b>${esc(M.lead.district || "İstanbul")}</b></div></div>
  <div class="ctas" style="margin-top:20px">${M.wa ? `<a class="btn" style="width:100%" href="https://wa.me/${M.wa}?text=${encodeURIComponent(`Merhaba, "${s.t}" hakkında bilgi almak istiyorum.`)}" target="_blank" rel="noopener">WhatsApp'tan sorun</a>` : ""}${M.phone ? `<a class="btn ghost" style="width:100%" href="tel:${esc(M.phone)}">${esc(M.phoneTxt)}</a>` : ""}</div></div></aside></div></section>
${faqSec(s.faq.map((x) => [x.q, x.a]), s.t + " hakkında")}
${bookSec(M, s.t + " için yazın", "Formu doldurun, WhatsApp'tan tek dokunuşla gönderin.", s.t, "alt")}
${others.length ? `<section><div class="wrap"><div class="shead"><div><span class="eyebrow">Diğer hizmetler</span><h2>Bunlar da ilginizi çekebilir</h2></div></div>${svcCards(M, base, q, others)}</div></section>` : ""}`;
}
const pAbout = (M, base, q) => `${phead(M, base, q, [["Hakkımızda"]], "Hakkımızda", M.d.aboutTitle || M.name, M.d.tagline || "")}
<section><div class="wrap split" style="align-items:start"><div class="prose rv">${(M.story.length ? M.story : [`${M.name}, ${M.place} bölgesinde hizmet veriyor.`]).map((x) => `<p>${esc(x)}</p>`).join("")}</div>${media(M.images[1] || M.images[0], M.name, "rv")}</div></section>
${statsBar(M)}
${M.d.mission ? `<section><div class="wrap narrow" style="text-align:center"><span class="eyebrow">Misyonumuz</span><h2 style="margin-top:18px;font-size:clamp(28px,3.4vw,44px)">“${esc(M.d.mission)}”</h2></div></section>` : ""}
<section class="alt"><div class="wrap"><div class="shead"><div><span class="eyebrow">${M.values.length ? "Değerlerimiz" : "Farkımız"}</span><h2>${M.values.length ? "Bizi biz yapanlar" : "Neden bizi tercih ediyorlar?"}</h2></div></div><div class="values">${(M.values.length ? M.values.map((v) => [v.t, v.d]) : M.usps.slice(0, 3)).map(([t, x]) => `<div class="value rv"><b>${esc(t)}</b><p>${esc(x)}</p></div>`).join("")}</div></div></section>
${M.team.length ? `<section><div class="wrap"><div class="shead"><div><span class="eyebrow">Ekibimiz</span><h2>Sizinle ilgilenecek ekip</h2></div></div><div class="team">${M.team.map((t) => `<a class="member rv" style="text-decoration:none" href="${U(base, "ekip/" + slugify(t.name), q)}">${t.image ? media(t.image, t.name, "im") : `<div class="im ph"><span>${esc(initials(t.name))}</span></div>`}<b>${esc(t.name)}</b><span>${esc(t.role || "")}</span></a>`).join("")}</div></div></section>` : ""}
${quotes(M)}
${ctaBand(M, base, q)}`;
const pMenu = (M, base, q) => `${phead(M, base, q, [[M.d.menuTitle || "Ürünler"]], M.d.menuTitle || "Ürünler", M.d.menuHeadline || "Ürünlerimiz", M.d.menuNote || "")}
<section><div class="wrap"><div class="menu">${M.menu.map((c) => `<div class="rv"><h3>${esc(c.cat)}</h3>${c.items.map((it) => `<div class="mi"><div><b>${esc(it.name)}</b>${it.desc ? `<p>${esc(it.desc)}</p>` : ""}</div>${it.price ? `<span>${esc(it.price)}</span>` : ""}</div>`).join("")}</div>`).join("")}</div></div></section>
${bookSec(M, "Sipariş ya da bilgi için yazın", "Formu doldurun, WhatsApp'tan tek dokunuşla gönderin.", "Ürün siparişi", "alt")}`;
const pGallery = (M, base, q) => `${phead(M, base, q, [["Galeri"]], "Galeri", M.name + "'den kareler", "")}<section><div class="wrap">${gal(M, M.images, "full")}</div></section>${ctaBand(M, base, q)}`;
function pContact(M, base, q) {
  const mapQ = encodeURIComponent(`${M.name} ${M.lead.district || ""} İstanbul`);
  return `${phead(M, base, q, [["İletişim"]], "İletişim", "Bize ulaşın", "Arayın, WhatsApp'tan yazın ya da yol tarifi alın.")}
<section><div class="wrap visit"><div class="card rv"><h3>${esc(M.name)}</h3>${M.hoursTable.length ? `<p style="margin-top:14px"><span class="open" data-open hidden></span></p>` : ""}
  <div class="contact-list"><div><span>Adres</span><b>${esc(M.d.address || M.place)}</b></div>${M.phone ? `<div><span>Telefon</span><b><a href="tel:${esc(M.phone)}">${esc(M.phoneTxt)}</a></b></div>` : ""}${M.lead.email ? `<div><span>E-posta</span><b>${esc(M.lead.email)}</b></div>` : ""}${M.ig ? `<div><span>Instagram</span><b><a href="https://instagram.com/${esc(M.ig)}" target="_blank" rel="noopener">@${esc(M.ig)}</a></b></div>` : ""}</div>
  ${hoursList(M)}
  ${M.d.transport ? `<p class="muted" style="margin-top:22px"><b style="color:var(--ink)">Ulaşım:</b> ${esc(M.d.transport)}</p>` : ""}
  <div class="ctas" style="margin-top:26px">${M.phone ? `<a class="btn" href="tel:${esc(M.phone)}">Arayın</a>` : ""}${M.wa ? `<a class="btn ghost" href="https://wa.me/${M.wa}" target="_blank" rel="noopener">WhatsApp</a>` : ""}${safeUrl(M.lead.mapsUrl) ? `<a class="btn ghost" href="${esc(M.lead.mapsUrl)}" target="_blank" rel="noopener">Yol tarifi</a>` : ""}</div></div>
  <div class="map rv"><iframe title="Harita" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${mapQ}&output=embed"></iframe></div></div></section>
${bookSec(M, "Hemen yazın, size dönelim", "Formu doldurun; bilgileriniz WhatsApp mesajı olarak hazırlanır.", "", "alt")}
${faqSec(M.faq)}`;
}

const artCard = (M, base, q, a) => `<a class="svc rv" href="${U(base, "blog/" + a.slug, q)}"><div class="bd"><span class="n">${esc(a.cat || "Rehber")} · ${a.min || 3} dk</span><h3>${esc(fill(a.t, M))}</h3><p>${esc(fill(a.d || "", M))}</p><span class="more">Devamını oku</span></div></a>`;
const pBlog = (M, base, q) => { const { arts } = extras(M); return `${phead(M, base, q, [["Blog"]], "Blog & rehber", "Bilmeniz gerekenler", `${M.name} ekibinden ${M.S.label.toLocaleLowerCase("tr")} hakkında faydalı bilgiler.`)}
<section><div class="wrap"><div class="svcs">${arts.map((a) => artCard(M, base, q, a)).join("")}</div></div></section>${ctaBand(M, base, q)}`; };
function pArticle(M, base, q, slug) {
  const { arts } = extras(M), a = arts.find((x) => x.slug === slug); if (!a) return null;
  const blocks = (Array.isArray(a.body) ? a.body : String(a.body).split(/\n+/)).map((x) => fill(x, M));
  const toc = blocks.filter((x) => x.startsWith("## ")).map((x) => x.slice(3));
  return `${phead(M, base, q, [["Blog", "blog"], [fill(a.t, M)]], `${a.cat || "Rehber"} · ${a.min || 3} dk okuma`, fill(a.t, M), fill(a.d || "", M))}
<section><div class="wrap two-col"><article class="prose">${blocks.map((x) => x.startsWith("## ") ? `<h3 id="${slugify(x.slice(3))}" style="margin:40px 0 14px">${esc(x.slice(3))}</h3>` : `<p>${esc(x)}</p>`).join("")}
  <p class="muted" style="margin-top:40px;font-size:15px">Bu yazı genel bilgilendirme amaçlıdır; size özel durumlar için ${esc(M.name)} ekibine danışın.</p></article>
<aside class="aside">${toc.length ? `<div class="card"><h4>Bu yazıda</h4><div class="kv">${toc.map((t) => `<div><a href="#${slugify(t)}" style="text-decoration:none">${esc(t)}</a></div>`).join("")}</div></div>` : ""}
<div class="card"><h4>Sorunuz mu var?</h4><p class="muted" style="font-size:15px;margin:6px 0 16px">${esc(M.name)} ekibine yazın.</p>${M.wa ? `<a class="btn" style="width:100%" href="${U(base, "randevu", q)}">${esc(M.form.title)}</a>` : M.phone ? `<a class="btn" style="width:100%" href="tel:${esc(M.phone)}">Arayın</a>` : ""}</div></aside></div></section>
<section class="alt"><div class="wrap"><div class="shead"><div><span class="eyebrow">Diğer yazılar</span><h2>Okumaya devam edin</h2></div></div><div class="svcs">${arts.filter((x) => x.slug !== slug).slice(0, 3).map((x) => artCard(M, base, q, x)).join("")}</div></div></section>`;
}
const pFaq = (M, base, q) => { const { groups } = extras(M); return `${phead(M, base, q, [["Sık sorulan sorular"]], "Yardım", "Sık sorulan sorular", "Aradığınızı bulamazsanız bize yazın.")}
<section><div class="wrap narrow">${groups.map(([g, list]) => `<h3 style="margin:48px 0 8px">${esc(g)}</h3><div class="faq">${list.map(([qq, a]) => `<details><summary>${esc(fill(qq, M))}</summary><p>${esc(fill(a, M))}</p></details>`).join("")}</div>`).join("")}</div></section>${ctaBand(M, base, q)}`; };
const pBook = (M, base, q) => `${phead(M, base, q, [[M.form.title]], M.form.title, M.wa ? "Hemen yazın, size dönelim" : "Bize ulaşın", "Formu doldurun; bilgileriniz WhatsApp mesajı olarak hazırlanır, tek dokunuşla gönderirsiniz.")}
<section><div class="wrap book"><div>${M.hoursTable.length ? `<p><span class="open" data-open hidden></span></p>` : ""}<div class="card" style="margin-top:20px"><h4 style="font:700 18px var(--body)">Nasıl ilerliyoruz?</h4><div class="kv" style="margin-top:8px">${M.steps.map(([t, x], i) => `<div><span>${i + 1}. ${esc(t)}</span></div>`).join("")}</div></div>${hoursList(M)}</div>${bookForm(M) || `<div class="card">${M.phone ? `<a class="btn" href="tel:${esc(M.phone)}">${esc(M.phoneTxt)}</a>` : ""}</div>`}</div></section>`;
const pLocal = (M, base, q) => { const { local } = extras(M); return `${phead(M, base, q, [[local.h]], M.lead.district || "İstanbul", local.h, local.p[0])}
<section><div class="wrap two-col"><div class="prose">${local.p.slice(1).map((x) => `<p>${esc(x)}</p>`).join("")}${M.d.transport ? `<p><b>Ulaşım:</b> ${esc(M.d.transport)}</p>` : ""}<p>Adres: ${esc(M.d.address || M.place)}</p>
  ${nearOf(M).length ? `<h3 style="margin:40px 0 16px">Çevre semtler</h3><ul class="includes">${nearOf(M).map((x) => `<li><a href="${U(base, "bolge/" + slugify(x), q)}">${esc(x)}</a></li>`).join("")}</ul>` : ""}
  ${M.services.length ? `<h3 style="margin:40px 0 16px">${esc(M.lead.district || "Bölge")}'de sunduğumuz hizmetler</h3><ul class="includes">${M.services.map((s) => `<li><a href="${U(base, "hizmetler/" + s.slug, q)}">${esc(s.t)}</a></li>`).join("")}</ul>` : ""}</div>
<aside class="aside"><div class="card"><h4>${esc(M.name)}</h4><div class="kv"><div><span>Semt</span><b>${esc(M.lead.district || "İstanbul")}</b></div>${M.phone ? `<div><span>Telefon</span><b>${esc(M.phoneTxt)}</b></div>` : ""}</div><div class="ctas" style="margin-top:18px"><a class="btn" style="width:100%" href="${U(base, "iletisim", q)}">Yol tarifi</a></div></div></aside></div></section>${ctaBand(M, base, q)}`; };
const pReviews = (M, base, q) => `${phead(M, base, q, [["Yorumlar"]], "Yorumlar", "Müşterilerimiz ne diyor?", M.lead.rating ? `Google'da ${M.lead.rating} puan${M.lead.reviews ? `, ${M.lead.reviews} değerlendirme` : ""}.` : "Google'daki gerçek yorumlardan.")}
<section><div class="wrap"><div class="quotes">${M.reviews.map((r) => `<div class="quote rv"><span class="st">${"★".repeat(Math.max(1, Math.min(5, +r.stars || 5)))}</span><p>“${esc(r.text)}”</p><span>${esc(r.name || "Google yorumu")}</span></div>`).join("")}</div></div></section>${ctaBand(M, base, q)}`;
function pLegal(M, base, q, kind) {
  const n = M.name, adr = M.d.address || M.place, T = {
    kvkk: ["KVKK aydınlatma metni", [`Bu aydınlatma metni, 6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında veri sorumlusu sıfatıyla ${n} tarafından hazırlanmıştır.`, "## İşlenen kişisel veriler", "İletişim formu, telefon ve WhatsApp üzerinden bizimle paylaştığınız ad, telefon numarası ve talebinize ilişkin bilgiler işlenebilir.", "## İşleme amaçları", "Kişisel verileriniz; talebinize dönüş yapılması, randevu ve hizmet süreçlerinin yürütülmesi ve yasal yükümlülüklerin yerine getirilmesi amaçlarıyla işlenir.", "## Haklarınız", `KVKK'nın 11. maddesi kapsamındaki haklarınızı kullanmak için ${adr} adresine yazılı olarak ya da iletişim kanallarımızdan bize başvurabilirsiniz.`]],
    gizlilik: ["Gizlilik politikası", [`${n} olarak ziyaretçilerimizin gizliliğine önem veriyoruz.`, "## Topladığımız bilgiler", "Sitemizde yalnızca formlar aracılığıyla kendi isteğinizle paylaştığınız bilgiler talebinize dönüş yapmak için kullanılır.", "## Üçüncü taraflar", "Bilgileriniz, yasal zorunluluklar dışında üçüncü taraflarla paylaşılmaz.", "## İletişim", "Gizlilikle ilgili sorularınız için iletişim sayfamızdaki kanalları kullanabilirsiniz."]],
    cerez: ["Çerez politikası", ["Sitemiz, temel işlevlerin çalışması ve deneyiminizi iyileştirmek amacıyla çerezler kullanabilir.", "## Zorunlu çerezler", "Sitenin düzgün çalışması için gereklidir.", "## Tercihleriniz", "Tarayıcı ayarlarınızdan çerezleri dilediğiniz zaman silebilir veya engelleyebilirsiniz."]],
  }[kind];
  return `${phead(M, base, q, [[T[0]]], "Yasal", T[0], "")}<section><div class="wrap narrow prose">${T[1].map((x) => x.startsWith("## ") ? `<h3 style="margin:36px 0 12px">${esc(x.slice(3))}</h3>` : `<p>${esc(x)}</p>`).join("")}
  <p class="muted" style="margin-top:36px;font-size:14.5px">Not: Bu metin tasarım önerisi kapsamında örnek olarak hazırlanmıştır; yayına alınmadan önce işletmenin hukuki danışmanıyla gözden geçirilmelidir.</p></div></section>`;
}
const pSitemap = (M, base, q) => { const { arts } = extras(M); return `${phead(M, base, q, [["Site haritası"]], "Site haritası", "Tüm sayfalar", "")}
<section><div class="wrap"><div class="values">
  <div class="value"><b>Sayfalar</b>${pagesOf(M).map(([k, t]) => `<p><a href="${U(base, k, q)}">${esc(t)}</a></p>`).join("")}${hiddenPages(M).map(([k, t]) => `<p><a href="${U(base, k, q)}">${esc(t)}</a></p>`).join("")}</div>
  <div class="value"><b>Hizmetler</b>${M.services.map((s) => `<p><a href="${U(base, "hizmetler/" + s.slug, q)}">${esc(s.t)}</a></p>`).join("") || "<p>—</p>"}</div>
  <div class="value"><b>Blog</b>${arts.map((a) => `<p><a href="${U(base, "blog/" + a.slug, q)}">${esc(fill(a.t, M))}</a></p>`).join("")}</div>
</div></div></section>`; };


// ---------- Genişletilmiş sayfalar ----------
const NEAR = { maltepe: ["Kartal", "Ataşehir", "Kadıköy", "Sultanbeyli", "Pendik"], kadikoy: ["Üsküdar", "Ataşehir", "Maltepe"], beylikduzu: ["Esenyurt", "Avcılar", "Büyükçekmece"], basaksehir: ["Esenler", "Bağcılar", "Küçükçekmece", "Arnavutköy"], bagcilar: ["Bahçelievler", "Esenler", "Güngören", "Küçükçekmece"], bahcelievler: ["Bağcılar", "Bakırköy", "Güngören", "Küçükçekmece"], kartal: ["Maltepe", "Pendik", "Sultanbeyli"], atasehir: ["Kadıköy", "Ümraniye", "Maltepe", "Üsküdar"], uskudar: ["Kadıköy", "Beykoz", "Ümraniye", "Ataşehir"], sisli: ["Beşiktaş", "Beyoğlu", "Kağıthane"], besiktas: ["Şişli", "Sarıyer", "Beyoğlu"], pendik: ["Kartal", "Tuzla", "Sultanbeyli"], esenyurt: ["Beylikdüzü", "Avcılar", "Başakşehir"] };
const nearOf = (M) => (NEAR[slugify(M.lead.district || "")] || []).slice(0, 5);
function pDistrict(M, base, q, dslug) {
  const d = nearOf(M).find((x) => slugify(x) === dslug); if (!d) return null;
  const mover = M.sk === "nakliyat";
  return `${phead(M, base, q, [[extras(M).local.h, "bolge"], [d]], d, mover ? `${d} evden eve nakliyat` : `${d}'den ${M.name}`, mover ? `${d} ve çevresindeki taşınmalarınızda ${M.name} yanınızda.` : `${d} ve çevresinden ${M.lead.district}'deki ${M.S.label.toLocaleLowerCase("tr")}mize kolayca ulaşabilirsiniz.`)}
<section><div class="wrap two-col"><div class="prose"><p>${esc(mover ? `${d}'den İstanbul'un her yerine ve şehirlerarası taşımada planlı ve güvenli hizmet veriyoruz. Ekspertiz ve net fiyat için bize ulaşın.` : `${M.name}, ${M.lead.district} ${M.d.address ? "(" + M.d.address + ")" : ""} adresinde hizmet veriyor. ${d}'den gelen misafirlerimiz için randevu ile bekleme süresini en aza indiriyoruz.`)}</p>
${M.d.transport ? `<p><b>Ulaşım:</b> ${esc(M.d.transport)}</p>` : ""}
${M.services.length ? `<h3 style="margin:36px 0 14px">${esc(d)} için hizmetlerimiz</h3><ul class="includes">${M.services.map((s) => `<li><a href="${U(base, "hizmetler/" + s.slug, q)}">${esc(s.t)}</a></li>`).join("")}</ul>` : ""}</div>
<aside class="aside"><div class="card"><h4>${esc(M.name)}</h4><div class="kv"><div><span>Konum</span><b>${esc(M.lead.district || "İstanbul")}</b></div>${M.phone ? `<div><span>Telefon</span><b>${esc(M.phoneTxt)}</b></div>` : ""}</div><div class="ctas" style="margin-top:18px"><a class="btn" style="width:100%" href="${U(base, "randevu", q)}">${esc(M.form.title)}</a></div></div></aside></div></section>
<section class="alt"><div class="wrap"><div class="shead"><div><span class="eyebrow">Hizmet bölgeleri</span><h2>Çevre semtler</h2></div></div><div class="includes" style="grid-template-columns:repeat(3,1fr)">${nearOf(M).map((x) => `<li><a href="${U(base, "bolge/" + slugify(x), q)}">${esc(x)}</a></li>`).join("")}</div></div></section>${ctaBand(M, base, q)}`;
}
function pTeam(M, base, q, slug) {
  const t = M.team.find((x) => slugify(x.name) === slug); if (!t) return null;
  return `${phead(M, base, q, [["Hakkımızda", "hakkimizda"], [t.name]], "Ekibimiz", t.name, t.role || "")}
<section><div class="wrap split" style="align-items:start">${t.image ? media(t.image, t.name, "", 'style="aspect-ratio:4/5"') : `<div class="media ph" style="aspect-ratio:4/5"><span>${esc(initials(t.name))}</span></div>`}
<div class="prose"><p>${esc(t.bio || `${t.name}, ${M.name} ekibinde ${String(t.role || "").toLocaleLowerCase("tr")} olarak görev yapıyor.`)}</p>${(t.areas || []).length ? `<h3 style="margin:32px 0 12px">Uzmanlık alanları</h3><ul class="includes">${t.areas.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
<div class="ctas" style="margin-top:32px">${M.wa ? `<a class="btn" href="${U(base, "randevu", q)}">${esc(M.form.title)}</a>` : ""}</div></div></div></section>`;
}
const pQuality = (M, base, q) => `${phead(M, base, q, [["Çalışma ilkelerimiz"]], "Kalite", "Çalışma ilkelerimiz", `${M.name} olarak her işte aynı özeni göstermek için izlediğimiz ilkeler.`)}
<section><div class="wrap"><div class="values">${[...(M.values.length ? M.values.map((v) => [v.t, v.d]) : []), ...M.usps].slice(0, 6).map(([t, x]) => `<div class="value rv"><b>${esc(t)}</b><p>${esc(x)}</p></div>`).join("")}</div></div></section>
${stepsSec(M)}${ctaBand(M, base, q)}`;
const pCareer = (M, base, q) => `${phead(M, base, q, [["Kariyer"]], "Kariyer", "Ekibimize katılın", `${M.name} ekibinin bir parçası olmak ister misiniz?`)}
<section><div class="wrap narrow prose"><p>Açık pozisyonlarımızı zaman zaman bu sayfada duyuruyoruz. Genel başvurular için özgeçmişinizi ve kısa bir tanıtım mesajınızı bize iletebilirsiniz.</p>
<div class="ctas" style="margin-top:28px">${M.lead.email ? `<a class="btn" href="mailto:${esc(M.lead.email)}?subject=${encodeURIComponent("İş başvurusu")}">E-posta ile başvur</a>` : ""}${M.wa ? `<a class="btn ghost" href="https://wa.me/${M.wa}?text=${encodeURIComponent("Merhaba, iş başvurusu hakkında bilgi almak istiyorum.")}" target="_blank" rel="noopener">WhatsApp ile yazın</a>` : ""}</div></div></section>`;
// Sektör araçları (hesaplayıcılar ve özel formlar) — site.js [data-tool] ile çalışır
const TOOLS = {
  veteriner: ["asi-takvimi", "Aşı takvimi planlayıcı", "Dostunuzun türünü ve doğum tarihini girin; genel aşı planlamasını görün. Kesin takvim hekiminiz tarafından belirlenir.",
    `<div class="two"><label>Tür<select name="tur"><option value="kopek">Köpek</option><option value="kedi">Kedi</option></select></label><label>Doğum tarihi<input name="dogum" type="date" required></label></div><button class="btn" type="submit">Planı göster</button>`],
  nakliyat: ["tasima-hesaplayici", "Taşınma hacmi hesaplayıcı", "Evinizin büyüklüğüne göre tahmini eşya hacmini, araç ve ekip ihtiyacını görün; net fiyat için yerinde ekspertiz isteyin.",
    `<div class="two"><label>Ev tipi<select name="oda"><option value="1">1+0 / 1+1</option><option value="2">2+1</option><option value="3" selected>3+1</option><option value="4">4+1 ve üzeri</option></select></label><label>Mesafe<select name="mesafe"><option value="ic">İlçe içi</option><option value="sehir">Şehir içi</option><option value="dis">Şehirlerarası</option></select></label></div>
     <div class="two"><label>Kat<input name="kat" type="number" min="0" max="40" value="2"></label><label>Asansör<select name="asansor"><option value="var">Var</option><option value="yok">Yok</option></select></label></div><button class="btn" type="submit">Hesapla</button>`],
  pastane: ["pasta-tasarla", "Pastanızı tasarlayın", "Kişi sayısı, tema ve teslim gününü seçin; önerimizi görün ve siparişinizi WhatsApp'tan tek dokunuşla iletin.",
    `<div class="two"><label>Kişi sayısı<input name="kisi" type="number" min="4" max="200" value="12"></label><label>Teslim günü<input name="gun" type="date"></label></div>
     <div class="two"><label>Tema<select name="tema"><option>Doğum günü</option><option>Nişan / düğün</option><option>Bebek / baby shower</option><option>Kurumsal</option><option>Diğer</option></select></label><label>Pasta üstü yazı<input name="yazi" placeholder="İyi ki doğdun…"></label></div><button class="btn" type="submit">Öneriyi gör</button>`],
  guzellik: ["hizmet-menusu", "Hizmet menüsü", "Hizmetleri ve sürelerini inceleyin, randevunuzu WhatsApp'tan iletin.", ""],
};
function pTool(M, base, q) {
  const T = TOOLS[M.sk]; if (!T) return null;
  const [, title, lede, form] = T;
  const body = M.sk === "guzellik"
    ? `<div class="menu"><div>${M.services.map((s) => `<div class="mi"><div><b>${esc(s.t)}</b><p>${esc(s.d)}${s.duration ? " · " + esc(s.duration) : ""}</p></div>${s.price ? `<span>${esc(s.price)}</span>` : ""}</div>`).join("")}</div>${bookForm(M)}</div>`
    : `<div class="book"><form class="form" data-tool="${T[0]}">${form}<small>Sonuç yalnızca genel bilgilendirme amaçlıdır.</small></form><div class="card" id="toolOut"><h4 style="font:700 18px var(--body)">Sonuç</h4><p class="muted" style="margin-top:8px">Formu doldurduğunuzda sonuç burada görünür.</p></div></div>`;
  return `${phead(M, base, q, [[title]], M.S.label, title, lede)}<section><div class="wrap">${body}</div></section>${ctaBand(M, base, q)}`;
}

const GLY = {
  veteriner: '<path d="M30 58c-9 0-16 6-16 12 0 5 4 8 9 8 3 0 4-2 7-2s4 2 7 2c5 0 9-3 9-8 0-6-7-12-16-12Z"/><circle cx="16" cy="40" r="6"/><circle cx="26" cy="30" r="6"/><circle cx="38" cy="30" r="6"/><circle cx="48" cy="40" r="6"/>',
  guzellik: '<circle cx="18" cy="22" r="8"/><circle cx="18" cy="58" r="8"/><path d="M24 27 60 62M24 53 60 18"/>',
  pastane: '<path d="M10 70h60V44H10v26Z"/><path d="M10 54c7 4 13 4 20 0s13-4 20 0 13 4 20 0"/><path d="M40 44V30M40 24c3 0 4-4 0-8-4 4-3 8 0 8Z"/>',
  nakliyat: '<path d="M6 24h42v34H6zM48 34h14l10 12v12H48z"/><circle cx="20" cy="62" r="6"/><circle cx="60" cy="62" r="6"/>',
  genel: '<path d="M40 10 48 30l22 2-17 14 5 22-18-11-18 11 5-22L10 32l22-2 8-20Z"/>',
};
const glyUrl = (sk) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80' fill='none' stroke='white' stroke-opacity='.34' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${(GLY[sk] || GLY2[sk] || GLY.genel).replace(/"/g, "'")}</svg>`)}")`;
// ---------- Ana çıktı ----------
export function renderDemo(lead, { bannerHref, base = `/demo/${lead.id}`, page = "", preview = false, embed = false, track = false }) {
  const M = model(lead), q = preview ? (embed ? "?preview=1&embed=1" : "?preview=1") : "";
  const pages = { "": pHome, hizmetler: pServices, hakkimizda: pAbout, iletisim: pContact, ...(M.menu.length ? { urunler: pMenu } : {}), ...(M.images.length >= 4 ? { galeri: pGallery } : {}) };
  if (!M.services.length) delete pages.hizmetler;
  Object.assign(pages, { "calisma-ilkelerimiz": pQuality, kariyer: pCareer, blog: pBlog, sss: pFaq, randevu: pBook, bolge: pLocal, kvkk: (a, b, c) => pLegal(a, b, c, "kvkk"), gizlilik: (a, b, c) => pLegal(a, b, c, "gizlilik"), cerez: (a, b, c) => pLegal(a, b, c, "cerez"), "site-haritasi": pSitemap, ...(M.reviews.length ? { yorumlar: pReviews } : {}) });
  let body = null, title = "";
  if (page.startsWith("hizmetler/")) { body = pService(M, base, q, page.slice(10)); title = M.services.find((s) => "hizmetler/" + s.slug === page)?.t || ""; }
  else if (page.startsWith("bolge/")) { body = pDistrict(M, base, q, page.slice(6)); title = nearOf(M).find((x) => "bolge/" + slugify(x) === page) || ""; }
  else if (page.startsWith("ekip/")) { body = pTeam(M, base, q, page.slice(5)); title = M.team.find((x) => "ekip/" + slugify(x.name) === page)?.name || ""; }
  else if (TOOLS[M.sk] && page === TOOLS[M.sk][0]) { body = pTool(M, base, q); title = TOOLS[M.sk][1]; }
  else if (page.startsWith("blog/")) { body = pArticle(M, base, q, page.slice(5)); title = extras(M).arts.find((a) => "blog/" + a.slug === page)?.t || ""; if (title) title = fill(title, M); }
  else if (pages[page]) { body = pages[page](M, base, q); title = ([...pagesOf(M), ...hiddenPages(M)].find(([k]) => k === page) || [])[1] || ""; }
  if (!body) return null;
  const dir = M.dir, L = lead, d = M.d;
  const ld = { "@context": "https://schema.org", "@type": "LocalBusiness", name: L.name, ...(M.phoneTxt ? { telephone: M.phoneTxt } : {}),
    address: { "@type": "PostalAddress", ...(d.address ? { streetAddress: d.address } : {}), addressLocality: L.district || "İstanbul", addressRegion: "İstanbul", addressCountry: "TR" },
    ...(L.rating && L.reviews ? { aggregateRating: { "@type": "AggregateRating", ratingValue: String(L.rating), reviewCount: String(L.reviews) } } : {}),
    ...(M.services.length ? { makesOffer: M.services.map((s) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s.t } })) } : {}) };
  const data = { sector: M.sk, name: M.name, lead: lead.id, page: page || "ana-sayfa", track, wa: M.wa, hours: M.hoursTable.map((x) => ({ k: x.k, h: String(x.h || "") })), formIntro: `Merhaba, ${M.form.title.toLocaleLowerCase("tr")} için yazıyorum.`, dateLabel: M.form.date };
  const feats = ["Çok sayfalı site: " + pagesOf(M).map(([, t]) => t).join(", "), M.services.length ? `${M.services.length} hizmet için ayrı detay sayfası` : "", "Telefonda ve bilgisayarda kusursuz görünüm",
    M.wa ? `${M.form.title} formu (WhatsApp'a hazır mesaj)` : "", M.phone ? "Tek dokunuşla arama" : "", "Google Haritalar ve yol tarifi",
    M.images.length ? "İşletmenizin kendi fotoğrafları" : "", M.hoursTable.length ? "Anlık açık/kapalı bilgisi" : "", M.menu.length ? "Ürün / menü sayfası" : "",
    `Blog: ${extras(M).arts.length} bilgilendirici yazı`, "Sık sorulan sorular, semt sayfası ve ayrı randevu sayfası", "KVKK, gizlilik ve çerez sayfaları", "Google için yapılandırılmış işletme verisi", "Markanıza özel renk ve yazı karakteri"].filter(Boolean);
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>${esc(title && page ? title + " · " : "")}${esc(L.name)} · ${esc(M.S.label)} ${esc(L.district || "İstanbul")}</title>
<meta name="description" content="${esc(d.sub || d.tagline || "")}">
<meta name="theme-color" content="${esc(M.p)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${dir.font}&display=swap">
<link rel="stylesheet" href="/demo-assets/site.css?v=9">
<style>:root{--p:${M.p};--on-p:${M.onP};--ink:${M.ink};--bg:${M.bg};--bg2:${M.bg2};--soft:color-mix(in srgb,${M.p} 9%,${M.bg});--muted:color-mix(in srgb,${M.ink} 64%,${M.bg});--line:color-mix(in srgb,${M.ink} 11%,transparent);--line-2:color-mix(in srgb,${M.ink} 20%,transparent);--display:"${dir.display}",Georgia,serif;--body:"${dir.body}",system-ui,sans-serif;--dw:${dir.dw};--dls:${dir.dls};--rs:${dir.rs};--rm:${dir.rm};--rl:${dir.rl};--rb:${dir.rb};--gly:${glyUrl(M.gk)}}</style>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
</head><body data-dir="${M.dirKey}" data-hero="${M.hero}">
${embed ? "" : `<div class="dbar"><span><b>istanbul<i>.</i>marketing</b> tarafından <b>${esc(L.name)}</b> için hazırlanmış bir tasarım önerisidir.</span><button type="button" id="featBtn" aria-expanded="false">Bu sitede neler var?</button><a href="${esc(bannerHref)}">Size özel sunum →</a></div>`}
<div class="feat" id="feat" hidden><h4>Bu tasarımda neler var?</h4><p>${esc(L.name)} için hazırlanan sitenin özellikleri:</p><ul>${feats.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><a href="${esc(bannerHref)}">Bu siteyi istiyorum</a></div>
${d.notice ? `<div class="notice">${esc(String(d.notice).slice(0, 160))}</div>` : ""}
${header(M, base, q, page)}
<main>${body}</main>
${footer(M, base, q, bannerHref)}
${embed ? "" : `<div class="cookie" id="cookie" hidden><span>Bu site deneyiminizi iyileştirmek için çerezler kullanır. <a href="${U(base, "cerez", q)}">Çerez politikası</a></span><button type="button" id="cookieOk" class="btn sm">Tamam</button></div>`}
${M.wa && !embed ? `<a class="waf" href="https://wa.me/${M.wa}" target="_blank" rel="noopener" aria-label="WhatsApp ile yazın"><svg viewBox="0 0 24 24" width="26" height="26" fill="#fff"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.5 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.7-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.3Z"/></svg></a>` : ""}
<dialog class="lb" id="lb"><img alt="" id="lbImg"></dialog>
<script type="application/json" id="site-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
<script src="/demo-assets/site.js?v=6" defer></script>
</body></html>`;
}

export function renderGone() {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Sayfa bulunamadı</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.6 system-ui,sans-serif;color:#07111F;background:#F5F3EF;padding:20px;text-align:center}a{color:#07111F;font-weight:600}</style></head>
<body><div><h1 style="font-size:24px;margin:0 0 8px">Bu sayfa bulunamadı ya da süresi doldu</h1><p style="color:#5E6673;margin:0 0 16px">Yeni bir tasarım önerisi için bize ulaşın.</p><a href="https://www.istanbul.marketing">istanbul.marketing</a></div></body></html>`;
}
