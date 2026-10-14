-- AI Growth Manager™: müşteri organizasyonları, kullanıcılar, entegrasyonlar, metrikler, içgörüler, brifler, eylem onayları.
-- CreateTable
CREATE TABLE "customer_organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "customer_id" UUID,
    "lead_id" VARCHAR(120),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "timezone" VARCHAR(40) NOT NULL DEFAULT 'Europe/Istanbul',
    "currency" CHAR(3) NOT NULL DEFAULT 'TRY',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_organizations_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "customer_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "name" VARCHAR(120),
    "role" VARCHAR(20) NOT NULL DEFAULT 'viewer',
    "status" VARCHAR(20) NOT NULL DEFAULT 'invited',
    "password_hash" TEXT,
    "invite_token_hash" CHAR(64),
    "invite_expires_at" TIMESTAMPTZ(6),
    "session_version" INTEGER NOT NULL DEFAULT 1,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_users_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "customer_integrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "external_account_id" VARCHAR(200),
    "display_name" VARCHAR(200),
    "encrypted_credentials" TEXT,
    "scopes" TEXT,
    "connected_by" VARCHAR(160),
    "connected_at" TIMESTAMPTZ(6),
    "last_sync_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_integrations_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "integration_syncs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "integration_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "range_start" DATE,
    "range_end" DATE,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    CONSTRAINT "integration_syncs_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "metric_daily" (
    "organization_id" UUID NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "date" DATE NOT NULL,
    "dimension_type" VARCHAR(20) NOT NULL,
    "dimension_key" VARCHAR(300) NOT NULL,
    "dimension_label" VARCHAR(300),
    "metrics" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "metric_daily_pkey" PRIMARY KEY ("organization_id","source","date","dimension_type","dimension_key")
);
-- CreateTable
CREATE TABLE "ai_insights" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "detector" VARCHAR(60) NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "assumptions" JSONB NOT NULL DEFAULT '[]',
    "confidence" DECIMAL(4,3) NOT NULL,
    "estimated_impact" JSONB,
    "suggested_action" TEXT NOT NULL,
    "priority" SMALLINT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "fingerprint" VARCHAR(200) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "daily_briefs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "brief_date" DATE NOT NULL,
    "content" JSONB NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "model" VARCHAR(60),
    "usage" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "daily_briefs_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "action_proposals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "insight_id" UUID,
    "action_type" VARCHAR(40) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(20) NOT NULL DEFAULT 'proposed',
    "decided_by" VARCHAR(160),
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "execution_result" JSONB,
    "rollback" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "action_proposals_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "customer_organizations_slug_key" ON "customer_organizations"("slug");
-- CreateIndex
CREATE UNIQUE INDEX "customer_users_email_key" ON "customer_users"("email");
-- CreateIndex
CREATE UNIQUE INDEX "customer_users_invite_token_hash_key" ON "customer_users"("invite_token_hash");
-- CreateIndex
CREATE INDEX "customer_users_org_idx" ON "customer_users"("organization_id");
-- CreateIndex
CREATE UNIQUE INDEX "customer_integrations_org_provider_key" ON "customer_integrations"("organization_id", "provider");
-- CreateIndex
CREATE INDEX "integration_syncs_integration_started_idx" ON "integration_syncs"("integration_id", "started_at" DESC);
-- CreateIndex
CREATE INDEX "metric_daily_org_source_type_date_idx" ON "metric_daily"("organization_id", "source", "dimension_type", "date");
-- CreateIndex
CREATE INDEX "ai_insights_org_status_priority_idx" ON "ai_insights"("organization_id", "status", "priority" DESC);
-- CreateIndex
CREATE UNIQUE INDEX "ai_insights_org_fingerprint_key" ON "ai_insights"("organization_id", "fingerprint");
-- CreateIndex
CREATE UNIQUE INDEX "daily_briefs_org_date_key" ON "daily_briefs"("organization_id", "brief_date");
-- CreateIndex
CREATE INDEX "action_proposals_org_status_idx" ON "action_proposals"("organization_id", "status");
-- AddForeignKey
ALTER TABLE "customer_users" ADD CONSTRAINT "customer_users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "customer_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "customer_integrations" ADD CONSTRAINT "customer_integrations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "customer_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "integration_syncs" ADD CONSTRAINT "integration_syncs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "customer_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "customer_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "daily_briefs" ADD CONSTRAINT "daily_briefs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "customer_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "action_proposals" ADD CONSTRAINT "action_proposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "customer_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_organizations" ADD CONSTRAINT "customer_organizations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "metric_daily" ADD CONSTRAINT "metric_daily_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "customer_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_organizations" ADD CONSTRAINT "customer_organizations_status_check" CHECK ("status" IN ('active','paused','closed'));
ALTER TABLE "customer_users" ADD CONSTRAINT "customer_users_role_check" CHECK ("role" IN ('owner','manager','viewer'));
ALTER TABLE "customer_users" ADD CONSTRAINT "customer_users_status_check" CHECK ("status" IN ('invited','active','disabled'));
ALTER TABLE "customer_users" ADD CONSTRAINT "customer_users_email_lower_check" CHECK ("email" = lower("email"));
ALTER TABLE "customer_integrations" ADD CONSTRAINT "customer_integrations_provider_check" CHECK ("provider" IN ('google_ads','ga4','search_console','crm'));
ALTER TABLE "customer_integrations" ADD CONSTRAINT "customer_integrations_status_check" CHECK ("status" IN ('pending','connected','error','disconnected','demo'));
ALTER TABLE "integration_syncs" ADD CONSTRAINT "integration_syncs_status_check" CHECK ("status" IN ('running','success','failed'));
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_kind_check" CHECK ("kind" IN ('money_leak','growth_opportunity','alert'));
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_severity_check" CHECK ("severity" IN ('critical','warning','info'));
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_status_check" CHECK ("status" IN ('open','acknowledged','resolved','dismissed','expired'));
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_confidence_check" CHECK ("confidence" BETWEEN 0 AND 1);
ALTER TABLE "action_proposals" ADD CONSTRAINT "action_proposals_status_check" CHECK ("status" IN ('proposed','approved','rejected','executed','failed'));
