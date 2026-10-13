// Sektör içerik kütüphanesi: firmaya özel iddia içermeyen, genel bilgilendirici yazılar ve SSS.
// Bir kez yazılır, aynı sektördeki tüm demolarda firma adı ve semtle kişiselleştirilerek kullanılır.
// {n}: firma adı, {d}: semt (ilçe)

export const ARTICLES = {
  veteriner: [
    { slug: "yavru-kedi-ve-kopeklerde-asi-takvimi", t: "Yavru kedi ve köpeklerde aşı takvimi nasıl planlanır?", cat: "Koruyucu hekimlik", min: 4,
      d: "İlk aşılar, tekrar dozları ve iç-dış parazit uygulamalarını hangi sırayla planlamanız gerektiğini özetledik.",
      body: [
        "Yavru bir kedi ya da köpeği evinize aldığınızda ilk yapmanız gereken, genel sağlık kontrolü için bir veteriner hekime başvurmaktır. Aşı takvimi; hayvanın yaşına, sağlık durumuna, yaşam koşullarına ve daha önce yapılmış uygulamalara göre hekim tarafından kişiselleştirilir.",
        "## İlk muayenede neler yapılır?",
        "İlk muayenede genel fiziksel kontrol yapılır, kilo ölçülür ve iç-dış parazit durumu değerlendirilir. Aşılara başlamadan önce parazit uygulamalarının tamamlanması çoğu zaman önerilir; çünkü bağışıklık sisteminin aşıya iyi yanıt verebilmesi için hayvanın genel durumunun iyi olması gerekir.",
        "## Karma aşılar ve tekrar dozları",
        "Yavru dönemde karma aşılar genellikle birkaç hafta arayla tekrarlanan dozlar halinde yapılır. Kuduz aşısı yasal olarak da takip edilen bir aşıdır. Hangi aşının hangi hafta yapılacağını, hayvanınızın durumuna göre hekiminiz belirler ve aşı karnesine işler.",
        "## Aşı sonrası nelere dikkat etmeli?",
        "Aşı sonrası hafif halsizlik veya iştahsızlık görülebilir. Yüzde şişlik, nefes darlığı, kusma gibi durumlar fark ederseniz vakit kaybetmeden kliniğinizi arayın. Aşı karnesini saklamak ve bir sonraki dozun tarihini not almak takibi kolaylaştırır.",
        "{n} olarak {d} ve çevresindeki hasta sahiplerine aşı takvimini birlikte planlamayı ve hatırlatmayı öneriyoruz. Randevu için bize ulaşabilirsiniz.",
      ] },
    { slug: "evcil-hayvanlarda-acil-durum-belirtileri", t: "Evcil hayvanlarda acil durum belirtileri: Ne zaman hemen aramalısınız?", cat: "Acil durumlar", min: 3,
      d: "Beklemeden veteriner hekime ulaşmanız gereken belirtileri ve bu sırada yapabileceklerinizi derledik.",
      body: [
        "Evcil dostlarımız ağrılarını ve rahatsızlıklarını her zaman açıkça gösteremez. Bazı belirtiler ise zaman kaybetmeden müdahale gerektirir.",
        "## Hemen aramanız gereken durumlar",
        "Nefes almada zorlanma, bilinç kaybı ya da nöbet, durdurulamayan kanama, tekrarlayan kusma veya ishal, zehirli bir madde yuttuğundan şüphelenme, idrar yapamama (özellikle erkek kedilerde), şiddetli karın şişliği ve travma sonrası ani değişiklikler acil durum sayılır.",
        "## Kliniğe ulaşırken",
        "Sakin kalmaya çalışın ve önce kliniği arayarak durumu anlatın; böylece ekip gelişinize hazırlanabilir. Yutulan bir madde varsa ambalajını yanınıza alın. Kendi başınıza ilaç vermeyin; insan ilaçlarının birçoğu hayvanlar için tehlikelidir.",
        "## Önleyici adımlar",
        "Evdeki temizlik ürünlerini, ilaçları ve bazı bitkileri ulaşamayacakları yerde saklamak, düzenli kontrolleri aksatmamak birçok acil durumun önüne geçer.",
        "{n} ile {d}'de her zaman kolayca iletişime geçebilirsiniz; telefonla arayarak durumu anlatmanız yeterli.",
      ] },
    { slug: "kisirlastirma-hakkinda-merak-edilenler", t: "Kısırlaştırma hakkında merak edilenler", cat: "Cerrahi", min: 4,
      d: "Kısırlaştırmanın faydaları, uygun zamanlama ve operasyon sonrası bakım hakkında temel bilgiler.",
      body: [
        "Kısırlaştırma, kedi ve köpeklerde istenmeyen yavrulamanın önlenmesinin yanı sıra bazı sağlık sorunlarının riskini azaltmak için de önerilen yaygın bir operasyondur.",
        "## Ne zaman yapılmalı?",
        "Uygun zamanlama türe, ırka, cinsiyete ve hayvanın genel sağlık durumuna göre değişir. Doğru zamanı belirlemek için operasyon öncesi muayene ve gerekli görülürse kan tahlilleri yapılır.",
        "## Operasyon öncesi hazırlık",
        "Genellikle operasyondan önce belirli bir süre aç bırakılması istenir. Hekiminizin verdiği açlık süresine ve talimatlara uymanız anestezi güvenliği açısından önemlidir.",
        "## Operasyon sonrası bakım",
        "Dikiş bölgesinin yalanmasını önlemek için koruyucu yaka ya da giysi kullanılabilir. Ağrı kesici ve diğer ilaçları hekiminizin önerdiği şekilde verin, dikiş kontrolüne zamanında gelin. Hareketi birkaç gün kısıtlamak iyileşmeyi destekler.",
        "Kısırlaştırma kararınız ve süreç hakkında sorularınız için {n} ekibiyle görüşebilirsiniz.",
      ] },
    { slug: "kedi-ve-kopeklerde-dis-sagligi", t: "Kedi ve köpeklerde ağız ve diş sağlığı", cat: "Bakım", min: 3,
      d: "Diş taşı, ağız kokusu ve evde yapılabilecek bakım önerileri.",
      body: [
        "Ağız ve diş sağlığı, evcil hayvanların genel sağlığıyla doğrudan ilişkilidir. Diş taşı ve diş eti iltihabı zamanla ağrıya ve iştah kaybına yol açabilir.",
        "## Dikkat edilmesi gereken belirtiler",
        "Belirgin ağız kokusu, diş etlerinde kızarıklık veya kanama, mama yerken zorlanma, bir tarafla çiğneme ve aşırı salya akıtma kontrol gerektiren belirtilerdir.",
        "## Evde bakım",
        "Hayvanlara özel diş macunu ve fırçasıyla düzenli fırçalama en etkili yöntemdir. Alıştırma süreci sabır ister; kısa ve ödüllendirilen seanslarla başlamak işe yarar. İnsan diş macunu kullanılmamalıdır.",
        "## Profesyonel kontrol",
        "Yıllık genel kontrollerde ağız muayenesi de yapılır; gerekli görülürse diş taşı temizliği planlanır.",
        "{n} olarak ağız ve diş kontrollerini rutin muayenelerin bir parçası olarak ele alıyoruz.",
      ] },
  ],
  guzellik: [
    { slug: "sac-rengini-uzun-sure-korumanin-yollari", t: "Saç rengini uzun süre korumanın yolları", cat: "Saç bakımı", min: 3,
      d: "Boya sonrası rengin canlılığını korumak için evde uygulayabileceğiniz basit alışkanlıklar.",
      body: ["Salondan yeni çıktığınız canlı rengi uzun süre korumak, doğru ürünler ve birkaç alışkanlıkla mümkün.", "## İlk yıkama", "Boyadan sonraki ilk yıkamayı birkaç gün geciktirmek, rengin saç teline yerleşmesine yardımcı olur.", "## Doğru ürünler", "Boyalı saçlar için üretilmiş, sülfatsız şampuan ve renk koruyucu bakım ürünleri rengin solmasını yavaşlatır. Çok sıcak su yerine ılık su tercih edin.", "## Isı ve güneş", "Fön ve maşa öncesi ısı koruyucu kullanın; yaz aylarında güneşe uzun süre maruz kalacaksanız saçınızı koruyun.", "{n} olarak {d}'de saçınıza en uygun bakım rutinini birlikte belirleyebiliriz."] },
    { slug: "yuz-sekline-gore-sac-kesimi", t: "Yüz şekline göre saç kesimi nasıl seçilir?", cat: "Stil", min: 3,
      d: "Oval, yuvarlak, kare ve kalp yüz tiplerine uygun kesim önerileri.",
      body: ["Doğru saç kesimi, yüz hatlarınızı dengeleyerek en iyi yanınızı öne çıkarır.", "## Yüz şeklinizi belirleyin", "Saçınızı geriye toplayıp aynaya baktığınızda alın, elmacık kemikleri ve çene hattının genişliğini karşılaştırın.", "## Genel öneriler", "Yuvarlak yüzlerde boy katan katlı kesimler, kare yüzlerde hatları yumuşatan dalgalar, kalp yüzlerde çene hizasında hacim veren kesimler sık tercih edilir. Oval yüzler ise birçok kesimi rahatça taşıyabilir.", "## En doğrusu: danışmak", "Saç yapınız, yaşam tarzınız ve bakım alışkanlıklarınız da seçimi etkiler. Kesim öncesi kısa bir danışma en iyi sonucu verir.", "{n} ekibi, kesim öncesinde tarzınızı birlikte konuşmayı öneriyor."] },
    { slug: "ozel-gun-oncesi-hazirlik-rehberi", t: "Özel gün öncesi hazırlık rehberi", cat: "Özel gün", min: 3,
      d: "Düğün, nişan ve davetler öncesi saç ve bakım planını ne zaman yapmalısınız?",
      body: ["Özel günlerde stresi azaltmanın yolu iyi bir plan yapmaktır.", "## Birkaç hafta önce", "Saç bakımı ve renk işlemlerini özel günden birkaç hafta önce planlayın; böylece gerekirse düzeltme için zaman kalır.", "## Prova", "Gelin başı gibi özel modellerde prova yapmak, gün geldiğinde sürpriz yaşamamanızı sağlar. Fotoğraflarla örnek göstermek iletişimi kolaylaştırır.", "## Randevu", "Yoğun sezonlarda randevuları erken almak önemlidir.", "{n} ile {d}'de özel gününüz için randevunuzu erkenden planlayabilirsiniz."] },
  ],
  pastane: [
    { slug: "ozel-gun-pastasi-siparis-rehberi", t: "Özel gün pastası sipariş ederken nelere dikkat etmeli?", cat: "Sipariş", min: 3,
      d: "Kişi sayısı, tasarım, teslim zamanı ve saklama koşulları hakkında pratik bilgiler.",
      body: ["Doğum günü, nişan ya da kutlamalar için pasta siparişi verirken birkaç detayı önceden netleştirmek işinizi kolaylaştırır.", "## Kişi sayısı ve boyut", "Misafir sayısını bildirmeniz, doğru boyutta pasta hazırlanmasını sağlar.", "## Tasarım ve içerik", "Tema, renk ve yazı isteklerinizi örnek görsellerle paylaşmanız beklentinin doğru anlaşılmasına yardımcı olur. Alerjen içerikleri mutlaka belirtin.", "## Zamanlama", "Özel tasarım pastalar için siparişi birkaç gün önceden vermek en sağlıklısıdır.", "## Saklama", "Kremalı pastaları teslim aldıktan sonra buzdolabında saklayın ve servis öncesi kısa süre oda sıcaklığında bekletin.", "{n} olarak {d}'de siparişinizi telefon ya da WhatsApp'tan kolayca alıyoruz."] },
    { slug: "tatlilari-taze-saklamanin-puf-noktalari", t: "Tatlıları taze saklamanın püf noktaları", cat: "Saklama", min: 2,
      d: "Kremalı, şerbetli ve kuru pastane ürünlerini doğru saklama önerileri.",
      body: ["Her pastane ürününün saklama koşulu farklıdır.", "## Kremalı ürünler", "Buzdolabında, kapalı kapta saklanmalı ve kısa sürede tüketilmelidir.", "## Şerbetli tatlılar", "Oda sıcaklığında, üzeri kapalı şekilde saklanabilir; sıcak havalarda serin bir yer tercih edin.", "## Kuru pasta ve kurabiyeler", "Hava almayan kaplarda nemden uzak saklandığında daha uzun süre lezzetini korur.", "Sorularınız için {n} ekibine her zaman danışabilirsiniz."] },
    { slug: "ofis-ve-etkinlikler-icin-toplu-siparis", t: "Ofis ve etkinlikler için toplu sipariş", cat: "Kurumsal", min: 2,
      d: "Toplantı, açılış ve kutlamalarda toplu siparişi planlamanın kolay yolu.",
      body: ["Ofis kutlamaları, toplantılar ve açılışlar için toplu sipariş planlarken kişi sayısı, teslim saati ve ürün çeşitliliği en önemli üç konudur.", "## Önceden planlayın", "Tarih ve saati önceden bildirmeniz, ürünlerin taze hazırlanmasını sağlar.", "## Çeşitlilik", "Farklı damak zevklerine uygun tatlı ve tuzlu seçenekleri birlikte planlayabiliriz.", "{n} ile {d} ve çevresindeki etkinlikleriniz için sipariş planlayabilirsiniz."] },
  ],
  nakliyat: [
    { slug: "tasinma-oncesi-kontrol-listesi", t: "Taşınma öncesi kontrol listesi", cat: "Planlama", min: 4,
      d: "Taşınmadan birkaç hafta önce başlayıp taşınma gününe kadar yapmanız gerekenler.",
      body: ["İyi planlanmış bir taşınma, hem zamandan hem de gereksiz stresten tasarruf sağlar.", "## Birkaç hafta önce", "Ekspertiz randevusu alın, taşınma tarihini netleştirin ve kullanmadığınız eşyaları ayıklayın. Bağış ya da satış için ayrılacak eşyaları belirlemek taşıma hacmini azaltır.", "## Abonelikler", "Elektrik, su, doğalgaz ve internet aboneliklerinin nakil veya iptal işlemlerini önceden başlatın.", "## Paketleme", "Kırılacak eşyaları ayrı işaretleyin; her koliye içindekileri ve gideceği odayı yazın.", "## Taşınma günü", "Değerli eşyalarınızı ve önemli belgelerinizi yanınızda taşıyın. Eski evden çıkmadan önce son bir kontrol yapın.", "{n} ekibi {d} ve tüm İstanbul'da taşınma planınızı birlikte yapmaya hazır."] },
    { slug: "esya-sigortasi-neden-onemli", t: "Taşımada eşya sigortası neden önemli?", cat: "Güvence", min: 3,
      d: "Taşıma sırasında oluşabilecek risklere karşı sigortanın sağladığı güvence.",
      body: ["Taşıma sürecinde en özenli ekiple çalışsanız bile beklenmedik durumlar yaşanabilir.", "## Sigorta ne sağlar?", "Taşıma sigortası, poliçede belirtilen durumlarda eşyalarda oluşabilecek hasarlara karşı güvence sağlar.", "## Nelere dikkat etmeli?", "Sözleşmede sigorta kapsamını, değer beyanını ve hasar durumunda izlenecek adımları okuyun. Değerli eşyalarınızı önceden belirtin.", "Taşıma ve sigorta konusundaki sorularınız için {n} ile görüşebilirsiniz."] },
    { slug: "sehirlerarasi-tasimada-planlama", t: "Şehirlerarası taşımada planlama", cat: "Şehirlerarası", min: 3,
      d: "Uzun mesafe taşımalarda tarih, rota ve teslim sürecini planlamanın yolları.",
      body: ["Şehirlerarası taşımada zamanlama ve iletişim, şehir içi taşımaya göre daha da önemlidir.", "## Tarih ve teslim penceresi", "Yükleme ve teslim tarihlerini netleştirin; yeni adresinizde eşyaları teslim alacak birinin bulunmasını planlayın.", "## Envanter", "Taşınacak eşyaların listesini çıkarmak, teslimde kontrolü kolaylaştırır.", "{n} ile {d}'den Türkiye'nin her yerine taşınmanızı planlayabilirsiniz."] },
  ],
  genel: [
    { slug: "bize-nasil-ulasabilirsiniz", t: "Bize nasıl ulaşabilirsiniz?", cat: "Rehber", min: 2,
      d: "Telefon, WhatsApp ve ziyaret seçenekleri hakkında kısa bilgi.",
      body: ["{n} olarak size en hızlı şekilde dönüş yapmak için birden fazla iletişim kanalı sunuyoruz.", "## Telefon ve WhatsApp", "Çalışma saatlerimizde telefonla ulaşabilir, WhatsApp üzerinden mesaj bırakabilirsiniz.", "## Ziyaret", "{d}'deki adresimize yol tarifi için harita bağlantısını kullanabilirsiniz."] },
  ],
};

