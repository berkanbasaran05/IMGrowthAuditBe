# Istanbul Marketing Intelligence Platform — Growth Audit™

Bu belge Faz 0 mimari değerlendirmesini ve Milestone 1 (Growth Audit Foundation) teslimini özetler.

## Faz 0 — Mevcut mimari

| Alan | Bulgu |
|---|---|
| Frontend | Next.js 15 / React 19 (`IMGrowthAuditFe`). Panel, `public/index.html` içinde tek dosyalık vanilla JS uygulamasıdır; `app/[[...path]]` bu statik sayfaları sunar. `app/crm` React ile yazılmış CRM ekranıdır. `/api`, `/demo`, `/sunum` istekleri `BACKEND_URL`'e yönlendirilir. |
| Backend | NestJS 11 (`IMGrowthAuditBe`). `GrowthController`, eski Vercel `api/*.js` işleyicilerini `api/:endpoint` yakalayıcısıyla sarar. `CrmController` ham SQL kullanır. |
| Veri | PostgreSQL + Prisma 7 (CRM tabloları). Firmalar (leads) Redis uyumluluk katmanı üzerinden `hash_values` tablosunda (`bucket = 'leads'`) JSON olarak tutulur; firma kimliği slug'dır (`^[a-z0-9-]{1,120}$`). |
| Kimlik doğrulama | Tek yönetici; HMAC imzalı `im_session` çerezi (`lib/auth.js`). Makine erişimi için `INGEST_TOKEN`. Rol veya kiracı (tenant) modeli yok. |
| Firma keşfi | `api/radar.js` (OpenStreetMap Nominatim + Overpass), `scripts/push.mjs` ile toplu aktarım. |
| Lead score | Radar'da kayıt bütünlüğüne göre 54–98 arası satış potansiyeli puanı. Growth Score'dan ayrı tutulur. |
| Google Ads | `api/ads.js` + `lib/adsform.js` (başlangıç formu, kampanya planı). Reklam hesabı entegrasyonu yok. |
| E-posta | `lib/mail.js` (nodemailer, SMTP), `api/send.js` (4 adımlı dizi, günlük limit, `MAIL_DRY_RUN`). |
| Aranacaklar | Firma kaydındaki `callList`, `callLog`, `callDay`, `callNote` alanları. |
| AI | Projede yapılandırılmış AI sağlayıcısı yoktu. Growth Audit için Anthropic Claude eklendi. |
| Arka plan işleri | Yoktu. Growth Audit için veritabanı destekli kuyruk eklendi. |
| PageSpeed | `api/tools.js` demo sayfaları için PSI kullanıyordu (`PSI_KEY`); aynı yaklaşım yeniden kullanıldı. |

### Yeniden kullanılanlar
`isAuthed`/oturum çerezi, `getOne("leads")` firma okuma, PrismaService, PSI_KEY, panelin tasarım tokenları (`--surface`, `--line`, `.card`, `.tabs`, `.tag`), mevcut toast ve detay çekmecesi.

### Eksik yetenekler (Milestone 2+)
Rol tabanlı yetki ve kiracı yalıtımı, müşteri portalı, entegrasyon OAuth akışları (Google Ads / GA4 / Search Console), şifreli token deposu, PDF üretimi, hız sınırlama, merkezi hata izleme.

## Milestone 1 — Teslim edilenler

### Akış
`POST /api/growth-audit/leads/:leadId` → kuyruk kaydı (`queued`) → işçi alır (`running`) → web sitesi doğrulama → robots.txt + site haritası → en fazla 6 sayfa tarama → Google Lighthouse (mobil + masaüstü) → 26 kural tabanlı metrik → AI analisti (7 öznel metrik + yönetici özeti) → Growth Score → fırsatlar → kayıt (`completed` / `no_verified_website` / `failed`).

