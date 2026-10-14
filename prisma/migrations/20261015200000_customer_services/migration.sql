-- Müşteri hizmet/paket/ücret alanları ve logo. Mevcut verilere dokunmaz.
ALTER TABLE "customers"
  ADD COLUMN "services" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "package_name" VARCHAR(120),
  ADD COLUMN "site_fee" DECIMAL(14,2),
  ADD COLUMN "ad_service_fee" DECIMAL(14,2),
  ADD COLUMN "daily_ad_budget" DECIMAL(14,2),
  ADD COLUMN "logo" TEXT;
