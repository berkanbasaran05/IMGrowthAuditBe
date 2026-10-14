CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "customers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "lead_id" VARCHAR(120), "name" VARCHAR(120) NOT NULL,
  "contact_name" VARCHAR(100), "email" VARCHAR(120), "phone" VARCHAR(40), "sector" VARCHAR(100),
  "owner_name" VARCHAR(80), "status" VARCHAR(24) NOT NULL DEFAULT 'onboarding', "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id"), CONSTRAINT "customers_status_check" CHECK ("status" IN ('onboarding','active','paused','completed','lost'))
);
CREATE UNIQUE INDEX "customers_lead_id_key" ON "customers"("lead_id");

CREATE TABLE "contracts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "customer_id" UUID NOT NULL, "title" VARCHAR(160) NOT NULL,
  "services" JSONB NOT NULL DEFAULT '[]', "value" DECIMAL(14,2) NOT NULL DEFAULT 0, "monthly_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL DEFAULT 'TRY', "billing" VARCHAR(20) NOT NULL DEFAULT 'one_time', "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "start_date" DATE, "end_date" DATE, "signed_at" DATE, "document_url" TEXT, "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contracts_pkey" PRIMARY KEY ("id"), CONSTRAINT "contracts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "contracts_customer_id_idx" ON "contracts"("customer_id");

CREATE TABLE "payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "customer_id" UUID NOT NULL, "contract_id" UUID,
  "amount" DECIMAL(14,2) NOT NULL, "currency" CHAR(3) NOT NULL DEFAULT 'TRY', "status" VARCHAR(20) NOT NULL DEFAULT 'planned',
  "due_date" DATE, "paid_at" DATE, "invoice_no" VARCHAR(80), "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"), CONSTRAINT "payments_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "payments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "payments_customer_id_idx" ON "payments"("customer_id");
CREATE INDEX "payments_due_status_idx" ON "payments"("due_date", "status");

CREATE TABLE "tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "customer_id" UUID NOT NULL, "title" VARCHAR(180) NOT NULL,
  "assignee" VARCHAR(80), "due_date" DATE, "status" VARCHAR(20) NOT NULL DEFAULT 'todo', "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tasks_pkey" PRIMARY KEY ("id"), CONSTRAINT "tasks_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "tasks_customer_id_status_idx" ON "tasks"("customer_id", "status");

CREATE TABLE "activities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "customer_id" UUID NOT NULL, "type" VARCHAR(50) NOT NULL DEFAULT 'note',
  "summary" TEXT NOT NULL, "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" VARCHAR(80),
  CONSTRAINT "activities_pkey" PRIMARY KEY ("id"), CONSTRAINT "activities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "activities_customer_id_occurred_idx" ON "activities"("customer_id", "occurred_at" DESC);

CREATE TABLE "key_values" ("key" TEXT NOT NULL, "value" TEXT NOT NULL, "expires_at" TIMESTAMPTZ, CONSTRAINT "key_values_pkey" PRIMARY KEY ("key"));
CREATE INDEX "key_values_expiry_idx" ON "key_values"("expires_at");
CREATE TABLE "hash_values" ("bucket" TEXT NOT NULL, "field" TEXT NOT NULL, "value" TEXT NOT NULL, CONSTRAINT "hash_values_pkey" PRIMARY KEY ("bucket", "field"));
CREATE TABLE "list_values" ("sequence" BIGSERIAL NOT NULL, "key" TEXT NOT NULL, "value" TEXT NOT NULL, "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "list_values_pkey" PRIMARY KEY ("sequence"));
CREATE INDEX "list_values_key_sequence_idx" ON "list_values"("key", "sequence" DESC);