// Sektöre göre kategorili SSS (firmaya özel SSS varsa önce onlar gösterilir)
export const FAQ_GROUPS = {
  veteriner: [["Randevu ve ziyaret", [["Randevu almam gerekiyor mu?", "Randevulu gelmeniz bekleme süresini kısaltır. Telefon ya da WhatsApp ile hızlıca randevu alabilirsiniz."], ["İlk ziyarette yanıma ne almalıyım?", "Varsa aşı karnesi, önceki tahlil sonuçları ve kullandığı ilaçların listesi muayeneyi kolaylaştırır."]]],
    ["Aşı ve koruyucu hekimlik", [["Aşı takvimini siz mi takip ediyorsunuz?", "Aşı ve kontrol zamanlarını sizin için planlayıp hatırlatabiliriz."], ["Parazit uygulamaları ne sıklıkla yapılmalı?", "Sıklık; yaşam koşullarına ve kullanılan ürüne göre değişir, muayenede birlikte planlanır."]]],
    ["Acil durumlar", [["Acil durumda ne yapmalıyım?", "Önce telefonla ulaşın; durumu değerlendirip size en hızlı yolu söyleriz."]]]],
  guzellik: [["Randevu", [["Randevusuz gelebilir miyim?", "Uygunluk durumuna göre mümkün; beklememek için randevu almanızı öneririz."], ["Randevumu nasıl değiştirebilirim?", "Telefon ya da WhatsApp'tan yazmanız yeterli."]]], ["Hizmetler", [["Fiyat bilgisi alabilir miyim?", "Hizmete ve saç uzunluğuna göre değişir; WhatsApp'tan yazarsanız hemen bilgi verelim."]]]],
  pastane: [["Sipariş", [["Pasta siparişini ne kadar önce vermeliyim?", "Özel tasarım pastalar için birkaç gün önceden sipariş vermenizi öneririz."], ["Toplu sipariş alıyor musunuz?", "Evet, ofis ve etkinlikler için toplu sipariş alıyoruz."]]], ["Ürünler", [["Alerjen bilgisi alabilir miyim?", "Ürün içerikleri hakkında bilgi almak için bize yazabilirsiniz."]]]],
  nakliyat: [["Fiyat ve ekspertiz", [["Fiyat nasıl belirleniyor?", "Eşya miktarı, kat ve mesafeye göre; ekspertiz sonrası net fiyat verilir."], ["Ekspertiz ücretli mi?", "Ekspertiz koşullarını görüşme sırasında netleştiriyoruz."]]], ["Taşıma süreci", [["Paketleme yapıyor musunuz?", "Evet, istenirse paketleme ve kurulum ekibimiz tarafından yapılır."], ["Şehirlerarası taşıma yapıyor musunuz?", "Evet, planlı şehirlerarası taşıma yapıyoruz."]]]],
  genel: [["Genel", [["Nasıl ulaşabilirim?", "Telefonla arayabilir ya da WhatsApp'tan yazabilirsiniz."]]]],
};

