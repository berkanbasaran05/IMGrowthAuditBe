// Firmaya özel satış sunumu: /demo/:slug/sunum
// istanbul.marketing kimliğiyle; firmanın markasıyla hazırlanmış Google, Haritalar, reklam, sosyal medya önizlemeleri,
// alan adı önerisi, performans, teslim planı, paketler ve onay.
import { model, pagesOf, slugify } from "./demo-template.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ascii = (s) => slugify(s).replace(/-/g, "");
const fmt = (d) => d.toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const GLYPH = {
  veteriner: '<path d="M30 58c-9 0-16 6-16 12 0 5 4 8 9 8 3 0 4-2 7-2s4 2 7 2c5 0 9-3 9-8 0-6-7-12-16-12Z"/><circle cx="16" cy="40" r="6"/><circle cx="26" cy="30" r="6"/><circle cx="38" cy="30" r="6"/><circle cx="48" cy="40" r="6"/>',
  guzellik: '<circle cx="18" cy="22" r="8"/><circle cx="18" cy="58" r="8"/><path d="M24 27 60 62M24 53 60 18"/>',
  pastane: '<path d="M10 70h60V44H10v26Z"/><path d="M10 54c7 4 13 4 20 0s13-4 20 0 13 4 20 0"/><path d="M40 44V30M40 24c3 0 4-4 0-8-4 4-3 8 0 8Z"/>',
  nakliyat: '<path d="M6 24h42v34H6zM48 34h14l10 12v12H48z"/><circle cx="20" cy="62" r="6"/><circle cx="60" cy="62" r="6"/>',
  genel: '<path d="M40 10 48 30l22 2-17 14 5 22-18-11-18 11 5-22L10 32l22-2 8-20Z"/>',
};
const glyph = (sk) => `<svg class="gly" viewBox="0 0 80 80" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[sk] || GLYPH.genel}</svg>`;
const KW = { veteriner: "veteriner", guzellik: "kuaför", pastane: "pastane", nakliyat: "evden eve nakliyat", genel: "" };

export function domainIdeas(lead) {
  const base = ascii(lead.name.replace(/\b(kliniği|klinigi|ltd|şti|sti|ve|tic)\b/gi, ""));
  const short = ascii(lead.name.split(/\s+/)[0]);
  const dist = ascii(lead.district || "");
  const generic = /^(trend|star|yildiz|altin|yeni|guzel|ozel|mega|super|best|top|net|pro|can|ay|gul)$/.test(short) || short.length < 5;
  const set = [`${base}.com.tr`, `${base}.com`, dist ? `${base}${dist}.com` : "", generic ? "" : `${short}.com.tr`, generic ? "" : `${short}${dist}.com`, `${base}.net.tr`].filter((x) => x && x.length < 40);
  return [...new Set(set)].slice(0, 5);
}

function igPosts(M) {
  const L = M.lead, imgs = M.images, svc = M.services, usp = M.usps;
  const P = [
    { k: "Tanıtım", h: M.d.tagline || M.d.headline || L.name, t: `${L.district || "İstanbul"} · ${M.S.label}`, img: imgs[0] },
    svc[0] && { k: "Hizmet", h: svc[0].t, t: svc[0].d, img: imgs[1] || imgs[0] },
    usp[0] && { k: "Neden biz", h: usp[0][0], t: usp[0][1], img: "" },
    { k: "Bilgi", h: M.S.label === "Veteriner kliniği" ? "Aşı takvimi hatırlatması" : "Sık sorulan soru", t: (M.faq[0] || ["", ""])[0], img: "" },
    svc[1] && { k: "Hizmet", h: svc[1].t, t: svc[1].d, img: imgs[2] || imgs[0] },
    { k: "Randevu", h: M.form.title, t: M.phoneTxt ? `☎ ${M.phoneTxt}` : "WhatsApp'tan yazın", img: imgs[3] || "" },
  ].filter(Boolean).slice(0, 6);
  return P;
}

