# Instagram DM Analiz Botu

Instagram'dan DM atan kişiye web sitesinin ücretsiz analizini gönderir. Resmî **Instagram API with Instagram Login** kullanılır (`graph.instagram.com`, Facebook Sayfası gerekmez). Graph sürümü: **v25.0** (`IG_GRAPH_VERSION`).

## Akış
1. Kullanıcı "ANALİZ" yazar (büyük/küçük harf ve Türkçe karakterden bağımsız) **veya** profildeki buzkıranlardan "🔎 Ücretsiz site analizi"ne dokunur (`START_AUDIT`) → bot site adresini ister (`awaiting_url`).
2. Kullanıcı adres yazar (ilk mesajda adres varsa doğrudan) → `mark_seen` + `typing_on` → güvenli URL denetimi (SSRF) → `PublicAuditService.submit` (kaynak `instagram`, 24 saatlik sonuç yeniden kullanılır) → `auditing`.
3. İşçi 15 sn'de bir bekleyen konuşmaları yoklar. Gerçek denetim ilerlemesine göre **en fazla 2** ara mesaj gönderilir (ilerleme ≥ %65 ve ≥ %75; düzey `key_values` içinde `ig:progress:<igsid>`). Bitince kart + öncelikli adımlar gönderilir.
4. "Ücretsiz görüşme" (kart butonu, hızlı yanıt ya da buzkıran `TALK_TO_TEAM`; sonuçtan sonra yazılı "evet" de olur) → "Ekibimiz en kısa sürede buradan size yazacak." + firma kaydında `inboundWantsContact: true` (firma varsa). Konuşma **72 saat** ekibe devredilir; bu sürede bot susar, yalnızca yeni "ANALİZ"/`START_AUDIT` botu yeniden başlatır.
5. "ℹ️ Analiz neleri kapsıyor?" (`ABOUT_AUDIT`) → kısa açıklama + "Analizi başlat" hızlı yanıtı.
6. Site doğrulanamazsa / analiz başarısızsa nazik mesaj. Boştayken anlaşılmayan mesaja kısa yardım metni.

### Mesaj sırası (adres gönderildiğinde)
Her gönderimden önce `typing_on` gönderilir.
1. `🔎 Analiz başladı · regeditpos.com` + "Siteniz 6 kategoride, 30+ kriterle inceleniyor. Sonuç birkaç dakika içinde burada olacak."
2. (ilerleme ≥ %65) "✓ Sayfalar tarandı / ✓ Hız ölçüldü / ⏳ Google görünürlüğü ve dönüşüm noktaları inceleniyor…"
3. (ilerleme ≥ %75) "✓ Teknik ölçümler tamamlandı / ⏳ Yapay zekâ raporu hazırlıyor…"
4. **Kart** (generic template): görsel `/r/<rapor-belirteci>/card.png`, başlık `regeditpos.com · 71/100 · Geliştirilebilir`, alt başlık `Öncelik: <ilk sorun>`, butonlar **Detaylı raporu aç** (web_url) ve **Ücretsiz görüşme** (postback `TALK_TO_TEAM`). Başarısızsa button template, o da başarısızsa URL'siz metin + "Ücretsiz görüşme" notu.
5. "Öncelikli 3 adım:" numaralı liste + hızlı yanıtlar **[Ücretsiz görüşme] [Başka site analiz et]**.

Analiz hızlı biterse (ör. 24 saatlik yeniden kullanım) 2–3 atlanır.

**Mesajlarımızda hiçbir zaman ham URL yoktur.** Kullanıcının kendi yazdığı adres için Instagram'ın gösterdiği bağlantı önizlemesi (ör. `regeditpos.com` yazınca çıkan kart) Instagram istemcisinin davranışıdır; bizim tarafımızdan kapatılamaz.