export const LOCAL = {
  veteriner: (n, d) => ({ h: `${d}'de veteriner kliniği`, p: [`${d} ve çevresinde evcil dostları için güvenilir bir veteriner arıyorsanız ${n} olarak kapımız açık.`, `Muayene, aşı takibi ve tedavi süreçlerinde randevulu çalışarak bekleme süresini en aza indiriyoruz. Randevu için telefonla arayabilir ya da WhatsApp'tan yazabilirsiniz.`] }),
  guzellik: (n, d) => ({ h: `${d}'de kuaför ve güzellik salonu`, p: [`${d}'de size özel saç ve bakım deneyimi için ${n}'i ziyaret edin.`, `Randevunuzu birkaç saniyede WhatsApp'tan alabilirsiniz.`] }),
  pastane: (n, d) => ({ h: `${d}'de pastane`, p: [`${d}'de taze pastane ürünleri ve özel gün pastaları için ${n}.`, `Siparişlerinizi telefon ya da WhatsApp'tan kolayca verebilirsiniz.`] }),
  nakliyat: (n, d) => ({ h: `${d} evden eve nakliyat`, p: [`${d}'den İstanbul'un her yerine ve şehirlerarası taşımada ${n} yanınızda.`, `Ekspertiz ve net fiyat için bize ulaşın.`] }),
  genel: (n, d) => ({ h: `${d}'de ${n}`, p: [`${d} ve çevresinde hizmet veriyoruz.`] }),
};
