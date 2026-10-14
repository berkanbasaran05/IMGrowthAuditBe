# Operasyon ve dağıtım rehberi

## Mimari
```
İnternet ──TLS──▶ Ters vekil (Caddy/Nginx/Cloudflare) ──▶ Frontend (Next.js :3000) ──/api, /r, /oauth, /demo, /sunum──▶ Backend (NestJS :3001) ──▶ PostgreSQL
```
- Tarayıcı yalnızca frontend'e konuşur; backend dışarıya açılmaz.
- Arka plan işleri backend sürecinde çalışır:
  - Growth Audit kuyruğu (`AUDIT_WORKER`)
  - AI Growth Manager zamanlayıcısı: eşitleme, analiz, günlük brif, veri saklama (`GM_WORKER`)
  - Konum işi
- Birden çok backend örneği güvenle çalışır: kuyruk `FOR UPDATE SKIP LOCKED`, zamanlayıcı `pg_try_advisory_xact_lock` kullanır.
- Bellek içi hız sınırları örnek başına tutulur. Çok örnekli kurulumda hız sınırını ters vekilde de uygulayın.

## Docker ile kurulum (tek sunucu)
```bash
cd IMGrowthAuditBe
cp .env.example .env          # değerleri doldurun (aşağıdaki kontrol listesi)
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
```
- Kurulum sırası: `db`, `migrate` (`prisma migrate deploy`), `backend`, `frontend`. Frontend `127.0.0.1:3000`'da dinler; TLS'i ters vekil sonlandırır.
- **İstemci IP'si:** Next.js `X-Forwarded-For` başlığına kendi kaydını eklemez; başlık yoksa ekler, varsa olduğu gibi iletir.
  - Bu yüzden `TRUST_PROXY_HOPS=1` doğrudur.
  - Önde istemci IP'sini ekleyen bir ters vekil **şarttır**. Nginx için: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`. Caddy ve Cloudflare bunu varsayılan olarak yapar.
  - Next.js doğrudan internete açılırsa IP taklit edilebilir ve hız sınırları atlatılabilir.
- **`BACKEND_URL` frontend derlenirken yönlendirmelere işlenir.** Değişirse frontend imajını yeniden derleyin.
- Sağlık kontrolleri:
  - `GET /api/health`: canlılık ve veritabanı
  - `GET /api/health/ready`: migration'lar uygulanmış mı (dağıtım/yük dengeleyici kontrolü)

## Docker olmadan
```bash
# backend
npm ci && npx prisma generate && npx prisma migrate deploy && npx nest build
NODE_ENV=production node dist/main.js
# frontend
npm ci && BACKEND_URL=http://127.0.0.1:3001 BUILD_STANDALONE=1 npx next build
cp -R .next/static .next/standalone/.next/static && cp -R public .next/standalone/public
NODE_ENV=production PORT=3000 HOSTNAME=127.0.0.1 node .next/standalone/server.js
```
- Node.js 22 veya üstü gereklidir.
- Geliştirme sunucusu açıkken üretim derlemesini ayrı klasöre alın: `NEXT_DIST_DIR=.next-prod npx next build`. Aynı `.next` klasörüne derlemek çalışan geliştirme sunucusunu bozar.

## Yayına alma kontrol listesi
- [ ] `NODE_ENV=production`
- [ ] `SESSION_SECRET` ve `PORTAL_SESSION_SECRET`: `openssl rand -base64 48`
- [ ] `ADMIN_USER` ve en az 12 karakterlik güçlü bir `ADMIN_PASSWORD`. Uygulama zayıf veya örnek değerle **başlamaz**.
- [ ] `INGEST_TOKEN` (en az 32 karakter): günlük firma aktarımı (`npm run push:leads`) için
- [ ] `INTEGRATION_ENCRYPTION_KEY`: `openssl rand -base64 32`. **Kaybedilirse bağlı Google hesapları yeniden bağlanmalıdır**; yedekleyin.
- [ ] `DATABASE_URL`, ayrıca compose kullanılıyorsa `POSTGRES_PASSWORD`
- [ ] SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) ve `SEND_DAILY_LIMIT`
- [ ] İsteğe bağlı entegrasyonlar:
  - `ANTHROPIC_API_KEY` (AI)
  - `PSI_KEY` (Lighthouse)
  - Google OAuth ve Ads değişkenleri; OAuth yönlendirme adresi: `https://<alan-adı>/oauth/google/callback`
- [ ] `PUBLIC_REPORT_BASE_URL` ve `PUBLIC_PORTAL_BASE_URL`: müşteri bağlantılarında görünen alan adı
- [ ] Ters vekilde: HTTPS, HTTP→HTTPS yönlendirmesi, istek gövdesi sınırı, `/api/portal/login` ve `/api/login` için hız sınırı
- [ ] Yönetim paneli › **Sistem** sayfasında yapılandırma hatası veya uyarısı kalmadığını kontrol edin

