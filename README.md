# IM Growth Audit — Backend

NestJS 11 tabanlı API uygulaması.

## Dizinler

- `src/modules/crm` — müşteri, sözleşme, ödeme, görev ve aktivite alanı
- `src/modules/growth` — müşteri adayı, erişim, sunum, e-posta ve reklam süreçleri
- `src/modules/audit` — Growth Audit™ motoru: güvenli tarama, Growth Score™, AI analist, fırsatlar ve arka plan kuyruğu ([ayrıntılar](docs/growth-audit.md))
- `src/modules/health` — servis sağlık kontrolü
- `src/infrastructure/prisma` — uygulamanın Prisma bağlantı katmanı
- `prisma/schema.prisma` — PostgreSQL veri modeli ve ilişkiler
- `prisma/migrations` — sürümlenmiş Prisma migration dosyaları
- `scripts` — operasyon ve veri aktarım komutları

## Çalıştırma

```bash
cp .env.example .env
npm install
npm run dev
```

Tüm yerel veriler PostgreSQL'de tutulur. Upstash Redis ortam değişkenleri yalnızca mevcut uzak kurulumla geriye dönük uyumluluk gerektiğinde isteğe bağlı olarak kullanılabilir.

## PostgreSQL

CRM ve müşteri adayı verileri PostgreSQL'de tutulur. Yerel geliştirme kümesi proje içindeki `.postgres/` dizinindedir ve Git tarafından takip edilmez. Varsayılan port `55432`'dir.

```bash
npm run db:start
npm run db:migrate
npm run dev
```

Veritabanını kontrol etmek veya durdurmak için:

```bash
npm run db:status
npm run db:stop
```

Bağlantı `DATABASE_URL` ortam değişkeninden okunur. Prisma ana veritabanı katmanıdır; şema `prisma/schema.prisma`, migration geçmişi `prisma/migrations` altında tutulur.

Şema değişikliğinden sonra geliştirme migration'ı oluşturmak için:

```bash
npm run prisma:migrate -- --name degisiklik_adi
npm run prisma:generate
```

Üretimde yalnızca kayıtlı migration'ları uygulayın:

```bash
npm run prisma:deploy
```

Eski SQL migration çalıştırıcısı geçiş dönemi uyumluluğu için `npm run db:legacy:migrate` komutunda korunmuştur.

## Dağıtım ve operasyon

Docker kurulumu, yayına alma kontrol listesi, günlükler, yedekleme ve anahtar yenileme: [docs/operations.md](docs/operations.md).

## Komutlar

- `npm run dev` — geliştirme sunucusu
- `npm run build` — üretim derlemesi
- `npm start` — üretim sunucusu
- `npm run push:leads -- <dosya.json>` — müşteri adaylarını API'ye aktarır
- `npm run db:migrate` — bekleyen Prisma migration'larını uygular
- `npm run prisma:generate` — tip güvenli Prisma Client üretir
- `npm run prisma:validate` — Prisma şemasını doğrular
- `npm run prisma:studio` — Prisma Studio'yu açar
- `npm run typecheck` — TypeScript tip kontrolü
- `npm test` — Growth Audit birim ve entegrasyon testleri (`DATABASE_URL` varsa veritabanı kısıtları da sınanır)
