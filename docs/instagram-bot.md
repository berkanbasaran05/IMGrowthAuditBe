# Instagram DM Analiz Botu

Instagram'dan DM atan kişiye web sitesinin ücretsiz analizini gönderir. Resmî **Instagram API with Instagram Login** kullanılır (`graph.instagram.com`, Facebook Sayfası gerekmez). Graph sürümü: **v25.0** (`IG_GRAPH_VERSION`).

## Akış
1. Kullanıcı "ANALİZ" (büyük/küçük harf ve Türkçe karakterden bağımsız; "analiz yap" vb.) yazar → bot site adresini ister (`awaiting_url`).
2. Kullanıcı adres yazar (ilk mesajda adres varsa doğrudan) → güvenli URL denetimi (SSRF) → `PublicAuditService.submit` (kaynak `instagram`, Gelen Talepler'de görünür, aynı alan adı için 24 saatlik sonuç yeniden kullanılır) → "analiz ediliyor" mesajı (`auditing`).
3. İşçi her 15 sn'de bekleyen konuşmaları yoklar; analiz bitince skor + öncelikli 3 adım (sade dil) + rapor bağlantısı + "EVET" çağrısı gönderilir (EVET/Hayır hızlı yanıtlarıyla). Mesajlar 1000 bayt sınırına göre bölünür. Durum veritabanında (`ig_conversations`) tutulduğu için sunucu yeniden başlasa da sonuç gönderilir.
4. "EVET" → "Ekibimiz en kısa sürede buradan size yazacak." + firma kaydına `inboundWantsContact: true`. Konuşma **72 saat** ekibe devredilir (`handoff`): bot bu sürede yanıt vermez; kullanıcı yeniden "ANALİZ" yazarsa bot yeniden devreye girer.
5. Site doğrulanamazsa veya analiz başarısız olursa nazik bir mesajla adresin kontrol edilmesi istenir. Boştayken anlaşılmayan mesaja kısa yardım metni gider.

Bot **Telegram/e-posta bildirimi göndermez**; ekip Instagram'dan elle yanıtlar. Yankılar (`is_echo`), kendi mesajlarımız, tepkiler ve okundu bilgileri yanıtlanmaz. Aynı mesaj kimliği (`mid`) bir kez işlenir. Kullanıcı başına günde en fazla 3 analiz.

## Uçlar
| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/api/instagram/webhook` | Meta doğrulaması: `hub.verify_token == IG_VERIFY_TOKEN` ise `hub.challenge` döner |
| POST | `/api/instagram/webhook` | `X-Hub-Signature-256` ham gövde üzerinden `IG_APP_SECRET` ile doğrulanır; hemen 200 döner, işlem arka planda |

## Ortam değişkenleri
`IG_APP_SECRET`, `IG_VERIFY_TOKEN`, `IG_ACCESS_TOKEN` (uzun ömürlü Instagram kullanıcı belirteci), `IG_ACCOUNT_ID` (Instagram profesyonel hesap kimliği), `IG_GRAPH_VERSION` (varsayılan `v25.0`). Dördünden biri eksikse bot kapalıdır. Rapor bağlantısı `PUBLIC_REPORT_BASE_URL` (yoksa `https://customer.istanbul.marketing`) ile üretilir. `AUDIT_WORKER=0` olan örnekte yoklayıcı çalışmaz.

## Belirteç yenileme
Uzun ömürlü belirteç 60 gün geçerlidir. İşçi 6 saatte bir kontrol eder; son yenileme 7 günden eskiyse `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token` çağrılır ve yeni belirteç `key_values` tablosuna (`ig:access_token`; `INTEGRATION_ENCRYPTION_KEY` varsa AES-GCM şifreli) yazılır. Depoda belirteç yoksa `IG_ACCESS_TOKEN` kullanılır. Belirteç en az 24 saatlik olmalıdır; sunucu 60 günden uzun kapalı kalırsa yeni belirteç üretip env'e girin.

## Meta kurulum adımları
1. **Uygulama oluştur:** developers.facebook.com → My Apps → Create App → kullanım durumu "Other" → tür **Business**.
2. **Instagram ürünü:** Dashboard → Add product → **Instagram** → **API setup with Instagram login**.
3. **Hesap ekle:** "Generate access tokens" bölümünde Instagram **profesyonel** (İşletme/İçerik üreticisi) hesabını bağlayın, izinleri onaylayın. Görünen hesap kimliği → `IG_ACCOUNT_ID`.
4. **Belirteç:** "Generate token" ile uzun ömürlü belirteci alın → `IG_ACCESS_TOKEN`. App settings → Basic → **Instagram app secret** → `IG_APP_SECRET` (Instagram ürünü sayfasındaki app secret).
5. **Webhook:** "Configure webhooks" → Callback URL `https://customer.istanbul.marketing/api/instagram/webhook`, Verify token = `IG_VERIFY_TOKEN` (rastgele uzun bir değer: `openssl rand -hex 24`) → Verify and save. Önce backend'e env'i girip yeniden başlatın.
6. **Abonelik:** Webhook alanlarından **messages** ve **messaging_postbacks** alanlarına abone olun; hesap satırında webhook aboneliğini açın (gerekirse `POST /me/subscribed_apps?subscribed_fields=messages,messaging_postbacks`).
7. **Mesaj erişimi:** Instagram uygulamasında Ayarlar → Gizlilik → Mesajlar → **Bağlı araçlar → "Mesajlara erişime izin ver"** açık olmalı.
8. **Geliştirme modu:** Uygulama yayınlanmadan yalnızca uygulamada rolü olan kişiler (App roles → Roles → Instagram Tester; davet Instagram → Ayarlar → Web sitesi izinleri'nden kabul edilir) bota yazınca webhook gelir.
9. **App Review:** `instagram_business_basic` ve `instagram_business_manage_messages` için **Advanced Access** isteyin. Ekran kaydı: test hesabından "ANALİZ" → adres → sonuç DM'i → EVET akışı; kullanım açıklaması Türkçe/İngilizce.
10. **Business Verification:** Meta İşletme Hesabı doğrulamasını tamamlayın (Advanced Access için gerekli), ardından uygulamayı **Live** moda alın.

## Notlar
- Instagram yalnızca kullanıcının son mesajından sonraki 24 saat içinde yanıt göndermeye izin verir; analiz birkaç dakikada bittiği için sorun olmaz. 23 saatten uzun gönderilemeyen sonuç bırakılır.
- Next.js vekili `/api/*` isteklerini gövdeyi değiştirmeden iletmelidir (imza ham gövde üzerinden hesaplanır).
- Migration: `prisma/migrations/20261014160000_instagram_bot` (`ig_conversations`).