## Gözlemlenebilirlik
- **Günlükler:** standart çıktıya JSON satırları yazılır (`{"t","level","msg",...}`).
  - Her istek `X-Request-Id` ile izlenir. Hata yanıtlarında `requestId` döner; kullanıcı bu kodu iletirse günlükte bulunur.
  - Rapor belirteçleri, davet, OAuth ve imza parametreleri günlükte `[gizli]` olarak maskelenir.
  - Yakalanmayan hatalar `level=error, msg=unhandled` olarak yığın özetiyle günlüğe yazılır; kullanıcıya genel mesaj gösterilir.
- **Uyarı kuralları (günlük toplayıcıda önerilen):**
  - `msg=unhandled`
  - `msg=csrf_blocked` artışı
  - `status>=500` oranı
  - Sistem sayfasında: `failedLast24h` dolu veya zamanlayıcı son çalışması 30 dakikadan eski
- **Sistem sayfası (`/yonetim/sistem`, API: `GET /api/ops/status`):**
  - sürüm, yapılandırma ve özellik durumu
  - Growth Audit kuyruğu ve son 24 saatin hataları
  - zamanlayıcı ve entegrasyon hataları
  - **30 günlük AI token ve tahmini maliyet** (özellik bazında) ve PageSpeed kullanımı
  - e-posta günlük limiti, konum işi, veri saklama politikası

## Yedekleme ve geri yükleme
```bash
pg_dump --format=custom --no-owner "$DATABASE_URL" > yedek-$(date +%F).dump      # her gece, 30 gün saklayın
pg_restore --clean --no-owner --dbname "$DATABASE_URL" yedek-YYYY-AA-GG.dump
```
- `INTEGRATION_ENCRYPTION_KEY`'i veritabanı yedeğinden **ayrı** bir yerde saklayın: yedekle birlikte çalınırsa belirteçler çözülebilir; kaybolursa entegrasyonlar yeniden bağlanmalıdır.
- Eski Redis/Radar JSON yedeklerini aktarmak için: `node --env-file=.env scripts/import-backup.mjs <dosya> --dry-run`, ardından `--dry-run` olmadan çalıştırın.

## Anahtar yenileme
- **`SESSION_SECRET`:** tüm yönetici oturumları ve imzalı görsel bağlantıları geçersiz olur.
- **`PORTAL_SESSION_SECRET`:** tüm müşteri portal oturumları sona erer; müşteriler yeniden giriş yapar.
- **`INTEGRATION_ENCRYPTION_KEY`:** mevcut şifreli belirteçler çözülemez; bağlantıları portaldan veya yönetim panelinden yeniden kurun.

## Veri saklama (gizlilik)
- Her gün 03:00'ten (İstanbul) sonra şunlar silinir; süreler `RETENTION_*_DAYS` ile değiştirilebilir:
  - eski ekran görüntüleri
  - 400 günden eski metrikler
  - eşitleme kayıtları
  - biten rapor bağlantıları
  - silinmiş taslaklar
  - kapanmış içgörüler
  - eski brifler
- Denetim puanları ve metrik sonuçları açıklanabilirlik için korunur.
- Entegrasyon kaldırıldığında o kaynağın metrikleri hemen silinir.
- Müşteri organizasyonu silinirse kullanıcıları, entegrasyonları, metrikleri, içgörüleri ve brifleri de silinir (cascade).

## Güvenlik incelemesi (Milestone 4)
Bağımsız inceleme ve düzeltmeler (regresyon testleriyle):

| Bulgu | Önem | Durum |
|---|---|---|
| IPv4 eşlenmiş IPv6 yazımıyla (`[::ffff:7f00:1]`) SSRF filtresi atlatılabiliyordu | Yüksek | Düzeltildi: IPv4 ve IPv6 için ayrı `net.BlockList`; eşlenmiş, uyumlu, NAT64, 6to4 ve Teredo aralıkları engelli |
| Görsel vekili ve demo kalite kontrolü korumasız `fetch` kullanıyordu | Orta | Düzeltildi: `safeFetch` kullanılıyor (özel ağ engeli, boyut ve süre sınırı) |
| `/api/track` ile `__proto__` sayfa adı üzerinden prototip kirliliği | Orta | Düzeltildi |
| `INGEST_TOKEN` tekil firma kaydını düzenleyebiliyor, toplu aktarım ekibin alanlarını ezebiliyordu | Orta | Düzeltildi: makine tekil düzenleme yapamaz; toplu aktarım aşama, not, gönderim dizisi, arama, yetkili, demo ve düzenlenmiş metni korur |
| Hedefli hesap kilitleme (yönetici kullanıcı adı ve portal e-postası) | Düşük | Düzeltildi: kilitleme IP ve e-posta+IP anahtarıyla yapılıyor; kalıcı hesap kilidi kaldırıldı |
| Yönetici oturumu iptal edilemiyordu | Düşük | İyileştirildi: imza anahtarı parolaya bağlı, parola değişince tüm oturumlar düşer |
| Reklam formu anahtarı (`k`) erişim günlüğüne açık yazılıyordu | Düşük | Düzeltildi: maskeleniyor |
| Görsel imzası oturumla aynı anahtarı kullanıyor, karşılaştırma sabit zamanlı değildi | Düşük | Düzeltildi |
| `isProvider` prototip anahtarlarını kabul ediyordu | Düşük | Düzeltildi |
| İç hata ayrıntısı (Prisma, pg) yanıtlara düşüyordu | Düşük | Düzeltildi: `publicMessage`; ayrıntı yalnızca günlükte |
| İstemci IP'si `X-Forwarded-For` ile taklit edilebiliyordu | Belirsiz → doğrulandı | Ters vekil zorunlu ve `TRUST_PROXY_HOPS=1` olarak belgelendi |