### Growth Score™ (gs-1.0)
- 6 kategori: Marka %15, Deneyim %20, Teknoloji %15, Arama %20, Dönüşüm %20, Güven %10.
- 33 metrik (`src/modules/audit/metrics.ts`); her birinin kimliği, kategorisi, ağırlığı, yöntemi, rubriği, önerilen hizmeti, etki ve zorluk sınıfı vardır.
- Durumlar: `MEASURED`, `ESTIMATED`, `UNKNOWN`, `NOT_APPLICABLE`, `FAILED`. Yalnızca ilk ikisi puana girer; eksik veri sıfır sayılmaz.
- Kategori puanı = değerlendirilen metriklerin ağırlıklı ortalaması. Genel puan = puanlanan kategorilerin ağırlıklı ortalaması.
- Kapsam = değerlendirilen ağırlık / uygulanabilir ağırlık. Güven = metrik güveni × kapsam.
- Web sitesi yoksa ya da doğrulanamıyorsa durum `no_verified_website` olur; puan `null` kalır.

### AI Analisti (analyst-1.0)
- Model: `claude-haiku-5-5` (Claude Haiku 5.5; `AUDIT_AI_MODEL` ile değiştirilebilir). Fiyat 100K token altı istemde $0,10 giriş / $0,50 çıkış (1M token başına; `AUDIT_AI_PRICE_IN/OUT`). Haiku 5.5'te düşünme uyarlamalıdır, `effort` varsayılanı `medium`'dur, örnekleme parametreleri gönderilmez. Sunucu tarafı ret yedeği (`fallbacks: "default"`) Haiku'da yoktur; yalnızca Opus/Sonnet/Fable seçilirse gönderilir.
- Yalnızca taranan sayfalardan çıkarılmış yapılandırılmış veri gönderilir; ham HTML gönderilmez. Site içeriği `<website_content>` içinde güvenilmeyen veri olarak işaretlenir.
- Çıktı JSON şemasıyla sınırlanır ve zod ile yeniden doğrulanır. Kanıtı taranan bir URL'ye dayanmayan değerlendirme `FAILED` sayılır. Güven en fazla 0,9 olabilir.
- Teknik ölçümler AI'ya sorulmaz.
- Saklananlar: özgün puan, inceleyen puanı, nihai puan, inceleme gerekçesi, model sürümü, prompt sürümü, rubrik sürümü. Token kullanımı ve tahmini maliyet `growth_audits.usage` alanındadır.
- Müşteri verisi eğitim veya ince ayar için kullanılmaz.

### Fırsatlar
Puanı 70'in altında olan, kanıtı ve önerisi bulunan metriklerden üretilir. Öncelik şöyle hesaplanır:

`round(100 × (etki/5) × max(0,3; (100−puan)/100) × güven × (kolaylık/5))`

Gruplar: Kritik ≥45, Yüksek ≥25, Orta ≥10, aksi halde Düşük. Ölçülmüş bulgu "gözlenen", tahmini veya AI bulgusu "hipotez" olarak işaretlenir. Finansal etki hesaplanmaz.

### Güvenlik ve dayanıklılık
- **SSRF:** yalnızca http/https ve 80/443 portları kabul edilir. DNS çözümlenir; özel, yerel ve ayrılmış IPv4/IPv6 adresleri reddedilir. Yönlendirmeler elle izlenir ve her adım yeniden doğrulanır. Boyut (1,5 MB) ve süre (15 sn) sınırı vardır. DNS yeniden bağlama riskine karşı üretimde çıkış trafiğinin ağ katmanında da kısıtlanması önerilir.
- **robots.txt (RFC 9309):** kendi ajan grubumuz önceliklidir, en uzun kural geçerlidir. `Crawl-delay` uygulanır (en az 0,7 sn). Giriş, sepet ve yönetim sayfaları atlanır. CAPTCHA veya erişim kontrolü aşılmaz.
- **Kuyruk:** iş `FOR UPDATE SKIP LOCKED` ile alınır. Zaman aşımı 240 sn'dir. Geçici hatalarda en fazla 3 deneme yapılır; bekleme süresi 30 sn, 2 dk, 8 dk olarak artar. Açılışta yarım kalan işler kurtarılır.
- **Eşzamanlılık:** `growth_audits_one_active_per_lead` kısmi benzersiz indeksi, aynı firma için ikinci aktif denetimi veritabanı düzeyinde engeller (API 409 döner).
- **Panel:** taranan içerik her yerde HTML kaçışlıdır. Ekran görüntüsü yalnızca `data:image/` olarak gösterilir.

