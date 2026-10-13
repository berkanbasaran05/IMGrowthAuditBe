# IM Growth Audit — Backend

NestJS 11 tabanlı API uygulaması.

## Dizinler

- `src/modules/crm` — müşteri, sözleşme, ödeme, görev ve aktivite alanı
- `src/modules/growth` — müşteri adayı, erişim, sunum, e-posta ve reklam süreçleri
- `src/modules/health` — servis sağlık kontrolü
- `scripts` — operasyon ve veri aktarım komutları

## Çalıştırma

```bash
cp .env.example .env
npm install
npm run dev
```

Upstash Redis değerleri tanımlanmadan sağlık kontrolü çalışır ancak veri kullanan uçlar çalışmaz.

## Komutlar

- `npm run dev` — geliştirme sunucusu
- `npm run build` — üretim derlemesi
- `npm start` — üretim sunucusu
- `npm run push:leads -- <dosya.json>` — müşteri adaylarını API'ye aktarır