export function renderSunum(lead, settings, { base, preview }) {
  const M = model({ ...lead, id: lead.id }), L = lead, d = M.d, q = preview ? "?preview=1" : "";
  const sk = Object.entries({ veteriner: /veteriner/, guzellik: /kuaför|kuafor|güzellik|salon|berber/, pastane: /pastane|fırın|kafe|restoran/, nakliyat: /nakliyat/ }).find(([, r]) => r.test((L.sector || "").toLocaleLowerCase("tr")))?.[0] || "genel";
  const kw = KW[sk] || (L.sector || "").toLocaleLowerCase("tr");
  const query = `${L.district || "İstanbul"} ${kw}`.trim();
  const domains = domainIdeas(L), dom = domains[0];
  const pages = pagesOf(M);
  const today = new Date();
  const plan = [
    ["Tanışma ve ihtiyaç analizi", "İşletmenizi, hedeflerinizi ve beklentilerinizi dinleyerek kapsamı birlikte belirleriz."],
    ["Tasarım ve içerik", "Sayfa yapısını, tasarım dilini ve içerikleri tamamen isteğinize göre şekillendiririz."],
    ["Geri bildirim ve düzenlemeler", "Taslakları sizinle paylaşır, onayınıza kadar gerekli düzenlemeleri yaparız."],
    ["Yayına alma", "Alan adı, güvenlik sertifikası ve Google kayıtlarıyla sitenizi yayına alırız."],
    ["Büyüme ve destek", "Dilerseniz Google reklamları ve sosyal medya yönetimiyle büyümeyi birlikte sürdürürüz."],
  ];
  const pk = (settings?.offer?.packages || []).filter((p) => p.name);
  const packages = pk.length ? pk : [
    { g: "Web sitesi · tek seferlik", name: "Başlangıç", price: "15.000 ₺", desc: "1–3 sayfalık tanıtım sitesi.", items: ["Size özel tasarım", "WhatsApp ve arama butonları", "Google Haritalar kurulumu"] },
    { g: "Web sitesi · tek seferlik", name: "Kurumsal", price: "35.000 ₺", star: 1, desc: "Çok sayfalı, kapsamlı kurumsal site.", items: ["Her hizmetiniz için ayrı sayfa", "Blog ve SEO altyapısı", "Alan adı, SSL, hosting kurulumu"] },
    { g: "Web sitesi · tek seferlik", name: "Özel / E-ticaret", price: "60.000 ₺'den", desc: "Online satış ya da rezervasyon altyapılı site.", items: ["İhtiyaca özel geliştirme", "Ödeme ve rezervasyon altyapısı", "Fiyat teklif ile netleşir"] },
    { g: "Mobil uygulama ve özel yazılım · proje bazlı", name: "Mobil Uygulama", desc: "İsteğinize özel iOS ve Android uygulaması. Fiyat kapsama göre görüşmede belirlenir.", items: ["Tasarım, geliştirme ve mağaza yayını", "Tamamlanınca size devredilir"] },
    { g: "Mobil uygulama ve özel yazılım · proje bazlı", name: "Özel Yazılım", desc: "Web uygulaması, yönetim paneli ve entegrasyonlar. Fiyat kapsama göre görüşmede belirlenir.", items: ["İş sürecinize göre geliştirme", "Tamamlanınca size devredilir"] },
    { g: "Aylık yönetim", name: "Google Reklam", price: "10.000 ₺", period: "/ ay", desc: `"${query}" gibi aramalarda öne çıkmanız için.`, items: ["Kampanya yönetimi ve aylık analiz", "Potansiyel müşteri takibi", "Web sitesi bakımı dahil"] },
    { g: "Aylık yönetim", name: "Instagram", price: "10.000 ₺", period: "/ ay", desc: "Markanıza özel içerik ve hesap yönetimi.", items: ["Gönderi ve story tasarımları", "İçerik planı", "Hesap yönetimi"] },
    { g: "Aylık yönetim", name: "Dijital Büyüme", price: "18.000 ₺", period: "/ ay", star: 1, desc: "Google reklam ve Instagram birlikte (ayrı ayrı 20.000 ₺).", items: ["İki paketin tüm kapsamı", "Her ay analiz ve iyileştirme", "Web sitesi bakımı dahil"] },
  ];
  const firstView = L.demoFirstView ? new Date(L.demoFirstView) : null;
  const until = firstView ? fmt(new Date(firstView.getTime() + 14 * 864e5)) : "";
  const how = [
    ["Fatura ve KDV dahil", "Web sitesi ve aylık paket fiyatlarının tümü fatura ve KDV dahildir. Hosting sunucusu için aylık küçük bir ücret ayrıca ödenir."],
    ["Aylık paketler her ay yenilenir", "Reklamlar her ay analiz edilir ve iyileştirilir; gelen müşteriler takip edilir, siteniz bakımda kalır."],
    ["Reklam bütçesi sizindir", "Google ve Instagram'a ödenen harcamayı siz belirlersiniz; günlük 200 ₺'den başlanabilir. Kendi adınıza açtığınız sanal karttan ödenir, aylık ücretten ayrıdır."],
    ["6 ay alana site hediye", "Dijital Büyüme paketini 6 ay alan işletmelere Başlangıç web sitesi ücretsizdir. Reels çekimi isteğe bağlıdır, çekim başına 3.000 ₺'den başlar."],
  ];
  const now = (L.issues || []).slice(0, 5);
  const next = L.websiteStatus === "iyi" ? [`"${query}" aramalarında üst sıralarda görünen Google reklamları`, "Her ay reklam analizi ve iyileştirme", "Gelen potansiyel müşterilerin takibi", "Aylık sonuç raporu", "Mevcut sitenizin bakımı"] : ["İsteğinize göre şekillenen, size özel kurumsal web sitesi", M.services.length ? "Her hizmetiniz için ayrı tanıtım sayfası" : "", "Telefondan tek dokunuşla arama ve WhatsApp", M.wa ? M.form.title + " formu" : "", "Google Haritalar ve yapılandırılmış işletme verisi", M.images.length ? "Kendi fotoğraflarınızla galeri" : "", "Blog, SSS ve semt sayfalarıyla aramalarda görünürlük"].filter(Boolean);
  const posts = igPosts(M);
  const ads = [
    { h1: `${L.name}`, h2: `${L.district || "İstanbul"} ${kw}`.trim(), h3: M.wa ? "WhatsApp'tan Hemen Yazın" : "Hemen Arayın", d: M.d.sub || `${M.S.label} · ${L.district || "İstanbul"}.` },
    M.services[0] && { h1: M.services[0].t, h2: `${L.name}`, h3: M.form.title.split(" ")[0] + " Alın", d: M.services[0].d || "" },
    M.usps[0] && { h1: M.usps[0][0], h2: `${L.district || "İstanbul"}`, h3: L.rating && L.reviews ? `★ ${L.rating} Puan` : "Hemen Arayın", d: M.usps[0][1] },
  ].filter(Boolean);
  const perf = d.perf;
  const star = (r) => "★★★★★".slice(0, Math.round(+r || 0)) + "☆☆☆☆☆".slice(0, 5 - Math.round(+r || 0));
  const pillars = [["Tanıtım içerikleri", "İşletmenizi, ekibinizi ve mekânınızı tanıtan paylaşımlar."], ["Hizmet anlatımları", "Hizmetlerinizi sade ve anlaşılır biçimde anlatan tasarımlar."], ["Bilgilendirici paylaşımlar", "Müşterilerinizin sık sorduğu konulara yanıt veren içerikler."], ["Kampanya ve duyurular", "Özel günler, kampanyalar ve güncel duyurular."]];
  const siteUrl = `${base}${q}`;

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive"><title>${esc(L.name)} için dijital büyüme önerisi · istanbul.marketing</title>
<link rel="icon" type="image/png" href="/brand/logo-symbol-on-light.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/demo-assets/sunum.css?v=19">
<style>:root{--cp:${M.p};--con:${M.onP};--cink:${M.ink}}</style></head>
<body>
<header class="top"><div class="w"><a href="https://www.istanbul.marketing" target="_blank" rel="noopener"><img src="/brand/logo-wordmark-on-light.png" alt="istanbul.marketing" height="20"></a>
<nav><a href="#simdi">Bugün</a><a href="#google">Google</a><a href="#isler">Çalışmalar</a><a href="#reklam">Reklam</a><a href="#sosyal">Sosyal medya</a><a href="#paketler">Hizmetler</a></nav>
<a class="cta" href="/teklif?lead=${esc(L.id)}">Başlayalım</a></div></header>

<section class="hero" data-sec="giris"><div class="w">
  <span class="eb"><i></i>${esc(L.name)} için hazırlandı · ${fmt(today)}</span>
  <h1>${esc(L.name)} için<br>dijital büyüme önerisi<span>.</span></h1>
  <p>${esc(L.name)} için hazırladığımız bu öneri, web sitesi, Google reklamları ve sosyal medya yönetimiyle ${esc(L.district || "İstanbul")}'de nasıl daha görünür olabileceğinizi gösteriyor. Sitenizin tasarımı, sayfaları ve içerikleri tamamen isteğinize göre, size özel olarak şekillenir.</p>
  <div class="btns"><a class="b1" href="#paketler">Hizmetler ve ödeme</a><a class="b2" href="/teklif?lead=${esc(L.id)}">Görüşme planlayın</a></div>
</div></section>

<section id="simdi" class="sec" data-sec="bugun"><div class="w">
  <div class="sh"><span class="n">01</span><div><h2>Bugün ve yarın</h2><p>Mevcut dijital görünümünüz ve bu öneriyle kazanacaklarınız.</p></div></div>
  <div class="vs"><div class="c old"><h3>Bugün</h3><ul>${(now.length ? now : ["Kendi web siteniz yok", "Aramalarda yalnızca rehber kayıtlarıyla görünüyorsunuz"]).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
  <div class="c new"><h3>Bu öneriyle</h3><ul>${next.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div>
</div></section>

<section id="isler" class="sec" data-sec="isler"><div class="w">
  <div class="sh"><span class="n">02</span><div><h2>Çalışmalarımızdan</h2><p>Birlikte çalıştığımız markalar için hazırladığımız dijital işlerden bazıları.</p></div></div>
  <div class="wk">${[["Bilgin Bakır", "bilgin-bakir.jpg", "bilginbakir.com.tr", "Dudullu OSB'de bakır ve metal tedariki yapan sanayi firmasının kimliğini ve dijital vitrinini kurguladık."], ["100BURGER", "100burger.jpg", "100burger.com", "Dijital sipariş, QR menü ve müşteri deneyimini aynı marka dilinde buluşturan uçtan uca bir dijital deneyim kurguladık."], ["RegeditPOS", "regeditpos.jpg", "regeditpos.com", "Restoranların satıştan operasyona tüm süreçlerini yönettiği platformun yazılım mimarisini ve arayüzlerini geliştirdik."], ["DOYUYO!", "doyuyo.jpg", "doyuyo.com", "Çıtır tavuk odaklı fast-casual restoran zincirinin dijital varlığını ve büyümesini birlikte şekillendiriyoruz."]].map(([n, f, u, d]) => `<figure><div class="wk-bar"><i></i><i></i><i></i><span>${u}</span></div><div class="wk-img"><img src="/demo-assets/work/${f}?v=2" alt="${n}" loading="lazy"></div><figcaption><b>${n}</b><span>${d}</span></figcaption></figure>`).join("")}</div>
  <div class="logos wl">${[["DOYUYO!", "doyuyo.svg"], ["100BURGER", "100burger.png"], ["Köfteci Yusuf", "kofteci-yusuf.png"], ["Bilgin Bakır", "bilgin-bakir.png"], ["Paravan", "paravan.png"], ["RegeditPOS", "regeditpos.png"]].map(([n, f]) => `<img src="/demo-assets/clients/${f}" alt="${n}" loading="lazy">`).join("")}</div>
</div></section>

<section id="google" class="sec alt" data-sec="google"><div class="w">
  <div class="sh"><span class="n">03</span><div><h2>Google'da böyle görüneceksiniz</h2><p>"${esc(query)}" araması için örnek görünüm. Sıralama söz konusu değildir; sitenizin arama sonucundaki görünümünü gösterir.</p></div></div>
  <div class="g2"><div class="serp">
    <div class="sbar"><span class="gl">G</span><span>${esc(query)}</span></div>
    <div class="res"><div class="u"><span class="fav" style="background:${esc(M.p)}">${esc(L.name[0])}</span><div><b>${esc(L.name)}</b><small>https://www.${esc(dom)}</small></div></div>
      <a class="t">${esc(L.name)} | ${esc(M.S.label)} ${esc(L.district || "")}</a>
      ${L.rating && L.reviews ? `<div class="rt"><span>${esc(L.rating)}</span> <i>${star(L.rating)}</i> ${L.reviews ? `(${esc(L.reviews)})` : ""}</div>` : ""}
      <p>${esc((d.sub || d.tagline || "").slice(0, 155))}</p>
      <div class="sl">${pages.slice(1, 5).map(([, t]) => `<span>${esc(t)}</span>`).join("")}</div></div>
  </div>
  <div class="maps"><div class="mimg">${M.images[0] ? `<img src="${esc(M.images[0])}" alt="">` : `<div class="mph" style="background:${esc(M.p)}">${esc(L.name[0])}</div>`}</div>
    <div class="mb"><b>${esc(L.name)}</b>${L.rating && L.reviews ? `<div class="rt"><span>${esc(L.rating)}</span> <i>${star(L.rating)}</i> ${L.reviews ? `(${esc(L.reviews)})` : ""}</div>` : ""}<small>${esc(M.S.label)} · ${esc(L.district || "İstanbul")}</small>
      <div class="mbtn"><span>Web sitesi</span><span>Yol tarifi</span><span>Ara</span></div>
      <div class="mrow">📍 ${esc(d.address || M.place)}</div>${M.phoneTxt ? `<div class="mrow">☎ ${esc(M.phoneTxt)}</div>` : ""}<div class="mrow">🌐 ${esc(dom)}</div></div></div></div>
</div></section>

<section id="reklam" class="sec alt" data-sec="reklam"><div class="w">
  <div class="sh"><span class="n">04</span><div><h2>Google reklamlarınız</h2><p>"${esc(query)}" ve benzeri aramalarda gösterilecek örnek reklam metinleri.</p></div></div>
  <div class="ads">${ads.map((a) => `<div class="ad"><small><b>Sponsorlu</b> · www.${esc(dom)}</small><a>${esc(a.h1)} | ${esc(a.h2)} | ${esc(a.h3)}</a><p>${esc(String(a.d).slice(0, 150))}</p></div>`).join("")}</div>
  <div class="kws"><b>Hedef aramalar:</b> ${[query, `${kw} ${L.district || ""}`.trim(), ...M.services.slice(0, 3).map((s) => `${L.district || "İstanbul"} ${s.t.toLocaleLowerCase("tr")}`), `en yakın ${kw}`.trim()].filter((x, i, a) => x && a.indexOf(x) === i).map((x) => `<span>${esc(x)}</span>`).join("")}</div>
</div></section>

<section id="sosyal" class="sec" data-sec="sosyal"><div class="w">
  <div class="sh"><span class="n">05</span><div><h2>Instagram için örnek tasarımlar</h2><p>Markanızın renkleri ve fotoğraflarıyla hazırlanmış örnek tasarımlar.</p></div></div>
  <div class="igwrap"><div class="igp">
    <div class="igh"><div class="iga"><span>${M.logo ? `<img src="${esc(M.logo)}" alt="">` : esc(L.name.split(/\s+/).slice(0,2).map((w)=>w[0]).join("").toLocaleUpperCase("tr"))}</span></div>
      <div class="igm"><div class="igu"><b>${esc(L.instagram ? String(L.instagram).replace(/^@/, "") : ascii(L.name))}</b><span class="igb">Takip et</span><span class="igb g">Mesaj</span></div>
      <div class="igs"><span><b>${posts.length}</b> gönderi</span></div>
      <div class="igbio"><b>${esc(L.name)}</b><span>${esc(M.S.label)}</span><p>${esc(d.tagline || d.sub || "")}</p><p>📍 ${esc(L.district || "İstanbul")}${M.phoneTxt ? " · ☎ " + esc(M.phoneTxt) : ""}</p><a>www.${esc(dom)}</a></div></div></div>
    <div class="igtabs"><span class="on">▦ Gönderiler</span><span>▶ Reels</span><span>◫ Etiketlenenler</span></div>
    <div class="ig">${posts.map((p, i) => `<div class="post ${p.img ? "ph" : "col"} v${i % 3} k${i}">${p.img ? `<img src="${esc(p.img)}" alt="">` : `<div class="art">${glyph(sk)}</div>`}${i === 3 ? '<span class="multi">▣</span>' : ""}<div class="pov"><span>${esc(p.k)}</span><b>${esc(p.h)}</b>${p.t ? `<small>${esc(String(p.t).slice(0, 80))}</small>` : ""}</div></div>`).join("")}</div>
  </div>
  <div class="igpost"><div class="iph"><div class="iga sm"><span>${M.logo ? `<img src="${esc(M.logo)}" alt="">` : esc(L.name[0])}</span></div><b>${esc(L.instagram ? String(L.instagram).replace(/^@/, "") : ascii(L.name))}</b><span class="m">${esc(L.district || "İstanbul")}</span></div>
    <div class="post big ${posts[0].img ? "ph" : "col"} v0">${posts[0].img ? `<img src="${esc(posts[0].img)}" alt="">` : `<div class="art">${glyph(sk)}</div>`}<div class="pov"><span>${esc(posts[0].k)}</span><b>${esc(posts[0].h)}</b></div></div>
    <div class="ipa"><span>♡</span><span>💬</span><span>➤</span><span class="r">⌑</span></div>
    <div class="ipc"><b>${esc(L.instagram ? String(L.instagram).replace(/^@/, "") : ascii(L.name))}</b> ${esc((d.sub || d.tagline || "").slice(0, 140))} <span class="hs">#${esc(ascii(L.district || "istanbul"))} #${esc(ascii(kw || "istanbul"))} #${esc(ascii(L.name.split(/\s+/)[0]))}</span></div>
    <div class="ipt">Önizleme · Örnek içerik</div></div></div>
</div></section>

<section id="paketler" class="sec alt" data-sec="paketler"><div class="w">
  <div class="sh"><span class="n">06</span><div><h2>Hizmetler ve ödeme</h2><p>Ne yaptığımız ve nasıl ödediğiniz, açık ve basit.</p></div></div>
  <div class="offer"><b>Size özel teklif:</b> 6 ay Dijital Büyüme paketine Başlangıç web sitesi hediye. ${until ? `Bu teklif <u>${until}</u> tarihine kadar geçerlidir.` : "Bu teklif, sunumu ilk açtığınız günden itibaren 14 gün geçerlidir."}</div>
  ${[...new Set(packages.map((p) => p.g || ""))].map((g) => `${g ? `<h3 class="pkg">${esc(g)}</h3>` : ""}<div class="pk">${packages.filter((p) => (p.g || "") === g).map((p) => `<div class="p${p.star ? " star" : ""}">${p.star ? `<span class="kind">Önerilen</span>` : ""}<h3>${esc(p.name)}</h3>${p.price ? `<div class="pr">${esc(p.price)}${p.period ? ` <small>${esc(p.period)}</small>` : ""}</div>` : `<div class="pr sm">Fiyat görüşmede</div>`}${p.desc ? `<p>${esc(p.desc)}</p>` : ""}${(p.items || []).length ? `<ul>${p.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`).join("")}</div>`).join("")}
  <div class="how"><h3>Ödeme nasıl işler?</h3><div class="hg">${how.map(([t, x], i) => `<div><span>${i + 1}</span><b>${esc(t)}</b><p>${esc(x)}</p></div>`).join("")}</div></div>
</div></section>

<section class="final" data-sec="onay"><div class="w"><h2>${esc(L.name)} için başlayalım mı?</h2><p>Onay verin, 15 dakikalık görüşmede detayları netleştirelim.</p>
  <div class="btns"><a class="b1" href="/teklif?lead=${esc(L.id)}">Bu öneriyi onaylıyorum</a><a class="b2" href="#paketler">Hizmetlere tekrar bak</a></div></div></section>
<footer><div class="w"><img src="/brand/logo-wordmark-on-dark.png" alt="istanbul.marketing" height="18"><span>Bu sayfa ${esc(L.name)} için özel olarak hazırlanmıştır. · business@istanbul.marketing</span></div></footer>
<script type="application/json" id="site-data">${JSON.stringify({ lead: L.id, page: "sunum", track: !preview }).replace(/</g, "\\u003c")}</script>
<script src="/demo-assets/sunum.js?v=8" defer></script>
</body></html>`;
}
