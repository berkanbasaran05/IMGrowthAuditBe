// Elle eklenen firmalar için satış metinleri. panel/outreach_v3.py ile aynı kurgu ve metinler;
// fark: doğrulanmış bulgu (obs/impact) yoksa yalnızca girilen bilgilere dayanan genel şablon üretilir.
const SIGN = "Saygılarımızla,";
const OPTOUT = 'Bu konu şu an gündeminizde değilse "teşekkürler" yazmanız yeterli; bir daha rahatsız etmeyiz.';
const BASE = "https://customer.istanbul.marketing/sunum/";
const PROJECTS = "www.istanbul.marketing/projects";

export function buildOutreach(lead) {
  const name = lead.name, id = lead.id;
  const loc = lead.district || lead.city || "";
  const kw = String(lead.sector || "").toLowerCase().split("/")[0].split("(")[0].trim() || "işletme";
  const url = BASE + id;
  const obs = lead.obs || "", impact = lead.impact || "";
  const search = `"${[loc, kw].filter(Boolean).join(" ")}"`;
  const webSentence = {
    yok: `Bugün ${search} diye arama yapan biri, sizi tanımıyorsa karşısına çıkan ilk sitelere yöneliyor; sizin kapınıza kadar gelmesi için ona bir adres gerekiyor.`,
    zayif: `Bugün ${search} diye arama yapan biri kararını çoğu zaman ilk birkaç saniyede, telefonundan ve gördüğü siteye bakarak veriyor.`,
  }[lead.websiteStatus] || "Müşterilerinizin sizi internette nasıl gördüğü, sizi seçip seçmemelerinde giderek daha belirleyici oluyor.";

  const inside = [
    `• ${name} için bugünkü dijital görünümünüz ve kaçan fırsatlar`,
    `• ${search} aramasında Google'da ve Haritalar'da nasıl öne çıkabileceğiniz`,
    "• Size özel örnek Google reklam metinleri ve Instagram tasarımları",
    "• Adım adım nasıl ilerleyeceğimiz",
  ];
  const join = (a) => a.filter(Boolean).join("\n\n");
  const subject = `${name} İle İş Birliği`;
  const body = join([
    `Merhaba ${name} ekibi,`,
    obs ? `${obs} ${impact}`.trim() : webSentence,
    `Bu doğrultuda, dijital görünümünüzü ve büyüme potansiyelinizi değerlendiren, markanıza özel bir çalışma hazırladık. Sunumu buradan inceleyebilirsiniz:\n${url}`,
    "İçinde şunları bulacaksınız:\n" + inside.join("\n"),
    "Kısaca ne yaptığımız: web sitenizi sıfırdan isteğinize göre kuruyor ya da yeniliyoruz (tek seferlik, 15.000 TL'den başlayan paketler); Google reklamlarınızı ve Instagram hesabınızı ise aylık yönetiyoruz (hizmet başına 10.000 TL, ikisi birlikte 18.000 TL). Fiyatlara fatura ve KDV dahildir; hizmetleri ayrı ayrı da alabilirsiniz. Ayrıca isteğinize özel mobil uygulama ve yazılım da geliştiriyoruz; bunların fiyatını görüşmede birlikte belirliyor, tamamlanan işi size devrediyoruz.",
    "Göz atmanız birkaç dakikanızı alır ve hiçbir yükümlülüğü yoktur. Beğendiğiniz ya da değiştirmek istediğiniz bir yer olursa bu maile yanıt vermeniz yeterli; uygun olursanız 15 dakikalık kısa bir görüşmede birlikte üzerinden geçebiliriz.",
    OPTOUT,
    SIGN,
  ]);
  const fu1 = join([
    `Merhaba ${name} ekibi,`,
    "Geçen hafta sizin için hazırladığımız sunumu paylaşmıştık. Yoğunluktan gözden kaçmış olabilir diye kısa bir hatırlatma yapmak istedik.",
    `Sunumda ${name} için Google aramalarında nasıl görünebileceğinizi, örnek reklam metinlerini ve Instagram tasarımlarını hazırladık. Birkaç dakikanızı ayırırsanız sevineceğiz.`,
    `Sunumunuz: ${url}`,
    "Web sitesi, reklam ya da Instagram tarafında aklınıza takılan bir şey olursa bu maile yanıt vermeniz yeterli.",
    SIGN,
  ]);
  const fu2 = join([
    `Merhaba ${name} ekibi,`,
    "Nasıl çalıştığımızı en sade haliyle paylaşmak istedik:",
    [
      "• Web sitesi (tek seferlik): Başlangıç 15.000 TL (1–3 sayfa), Kurumsal 35.000 TL (çok sayfalı, blog, SEO altyapısı), Özel / E-ticaret 60.000 TL'den başlayan. Hosting sunucusu için aylık küçük bir ücret ayrıca ödenir.",
      "• Aylık yönetim: Google Reklam 10.000 TL, Instagram 10.000 TL, ikisi birlikte Dijital Büyüme 18.000 TL. Reklamlar her ay analiz edilip iyileştirilir, gelen potansiyel müşteriler takip edilir, web sitenizin bakımı yapılır. Reels çekimi 3.000 TL'den başlar.\n• Dijital Büyüme'yi 6 ay alan işletmelere Başlangıç web sitesi ücretsizdir.",
    ].join("\n"),
    "Reklam bütçesi ayrıdır ve sizindir: Google'a giden harcamayı (günlük 200 TL'den başlanabilir) siz belirlersiniz. Kendi adınıza açtığınız bir sanal karta bakiye yüklersiniz, reklamlar doğrudan bu karttan ödenir; bize ödenen aylık ücretle karışmaz. Tüm fiyatlara fatura ve KDV dahildir. Hizmetleri ayrı ayrı da alabilirsiniz; yalnızca site ya da yalnızca aylık paket gibi.",
    `DOYUYO!, 100BURGER ve Köfteci Yusuf gibi markalarla çalışıyoruz; işlerimize buradan bakabilirsiniz: ${PROJECTS}`,
    `Sunumunuz hâlâ burada duruyor: ${url}\nUygun bir gün ve saat yazarsanız görüşmeyi ona göre planlarız.`,
    SIGN,
  ]);
  const fu3 = join([
    `Merhaba ${name} ekibi,`,
    "Birkaç kez yazdık; şu an önceliğiniz olmayabilir ve bunu anlıyoruz. Bu konudaki son mailimiz bu.",
    `Hazırladığımız sunum bir süre daha açık kalacak; ileride ihtiyaç duyarsanız buradan ulaşabilirsiniz: ${url}`,
    `${name} için bol kazançlı günler dileriz.`,
    SIGN,
  ]);
  const dmFind = obs ? obs.replace(/\.$/, "") + "." : webSentence;
  const dm = join([
    `Merhaba ${name} ekibi,`,
    lead.city === "İstanbul"
      ? `istanbul.marketing olarak İstanbul'daki işletmelerin dijitalde büyümesine destek oluyoruz. ${dmFind}`
      : `istanbul.marketing olarak işletmelerin dijitalde büyümesine destek oluyoruz. ${dmFind}`,
    `Bu doğrultuda, dijital görünümünüzü ve büyüme potansiyelinizi değerlendiren, markanıza özel bir çalışma hazırladık:\n${url}`,
    "Kısaca neler sunuyoruz:\n• Web sitesi: sıfırdan isteğinize göre kurulum ya da yenileme (tek seferlik, 15.000 TL'den başlayan paketler)\n• Dijital Büyüme: Google reklam + Instagram yönetimi, aylık analiz ve site bakımı (aylık 18.000 TL; 6 ay alana site hediye)\nFiyatlara fatura ve KDV dahildir.\nHizmetleri ayrı ayrı da alabilirsiniz.",
    "Göz atmanız birkaç dakika sürer, hiçbir yükümlülüğü yoktur. Uygun olursanız 15 dakikalık kısa bir görüşmede birlikte üzerinden geçebiliriz.",
  ]);
  const call = [
    `Açılış: "Merhaba, istanbul.marketing'den arıyorum. ${name} ile mi görüşüyorum? Sizi bir dakikadan fazla tutmayacağım."`,
    'Neden arıyorum: "Dijital görünümünüzü ve büyüme potansiyelinizi değerlendiren, markanıza özel bir çalışma hazırladık; sizin fikrinizi almak istedik."',
    obs ? `Bulgu: ${obs}` : "",
    impact ? `Etki: ${impact}` : "",
    'Küçük adım: "Linki WhatsApp\'tan göndermemi ister misiniz? Müsait olduğunuzda bakarsınız."',
    'Ne yaptığımız (tek cümle): "Sitenizi bir kez ücretle kuruyor ya da yeniliyoruz, 15 binden başlayan paketlerle. Google reklamlarınızı ya da Instagram\'ınızı aylık 10 bine, ikisini birlikte 18 bine yönetiyoruz; 6 ay alana site hediye. Fatura ve KDV dahil; isterseniz sadece birini alabilirsiniz."',
    "Soru 'reklam parası size mi ödeniyor?': \"Hayır. Reklam bütçesini siz belirlersiniz, günlük 200 TL'den başlayabilirsiniz. Kendi adınıza bir sanal kart açıp bakiye yüklersiniz, Google bu karttan çeker. Bize ödediğiniz yalnızca aylık yönetim ücreti. Bu ücretle her ay reklamları analiz ediyor, iyileştiriyor, gelen potansiyel müşterileri takip ediyor ve sitenizin bakımını yapıyoruz.\"",
    "İtiraz 'bütçe yok': \"Anlıyorum; zaten şu an bir şey satın almanızı istemiyoruz, sadece hazırladığımız şeye göz atmanızı rica ediyoruz.\"",
    "İtiraz 'Instagram yetiyor': \"Instagram çok değerli; site ise sizi henüz tanımayan ve Google'da arayan müşteriler için. Sunumda ikisinin birlikte nasıl çalıştığını gösterdik.\"",
    'Kapanış: "Göz attıktan sonra 15 dakikalık kısa bir görüşme için size hangi gün uygun olur?"',
  ].filter(Boolean).join("\n");
  return {
    subject, body,
    followups: [
      { day: 3, subject: `Re: ${subject}`, body: fu1 },
      { day: 7, subject: `Re: ${subject}`, body: fu2 },
      { day: 14, subject: `Re: ${subject}`, body: fu3 },
    ],
    dm, call, version: 3,
  };
}