**İnceleme sırasında bulunan önceden var olan hatalar (düzeltildi):**
- PostgreSQL uyumluluk katmanında `INCR`/`DECR` "bigint + text" hatası veriyordu. Bu yüzden günlük e-posta sayacı, demo izleme ve form hız sınırı çalışmıyordu.
- Express 5'te `req.query` salt okunur olduğu için `/demo/:slug`, `/sunum/:slug`, `/api/track` ve `/api/domain` yol bilgisini kaybediyordu; potansiyel müşteriye giden sunum bağlantıları etkileniyordu.
- Prisma pg adaptörü saat dilimi eki olmadan yazdığı için zaman damgaları veritabanı saat dilimi kadar (3 saat) kayıyordu. Rapor bağlantısı bitiş süreleri ve kilitlenme süreleri bundan etkileniyordu.

**Kabul edilen riskler:**
- Demo sayfalarından gelen izleme ve randevu istekleri firma kimliğiyle (slug) doğrulanır; imzalı belirteç yoktur. IP başına hız sınırı vardır.
- DNS yeniden bağlama (rebinding) penceresi için ağ katmanında çıkış kısıtı önerilir.
- Tek bir yönetici oturumu tek başına iptal edilemez; gerekirse `SESSION_SECRET` veya parola değiştirilir.

## Bilinen sınırlamalar
- Docker imajları bu ortamda derlenip çalıştırılamadı (Docker kurulu değildi). Aynı adımlar yerelde doğrulandı: üretim derlemesi, bağımsız (standalone) Next.js sunucusu ve `NODE_ENV=production` backend.
- Hız sınırları bellek içidir.
- Zamanlayıcı, kilidi tutmak için çalıştığı süre boyunca bir veritabanı işlemi (transaction) açık tutar. Yoğun kurulumda ayrı bir işçi sürecine taşınabilir (`GM_WORKER=0` ile API örneklerinde kapatıp tek bir işçi örneğinde açın).

## Ödemeler (kartla ödeme linki ve portal)
- **Akış:**
  1. Yönetim paneli › Müşteriler › bekleyen ödeme › **Ödeme linki** ile süreli, tek seferlik gösterilen bir bağlantı üretilir (`/odeme/<belirteç>`) ve hazır mesaj kopyalanır.
  2. Müşteri bağlantıdan veya portalın **Ödemeler** sekmesinden **Kartla öde**'ye basar ve iyzico'nun güvenli sayfasında öder.
  3. Dönüşte sonuç **iyzico'dan sunucuya sorulur**: yanıt imzası doğrulanır; tutar, para birimi ve işlem kimliği eşleşmezse ödeme "ödendi" yapılmaz.
  4. Ödeme kendiliğinden "Ödendi" olur ve müşteri geçmişine işlenir. Aynı dönüş tekrar gelirse çift işlenmez.
- **Kart bilgisi hiçbir zaman bu sisteme gelmez.** Link belirteçleri yalnızca özet (hash) olarak saklanır.
- **Hesap bağlama:** Portalda ödeme ve sözleşme görünmesi için müşteri organizasyonunun CRM müşterisine bağlı olması gerekir (Yönetim › AI Growth Manager › organizasyon oluştururken "CRM müşterisi").
- **Yetkiler:** Portalda kartla ödemeyi yalnızca sahip/yönetici başlatabilir; izleyici ve önizleme göremez/başlatamaz.
- **Canlıya geçiş:**
  1. iyzico üye iş yeri başvurusu onaylanınca canlı anahtarlarla `IYZICO_API_KEY`, `IYZICO_SECRET_KEY` ve `IYZICO_BASE_URL=https://api.iyzipay.com` değerlerini girin.
  2. Sistem sayfasında "iyzico test ortamında" uyarısının kalktığını kontrol edin.
  3. İlk gerçek ödemeyi küçük tutarla deneyin.
- **Havale/EFT:** `BANK_IBAN` tanımlıysa ödeme linkinde ve portalda IBAN de gösterilir (kart olmayan müşteri için).
- **Komisyon:** iyzico komisyonu ve para aktarım süresi hesap sözleşmenize bağlıdır; ödeme tutarı müşteriden tam tahsil edilir, kesinti iyzico hesabınıza geçerken uygulanır.
- **Bilinen sınırlama:** iyzico ile gerçek hesap bağlantısı bu ortamda denenemedi. İstek biçimi ve yanıt imzası doğrulaması iyzico'nun resmî SDK'sına göre birim testlerinden geçti; akışın tamamı yerel test sağlayıcısıyla uçtan uca denendi. Canlıya almadan önce iyzico sandbox hesabıyla bir deneme yapın.
