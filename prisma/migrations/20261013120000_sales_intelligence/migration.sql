-- Satış zekâsı: müşteri rapor bağlantıları ve satış taslakları. Mevcut tablolara dokunmaz.
-- CreateTable
CREATE TABLE "audit_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "audit_id" UUID NOT NULL,
    "lead_id" VARCHAR(120) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "token_hint" VARCHAR(12) NOT NULL,
    "created_by" VARCHAR(80),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "last_viewed_at" TIMESTAMPTZ(6),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_reports_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "sales_drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lead_id" VARCHAR(120) NOT NULL,
    "audit_id" UUID,
    "kind" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "source" VARCHAR(20) NOT NULL,
    "content" JSONB NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "model" VARCHAR(60),
    "prompt_version" VARCHAR(20),
    "usage" JSONB NOT NULL DEFAULT '{}',
    "created_by" VARCHAR(80),
    "applied_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_drafts_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "audit_reports_token_hash_key" ON "audit_reports"("token_hash");
-- CreateIndex
CREATE INDEX "audit_reports_lead_created_idx" ON "audit_reports"("lead_id", "created_at" DESC);
-- CreateIndex
CREATE INDEX "sales_drafts_lead_kind_created_idx" ON "sales_drafts"("lead_id", "kind", "created_at" DESC);
-- AddForeignKey
-- AddForeignKey
ALTER TABLE "audit_reports" ADD CONSTRAINT "audit_reports_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "growth_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "sales_drafts" ADD CONSTRAINT "sales_drafts_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "growth_audits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_drafts" ADD CONSTRAINT "sales_drafts_kind_check" CHECK ("kind" IN ('email','call_brief'));
ALTER TABLE "sales_drafts" ADD CONSTRAINT "sales_drafts_status_check" CHECK ("status" IN ('draft','applied','discarded'));
ALTER TABLE "sales_drafts" ADD CONSTRAINT "sales_drafts_source_check" CHECK ("source" IN ('ai','template'));
ALTER TABLE "growth_opportunities" ADD CONSTRAINT "growth_opportunities_status_check" CHECK ("status" IN ('open','accepted','in_progress','done','dismissed'));
