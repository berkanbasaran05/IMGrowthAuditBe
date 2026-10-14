-- Müşteri profili: iletişim, sosyal medya, hesap bilgileri, hizmet ve tahsilat tarihleri. Mevcut verilere dokunmaz.
ALTER TABLE "customers"
  ADD COLUMN "website" VARCHAR(200),
  ADD COLUMN "address" TEXT,
  ADD COLUMN "tax_office" VARCHAR(100),
  ADD COLUMN "tax_no" VARCHAR(40),
  ADD COLUMN "social" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "contacts" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "accounts" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "service_start" DATE,
  ADD COLUMN "ad_start" DATE,
  ADD COLUMN "ad_budget" DECIMAL(14,2),
  ADD COLUMN "billing_day" SMALLINT,
  ADD COLUMN "next_payment_date" DATE;