### API (panel oturumu gerekir)
| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/api/growth-audit/summary` | Firma başına son denetim özeti (liste rozetleri) |
| GET | `/api/growth-audit/definitions` | Puanlama sürümü, kategoriler, metrik ve rubrik kataloğu |
| GET | `/api/growth-audit/leads/:leadId` | Aktif denetim, son tam rapor, geçmiş |
| POST | `/api/growth-audit/leads/:leadId` | Denetim başlatır (202; aktif varsa 409) |
| GET | `/api/growth-audit/audits/:id` | Tam rapor (metrikler, kanıt, fırsatlar, incelemeler) |
| POST | `/api/growth-audit/audits/:id/metrics/:metricId/review` | `{ score: 0-100 \| null, reason }` ile puanı geçersiz kılar veya geçersiz kılmayı kaldırır; puanlar yeniden hesaplanır |

### Veritabanı
Migration: `prisma/migrations/20261013100000_growth_audit`. Tablolar: `growth_audits`, `audit_metric_results`, `audit_evidence`, `growth_opportunities`, `audit_reviews`. Durum, puan aralığı ve öncelik için CHECK kısıtları vardır. Mevcut tablolara ve firma kayıtlarına dokunulmaz.

### Ortam değişkenleri
`ANTHROPIC_API_KEY` (AI metrikleri), `PSI_KEY` (Lighthouse; anahtarsız kota hemen dolar), isteğe bağlı olarak `AUDIT_AI_MODEL`, `AUDIT_AI_DISABLED`, `AUDIT_WORKER`, `AUDIT_CONCURRENCY`, `AUDIT_TIMEOUT_MS`, `AUDIT_MAX_PAGES`, `AUDIT_AI_PRICE_IN/OUT`. Ayrıntılar `.env.example` içindedir.

### Elle doğrulama
1. `npm run db:migrate` ve ardından `npm run dev` (backend), frontend'de `npm run dev`.
2. Panelde web sitesi olan bir firmayı açın → **Growth Audit** sekmesi → **Growth Audit başlat**. İlerleme çubuğu canlı güncellenir.
3. Tamamlanınca gösterge, kapsam ve güven, kategori çubukları, radar grafiği, ilk 3 fırsat, metrik kanıtları, taranan sayfalar ve geçmiş görünür. Listede firma satırında `GS nn` rozeti çıkar.
4. Bir metriği açın → **Puanı incele / düzelt** → puan ve gerekçe girin. Genel puan yeniden hesaplanır, özgün puan korunur. Puan alanını boş bırakıp kaydederseniz geçersiz kılma kaldırılır.
5. Web sitesi olmayan bir firmada denetim "Doğrulanmış web sitesi yok" ile biter; puan üretilmez.

### Bilinen sınırlamalar
- `ANTHROPIC_API_KEY` yoksa 7 AI metriği `UNKNOWN` kalır ve yönetici özeti oluşmaz.
- `PSI_KEY` yoksa Lighthouse ölçümleri kota hatasıyla `UNKNOWN` kalır.
- CTA görünürlüğü ilk ekran konumuna göre değil, metin ve bağlantı varlığına göre tahmin edilir.
- JavaScript ile çizilen (SPA) sitelerde sunucu HTML'i sınırlı olabilir; tarayıcı tabanlı görüntüleme yoktur.

## Milestone 2 — Satış zekâsı

### Müşteri raporu (web + PDF)
- `src/modules/sales/report.model.ts` müşteriye gösterilebilir raporu üretir. İçeriği: marka, firma bilgisi, denetim tarihi, Growth Score, kapsam ve güven, kategori puanları, kanıtlı bulgular, güçlü yönler, öncelikli fırsatlar, önerilen hizmetler, 30/60/90 gün yol haritası ve sınırlamalar.
- Satış puanı, notlar, aşama, arama kayıtları, yetkili bilgisi ve inceleme gerekçeleri rapora girmez (testle doğrulanır). Gizlenen veya "yapıldı" işaretli fırsatlar da gösterilmez.
- Yol haritası: kolay işler ilk 30 güne, orta zorluktaki işler 31–60 güne, zor işler 61–90 güne düşer; her dönemde öncelik sırası korunur.
- Web raporu `report.html.ts` ile, PDF ise `report.pdf.ts` (pdfkit) ile üretilir. PDF'e Plus Jakarta Sans yazı tipi gömülür (OFL lisanslı, `@expo-google-fonts/plus-jakarta-sans`); logo `assets/brand/` altındadır.
- **Bağlantılar:** 256 bit rastgele belirteç kullanılır ve veritabanında yalnızca SHA-256 özeti tutulur. Bağlantı oluşturulduğu anda bir kez gösterilir. Süresi 1–90 gün arasıdır (varsayılan 30), istenirse iptal edilebilir. Görüntülenme sayısı ve son görüntülenme zamanı kaydedilir.
- Geçersiz, süresi dolmuş ve iptal edilmiş bağlantılar aynı 404 sayfasını döner.
- **Herkese açık uçlar:** `GET /r/:token` ve `GET /r/:token/pdf`. IP başına dakikada 30 istek sınırı vardır. Yanıtlar `noindex`, `no-referrer`, katı CSP ve `X-Frame-Options: DENY` başlıklarıyla döner. Next.js `/r/*` isteklerini backend'e yönlendirir.

### Kişiselleştirilmiş e-posta (Faz 6)
- `src/modules/sales/sales-ai.ts`: firma adı, sektör, kanıtlı fırsatlar (önce ölçülmüş olanlar), önerilen hizmetler ve iletişim geçmişi kullanılır.
- Üretilen taslak: konu, hitap, kişisel giriş, 2–3 gözlem, değer önerisi ve 15 dakikalık görüşme daveti.
- AI yapılandırılmışsa Claude kullanılır (`sales-1.0`). AI çıktısında, verilmeyen bir bulguya atıf yapan gözlem varsa ya da yasak bir ifade geçiyorsa (garanti, gelir kaybı, sektör ortalaması, "son fırsat" vb.) çıktı reddedilir ve şablona düşülür.
- AI yoksa kanıta dayalı şablon kullanılır.
- Taslak düzenlenebilir. **Hiçbir zaman otomatik gönderilmez.** "Hazır metne aktar" taslağı firmanın ilk e-posta metnine yazar; gönderim yine Gönderim ekranından, kullanıcı onayıyla ve günlük limitle yapılır.

### Arama brifi (Faz 7)
- İçerik: Growth Score özeti, en zayıf kategori, en fazla 3 doğrulanmış sorun, arama nedeni, önerilen hizmet, açılış cümlesi, önceki iletişim özeti (e-posta günlüğü, arama denemeleri, arama notu) ve aşamaya göre sonraki adım.
- AI'nın yeniden yazdığı brifte puan özeti ve iletişim geçmişi ölçülmüş kaynaktan korunur.
- Aranacaklar kartında açılır bölüm olarak görünür. Açılış cümlesi ve sonraki adım düzenlenebilir; mevcut not, arama günü ve sonuç akışı değişmedi.

### CRM entegrasyonu (Faz 5)
- Firma listesinde Growth Score rozeti ve audit durumu gösterilir. Açık fırsat sayısı rozetin ipucunda yer alır.
- Growth Score filtresi gruplar: 80+, 60–79, 40–59, <40, audit yok, doğrulanmış site yok. Ayrıca "Sırala: Growth Score" eklendi; satış puanı ayrı sıralama olarak kaldı.
- Fırsat durumu: açık / kabul edildi / devam ediyor / yapıldı / gizle. İnsan incelemesiyle puan yeniden hesaplanınca durumlar korunur.

### Yeni API uçları (panel oturumu gerekir)
| Yöntem | Yol | Açıklama |
|---|---|---|
| POST | `/api/growth-audit/audits/:id/reports` | `{ days }` ile güvenli bağlantı üretir (URL yalnızca bu yanıtta) |
| GET | `/api/growth-audit/leads/:leadId/reports` | Bağlantı listesi (durum, bitiş, görüntülenme) |
| POST | `/api/growth-audit/reports/:id/revoke` | Bağlantıyı iptal eder |
| GET | `/api/growth-audit/audits/:id/report.html` · `.pdf` | İç önizleme ve PDF indirme |
| POST | `/api/growth-audit/leads/:leadId/drafts/email` · `/drafts/call` | E-posta taslağı veya arama brifi üretir |
| GET | `/api/growth-audit/leads/:leadId/drafts` | Son taslaklar |
| GET | `/api/growth-audit/call-briefs` | Firma başına son arama brifi |
| PATCH | `/api/growth-audit/drafts/:id` | Taslağı düzenler |
| POST | `/api/growth-audit/drafts/:id/apply` · `/discard` | Hazır metne aktarır / siler |
| PATCH | `/api/growth-audit/opportunities/:id` | Fırsat durumunu günceller |

### Veritabanı
Migration: `prisma/migrations/20261013120000_sales_intelligence`.
- Yeni tablolar: `audit_reports` (belirteç özeti benzersiz) ve `sales_drafts` (tür, durum ve kaynak için CHECK kısıtları).
- `growth_opportunities.status` için CHECK kısıtı eklendi.

### Elle doğrulama
1. Tamamlanmış denetimi olan firmada Growth Audit sekmesini açın → **Rapor önizle** ve **PDF indir** ile raporu kontrol edin.
2. **Güvenli link oluştur** → bağlantıyı gizli bir pencerede açın (oturum gerekmez). **İptal et** dedikten sonra aynı bağlantı "Rapor bulunamadı" sayfasını vermelidir.
3. **AI mail oluştur** → metni düzenleyin → **Hazır metne aktar**. Firmanın Hazır metinler › İlk e-posta sekmesinde yeni metin görünür; hiçbir e-posta gönderilmez.
4. Firmayı Aranacaklara ekleyin → kartta **Arama brifi oluştur** → brifi açın, açılış cümlesini düzenleyin.
5. Firma listesinde Growth Score filtresini ve "Sırala: Growth Score" seçeneğini deneyin. Bir fırsatı "Yapıldı" yaptığınızda listede açık fırsat sayısı düşer ve fırsat raporda görünmez.

### Bilinen sınırlamalar
- Hız sınırı bellek içidir; çok sunuculu kurulumda ağ geçidinde uygulanmalıdır.
- AI anahtarı olmadan e-posta ve brif şablonla üretilir; dili sabit ve kanıta dayalıdır.
- Gönderilen e-posta sonrasında fırsat durumunun otomatik değişmesi henüz yok.

## Panel yapısı (Milestone 3 ile)
| Adres | Ne var |
|---|---|
| `/` | Girişten sonra çalışma alanı seçimi: **Growth Audit** veya **Yönetim Paneli** (eski `/#firma` bağlantıları otomatik yönlendirilir) |
| `/growth-audit` | Firmalar (liste + **harita**), Growth Audit, Gönderim, Aranacaklar |
| `/yonetim/musteriler` | CRM (eski `/crm` buraya yönlenir) |
| `/yonetim/growth-manager` | AI Growth Manager™ organizasyonları, portal kullanıcıları, entegrasyonlar |
| `/yonetim/google-ads` | Google Ads müşterileri (başlangıç formu, kampanya planı) |
| `/portal` | Müşteri portalı (ayrı giriş: `/portal/giris`, davet: `/portal/davet`) |

## Firma haritası
- Firmalar ekranındaki **Liste | Harita** düğmesi, filtrelerle aynı firmaları OpenStreetMap haritasında gösterir. Noktalar duruma göre renklenir; kümeler nötr renktedir.
- Konum öncelik sırası: radar kaydındaki koordinat → Google Maps bağlantısındaki koordinat → adres araması (Nominatim) → ilçe veya şehir merkezi.
- İlçe ya da şehir merkezine düşen konumlar "yaklaşık" olarak gösterilir: kesik çerçeveli ve hafif kaydırılmış noktalar.
- Konumlar firma kaydından ayrı `geo` kovasında saklanır. Eksik konumlar harita açıldığında arka planda tamamlanır; Nominatim kuralı gereği saniyede en fazla 1 istek atılır.
- Uçlar: `GET /api/geo/points`, `POST /api/geo/run`, `POST /api/geo/reset/:leadId`.

## Yedekten veri aktarma
`node --env-file=.env scripts/import-backup.mjs <yedek.json> [--dry-run] [--overwrite]`
- Radar/Redis yedeğini (`leads`, `runs`, `adsclients`, `adstokens`, `sends`…) uyumluluk tablolarına aktarır.
- Varsayılan olarak mevcut kayıtlara dokunmaz; tekrar çalıştırmak güvenlidir. Tüm aktarım tek işlem (transaction) içinde yapılır.

## Milestone 3 — AI Growth Manager™ MVP

### Kiracı yalıtımı ve kimlik doğrulama
- **Veri modeli:** `customer_organizations` kiracıyı tanımlar. Portal tarafındaki her sorgu oturumdaki `organization_id` ile sınırlıdır; başka organizasyonun kaydı 404 döner.
- **Roller:** sahip ve yönetici yazabilir; izleyici salt okunur. Yönetici önizlemesi 1 saatlik, salt okunur bir oturumdur.
- **Davet:** 7 gün geçerli bağlantıyla yapılır. Belirteç yalnızca özetiyle saklanır ve bir kez kullanılabilir. Parola en az 10 karakter olmalı ve harf ile rakam içermelidir.
- **Parola saklama:** scrypt ile özetlenir.
- **Oturum:** `im_portal` çerezi (HttpOnly, 12 saat). Yönetici oturumundan ayrı bir anahtarla imzalanır; kullanıcı devre dışı bırakılınca oturum geçersizleşir.
- **Kaba kuvvet koruması:** IP ve e-posta başına hız sınırı; 5 hatalı denemede hesap 15 dakika kilitlenir.

### Entegrasyonlar
- **Kaynaklar:** Google Ads, GA4 ve Search Console. Google OAuth 2.0 ile yalnızca okuma kapsamları istenir (`adwords`, `analytics.readonly`, `webmasters.readonly`).
- **OAuth akışı:** `state` imzalı ve 10 dakika geçerlidir; dönüşte bağlantıyı başlatan oturum yeniden doğrulanır.
- **Belirteç saklama:** yenileme belirteci AES-256-GCM ile şifrelenir (`INTEGRATION_ENCRYPTION_KEY`).
- **Bağlantıyı kaldırma:** belirteç Google'da iptal edilir ve o kaynaktan çekilen metrikler silinir.
- **Eşitleme:** son 56 gün çekilir; Search Console için 3 gün gecikme payı bırakılır. Her çalıştırma `integration_syncs` tablosuna kaydedilir; 3 ardışık hatada durum `error` olur.
- **Veri biçimi:** metrikler tek bir tabloda (`metric_daily`) hesap, kampanya, sorgu ve sayfa boyutlarında tutulur.
- **CRM entegrasyonu:** müşterinin kendi CRM'i için şimdilik "yakında" olarak işaretli. Takip edilmeyen talep dedektörü bu veriye bağlıdır.

### Dedektörler (`detect-1.0`)
Önemsiz dalgalanmalar için içgörü üretilmez: asgari hacim, göreli değişim ve iki oran z-testi (|z| ≥ 1,96) birlikte aranır.

**Para kaçağı:**
- Harcama artarken dönüşüm düşüyor. GA4 hedef olaylarıyla karşılaştırılarak **izleme sorunu ile performans sorunu ayrılır**.
- CPA bozulması.
- 14 günde atfedilebilir sonucu olmayan kampanya. Bu "kayıp" değil "risk altındaki tutar" olarak raporlanır; izleme çalışmıyorsa bu uyarı üretilmez.
- Ads dönüşüm takibi yok.
- GA4 hedef olayı yok.
- Site dönüşüm oranı düşüşü.

**Büyüme fırsatı:**
- Çok gösterim alıp az tıklanan sorgular.
- İkinci sayfanın başındaki sorgular.
- Bütçe yüzünden gösterim kaybeden verimli kampanyalar.
- Çok trafik alıp az dönüşen sayfalar.
- Growth Audit öncelikleri.

**Tahmin kuralları:**
- Parasal ve ek dönüşüm tahminleri yalnızca gerekçelendirilebildiğinde verilir; aralık, dayanak, varsayımlar ve güven düzeyiyle birlikte.
- İçgörüler parmak iziyle tekilleşir. Koşul kalkınca içgörü `expired` olur. Gizlenen içgörü 14 gün tekrar gösterilmez.

### Günlük Eylem Brifi
- **İçerik:** sağlık durumu, son 7 günün KPI'ları (önceki 7 güne göre), ±%15 üstü değişimler, kritik uyarılar, en büyük fırsatlar ve gerekçesiyle **3 öncelikli iş**.
- **AI özeti (isteğe bağlı):** yalnızca verilen olguları kullanır. Metinde olgularda geçmeyen bir sayı ya da yasak bir ifade varsa özet reddedilir ve kural tabanlı özet kullanılır.
- **Zamanlama:** her gün 07:00'den (İstanbul) sonra üretilir. Zamanlanmış işler 10 dakikada bir çalışır, `pg_try_advisory_xact_lock` ile çok sunucuda tek kez çalışır; `GM_WORKER=0` kapatır.

### Eylem motoru (V1)
- Her yeni içgörü için bir "taslak eylem" önerisi oluşur. Müşteri portalda onaylar veya reddeder.
- Karar, karar veren, zaman ve not kayıt altına alınır (`action_proposals`).
- **Dış hesaplarda otomatik değişiklik yapılmaz**; onaylanan işler ekip tarafından uygulanır (`execution_result.mode = "manual"`).

### Müşteri portalı (Faz 9)
- **Sekmeler:**
  - Genel bakış: KPI kutuları, uyarılar, Growth Score, 28 günlük tek seri grafikler
  - AI içgörüler
  - Günlük brif
  - Growth Audit: skor geçmişi, kategoriler, öncelikli ve tamamlanan iyileştirmeler, 30/60/90 plan
  - Entegrasyonlar
  - Onaylar
- **Veri kuralları:** Rakamlar yalnızca bağlı kaynaklardan gelir; kaynak yoksa boş durum gösterilir. Demo organizasyonda her sayfada "DEMO VERİ" şeridi vardır.
- **Yönetim panelinde "Demo organizasyon oluştur":** deterministik örnek veriyle tüm akışı gösterir. Demo organizasyona gerçek hesap bağlanamaz ve kullanıcı davet edilemez.

### Yeni ortam değişkenleri
`PORTAL_SESSION_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` (`https://<alan-adı>/oauth/google/callback`), `GOOGLE_ADS_DEVELOPER_TOKEN`; isteğe bağlı: `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `GOOGLE_ADS_API_VERSION` (varsayılan v22, Google'ın güncel sürümüne göre ayarlayın), `PUBLIC_PORTAL_BASE_URL`, `GM_WORKER`, `GM_INTERVAL_MS`.

### Migration
`prisma/migrations/20261013140000_growth_manager`. Yeni tablolar: `customer_organizations`, `customer_users`, `customer_integrations`, `integration_syncs`, `metric_daily`, `ai_insights`, `daily_briefs`, `action_proposals`. Rol, durum, sağlayıcı, önem ve güven için CHECK kısıtları vardır.

### Bilinen sınırlamalar
- Gerçek Google hesaplarıyla uçtan uca test yapılmadı (OAuth istemcisi ve Ads geliştirici belirteci gerekir). Ayrıştırıcılar Google'ın belgelenen yanıt biçimleriyle birim testinden geçti.
- Müşteri CRM'i, e-ticaret ve sipariş verisi bağlantıları yok; "takip edilmeyen nitelikli talep" dedektörü bu verilere bağlıdır.
- Portalda kullanıcının parolasını kendi sıfırlaması yok; yönetim panelinden yeniden davet edilir.
- Hız sınırı bellek içidir; çok sunucuda ağ geçidinde uygulanmalıdır.

## Ücretsiz dijital analiz (herkese açık form)

Pazarlama sitesi ve Instagram trafiği için oturumsuz uçlar (`src/modules/audit/public-audit.*`). Next.js `/api/*` isteklerini backend'e yönlendirdiği için site, panel alan adındaki `/api/public/audit` adresini çağırır.

| Yöntem | Yol | Açıklama |
|---|---|---|
| POST | `/api/public/audit` | `{ websiteUrl, name, email?, phone?, company?, sector?, instagram?, message?, source: "web"\|"instagram", locale: "tr"\|"en", website_hp: "", consent: true }` → `202 { token }`. Hatalar `400 { error, code }` (`invalid_url`, `unreachable_url`, `name_required`, `contact_required`, `invalid_email`, `invalid_phone`, `consent_required`, `spam`), `413`, `429`. |
| GET | `/api/public/audit/:token` | `{ status: "processing", progress, stage }` · `{ status: "completed", progress: 100, result: { overallScore, categories: [{ key, label, score }], summary, topOpportunities: [{ title, why, recommendedService }] (en fazla 3), reportUrl } }` · `{ status: "no_website" \| "failed", message }` · bilinmeyen belirteç `404`. |

- Aynı alan adına sahip firma varsa kayıt yeniden kullanılır (ekibin alanları ezilmez, `inboundHistory`'ye eklenir); yoksa `status: "yeni"` ile yeni kayıt açılır. Alanlar: `inbound`, `inboundSource`, `inboundAt`, `inboundMessage`, `inboundLocale`, `contactName`.
- Aktif denetim varsa o kullanılır. Sorgu belirteci 256 bittir, yalnızca SHA-256 özeti `public_audit_requests` tablosunda tutulur. Denetim bitince 90 gün geçerli müşteri raporu bağlantısı (`/r/:token`) bir kez oluşturulur; rapor belirteci sorgu belirtecinden HMAC ile türetildiği için saklanmaz.
- Hız sınırı (bellek içi): IP başına saatte 5 başlatma, dakikada 60 sorgu. Gövde en fazla 8 KB. CORS yalnızca `PUBLIC_AUDIT_ORIGINS` kökenlerine açılır.
- Bildirim: Telegram (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`) ve `LEAD_NOTIFY_EMAIL` (SMTP gerekir). Bildirim hatası isteği bozmaz.
- Panel: **Gelen Talepler** sekmesi (`#gelen`) — kaynak filtresi, Growth Score/audit durumu, tel/WhatsApp/e-posta bağlantıları, "İletişime geçildi" (aşama → İletişimde).
- Migration: `prisma/migrations/20261014100000_public_audit`.