## Yorumdan DM (private replies)
Gönderi/Reels yorumlarında tetikleyici varsa yorum sahibine özel yanıt (DM) gönderilir. Webhook alanları **comments** ve **live_comments** (abone); izin **`instagram_business_manage_comments`** (eklendi; App Review'da Advanced Access istenmeli).
- **Tetikleyici:** "analiz" kelimesi (ANALİZ, analiz yap, #analiz; büyük/küçük harf ve Türkçe karakterden bağımsız) ya da yorumda alan adı/URL.
- **Özel yanıt:** `POST /<IG_ACCOUNT_ID>/messages` gövde `{ recipient: { comment_id }, message: { text } }`. Belgede yalnızca `text` tanımlı olduğundan hızlı yanıt **gönderilmez** (düz metin). Yorumdan itibaren **7 gün** içinde; kullanıcı yanıtlayana kadar yalnızca **1 mesaj**.
  - Adres yok → "Merhaba 👋 Yorumunuz için teşekkürler. Sitenizi ücretsiz analiz edelim…" → konuşma `awaiting_url`; kullanıcı adres yazınca normal DM akışı.
  - Adres var → analiz hemen başlar, tek mesaj: "🔎 {domain} analiz ediliyor. Sonucu görmek için bu mesaja herhangi bir yanıt yazın (ör. 'tamam')." Konuşmada `reply_gate = true`: yoklayıcı sonucu **göndermez**. Kullanıcı yanıtlayınca kapı açılır; sonuç hazırsa hemen gönderilir, değilse "Analiziniz sürüyor…" ve sonuç hazır olunca yoklayıcı gönderir.
- **Herkese açık yanıt:** `POST /{comment_id}/replies` `{ message }`; 3 kısa metinden biri (yorum kimliğine göre dönüşümlü). `IG_COMMENT_PUBLIC_REPLY=0` kapatır (varsayılan açık). Canlı yayın yorumlarına herkese açık yanıt yazılmaz.
- **Yok sayılanlar:** kendi yorumlarımız (`from.id == IG_ACCOUNT_ID`/entry kimliği ya da `IG_ACCOUNT_USERNAME` eşleşmesi), bizim yanıtladığımız yorumun altındaki yanıtlar, tetikleyicisiz yorumlar, aynı yorum kimliği (`ig_comment_events`, idempotent), analizi süren kişiler. Sınır: kullanıcı başına **gönderi başına 1**, **günde 3** özel yanıt (+ mevcut günlük 3 analiz sınırı).
- **Kimlik:** yorum webhook'undaki `from.id` Instagram-scoped ID'dir (IGSID); `ig_conversations` ile aynı anahtar. Webhook hem `entry[].field/value` (belgedeki) hem `entry[].changes[]` biçiminde kabul edilir; yorum kimliği `value.id` ya da `value.comment_id`.
- **Talep:** kaynak `instagram`, not `Yorum: <media id> (IGSID …)`; Telegram/e-posta bildirimi yok.

## Skor kartı görseli
`GET /r/:token/card.png` (backend, `PublicReportController`): rapor bağlantısıyla aynı belirteç ve doğrulama (geçersiz/süresi dolmuş/iptal → 404), görüntülenme sayılmaz, `Cache-Control: public, max-age=86400`. 1200×628 PNG (1.91:1, generic template varsayılan oranı), `@resvg/resvg-js` ile SVG'den üretilir; Plus Jakarta Sans dosyadan yüklenir (sistem yazı tipi gerekmez). Next.js `/r/:path*` vekili bu yolu backend'e iletir. Kod: `src/modules/sales/report.card.ts`.

## Buzkıranlar (ice breakers)
`npm run ig:setup-profile` (`scripts/ig-setup-profile.mjs`): `.env` içindeki `IG_ACCESS_TOKEN` ile `POST https://graph.instagram.com/v25.0/me/messenger_profile` (`platform: "instagram"`) çağırır; önce mevcut listeyi yazdırır, liste zaten aynıysa yazmaz. Yalnızca görmek için: `npm run ig:setup-profile -- --show`. Buzkıranlar Instagram masaüstünde görünmez (Meta kısıtı), yalnızca mobil uygulamada yeni sohbet açılırken çıkar. Postback'ler için `messaging_postbacks` aboneliği gerekir.

Bot **Telegram/e-posta bildirimi göndermez**; ekip Instagram'dan elle yanıtlar. Yankılar (`is_echo`), kendi mesajlarımız, tepkiler ve okundu bilgileri yanıtlanmaz. Aynı mesaj kimliği (`mid`) bir kez işlenir. Kullanıcı başına günde en fazla 3 analiz.

## Uçlar
| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/api/instagram/webhook` | Meta doğrulaması: `hub.verify_token == IG_VERIFY_TOKEN` ise `hub.challenge` döner |
| POST | `/api/instagram/webhook` | `X-Hub-Signature-256` ham gövde üzerinden `IG_APP_SECRET` ile doğrulanır; hemen 200 döner, işlem arka planda |

## Ortam değişkenleri
`IG_APP_SECRET`, `IG_VERIFY_TOKEN`, `IG_ACCESS_TOKEN` (uzun ömürlü Instagram kullanıcı belirteci), `IG_ACCOUNT_ID` (Instagram profesyonel hesap kimliği), `IG_GRAPH_VERSION` (varsayılan `v25.0`), `IG_COMMENT_PUBLIC_REPLY` (`0` → yorumlara herkese açık yanıt yok), `IG_ACCOUNT_USERNAME` (isteğe bağlı; kendi yorumlarımızı kullanıcı adıyla da eler). Dördünden biri eksikse bot kapalıdır. Rapor bağlantısı `PUBLIC_REPORT_BASE_URL` (yoksa `https://customer.istanbul.marketing`) ile üretilir. `AUDIT_WORKER=0` olan örnekte yoklayıcı çalışmaz.

## Belirteç yenileme
Uzun ömürlü belirteç 60 gün geçerlidir. İşçi 6 saatte bir kontrol eder; son yenileme 7 günden eskiyse `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token` çağrılır ve yeni belirteç `key_values` tablosuna (`ig:access_token`; `INTEGRATION_ENCRYPTION_KEY` varsa AES-GCM şifreli) yazılır. Depoda belirteç yoksa `IG_ACCESS_TOKEN` kullanılır. Belirteç en az 24 saatlik olmalıdır; sunucu 60 günden uzun kapalı kalırsa yeni belirteç üretip env'e girin.

## Meta kurulum adımları
1. **Uygulama oluştur:** developers.facebook.com → My Apps → Create App → kullanım durumu "Other" → tür **Business**.
2. **Instagram ürünü:** Dashboard → Add product → **Instagram** → **API setup with Instagram login**.
3. **Hesap ekle:** "Generate access tokens" bölümünde Instagram **profesyonel** (İşletme/İçerik üreticisi) hesabını bağlayın, izinleri onaylayın. Görünen hesap kimliği → `IG_ACCOUNT_ID`.
4. **Belirteç:** "Generate token" ile uzun ömürlü belirteci alın → `IG_ACCESS_TOKEN`. App settings → Basic → **Instagram app secret** → `IG_APP_SECRET` (Instagram ürünü sayfasındaki app secret).
5. **Webhook:** "Configure webhooks" → Callback URL `https://customer.istanbul.marketing/api/instagram/webhook`, Verify token = `IG_VERIFY_TOKEN` (rastgele uzun bir değer: `openssl rand -hex 24`) → Verify and save. Önce backend'e env'i girip yeniden başlatın.
6. **Abonelik:** Webhook alanlarından **messages**, **messaging_postbacks**, **comments** ve **live_comments** alanlarına abone olun; hesap satırında webhook aboneliğini açın (gerekirse `POST /me/subscribed_apps?subscribed_fields=messages,messaging_postbacks,comments,live_comments`).
7. **Mesaj erişimi:** Instagram uygulamasında Ayarlar → Gizlilik → Mesajlar → **Bağlı araçlar → "Mesajlara erişime izin ver"** açık olmalı.
8. **Geliştirme modu:** Uygulama yayınlanmadan yalnızca uygulamada rolü olan kişiler (App roles → Roles → Instagram Tester; davet Instagram → Ayarlar → Web sitesi izinleri'nden kabul edilir) bota yazınca webhook gelir.
9. **App Review:** `instagram_business_basic`, `instagram_business_manage_messages` ve `instagram_business_manage_comments` için **Advanced Access** isteyin. Ekran kaydı: test hesabından "ANALİZ" → adres → sonuç DM'i → EVET akışı; kullanım açıklaması Türkçe/İngilizce.
10. **Business Verification:** Meta İşletme Hesabı doğrulamasını tamamlayın (Advanced Access için gerekli), ardından uygulamayı **Live** moda alın.

## Notlar
- Instagram yalnızca kullanıcının son mesajından sonraki 24 saat içinde yanıt göndermeye izin verir; analiz birkaç dakikada bittiği için sorun olmaz. 23 saatten uzun gönderilemeyen sonuç bırakılır.
- Next.js vekili `/api/*` isteklerini gövdeyi değiştirmeden iletmelidir (imza ham gövde üzerinden hesaplanır).
- Migration: `prisma/migrations/20261014160000_instagram_bot` (`ig_conversations`), `prisma/migrations/20261015120000_instagram_comments` (`ig_comment_events`, `ig_conversations.reply_gate/comment_media`).
