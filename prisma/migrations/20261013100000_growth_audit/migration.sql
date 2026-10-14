-- Growth Audit™ tabloları. Mevcut CRM ve uyumluluk tablolarına dokunmaz.
-- CreateTable
CREATE TABLE "growth_audits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lead_id" VARCHAR(120) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'queued',
    "stage" VARCHAR(60),
    "progress" SMALLINT NOT NULL DEFAULT 0,
    "website_url" TEXT,
    "final_url" TEXT,
    "scoring_version" VARCHAR(20) NOT NULL,
    "overall_score" DECIMAL(5,2),
    "coverage" DECIMAL(4,3),
    "confidence" DECIMAL(4,3),
    "category_scores" JSONB NOT NULL DEFAULT '[]',
    "summary" JSONB,
    "ai_model" VARCHAR(60),
    "prompt_version" VARCHAR(20),
    "usage" JSONB NOT NULL DEFAULT '{}',
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "max_attempts" SMALLINT NOT NULL DEFAULT 3,
    "next_attempt_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "triggered_by" VARCHAR(80),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_metric_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "audit_id" UUID NOT NULL,
    "metric_id" VARCHAR(60) NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "weight" DECIMAL(6,3) NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "state" VARCHAR(20) NOT NULL,
    "original_score" DECIMAL(5,2),
    "reviewer_score" DECIMAL(5,2),
    "final_score" DECIMAL(5,2),
    "confidence" DECIMAL(4,3),
    "reason" TEXT,
    "recommendation" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "rubric_version" VARCHAR(20) NOT NULL,
    "model_version" VARCHAR(60),
    "prompt_version" VARCHAR(20),
    "review_reason" TEXT,
    "evaluated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_metric_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "audit_id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "source_url" TEXT,
    "title" VARCHAR(200),
    "data" JSONB NOT NULL DEFAULT '{}',
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_opportunities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "audit_id" UUID NOT NULL,
    "lead_id" VARCHAR(120) NOT NULL,
    "metric_ids" JSONB NOT NULL DEFAULT '[]',
    "title" VARCHAR(200) NOT NULL,
    "problem" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "impact" VARCHAR(20) NOT NULL,
    "basis" VARCHAR(20) NOT NULL DEFAULT 'observed',
    "confidence" DECIMAL(4,3) NOT NULL,
    "difficulty" VARCHAR(20) NOT NULL,
    "action" TEXT NOT NULL,
    "service" VARCHAR(80),
    "priority_score" SMALLINT NOT NULL,
    "priority_group" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "audit_id" UUID NOT NULL,
    "metric_id" VARCHAR(60) NOT NULL,
    "previous_score" DECIMAL(5,2),
    "reviewer_score" DECIMAL(5,2),
    "reason" TEXT NOT NULL,
    "reviewer" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "growth_audits_lead_created_idx" ON "growth_audits"("lead_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "growth_audits_status_next_idx" ON "growth_audits"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_metric_results_audit_metric_key" ON "audit_metric_results"("audit_id", "metric_id");

-- CreateIndex
CREATE INDEX "audit_evidence_audit_kind_idx" ON "audit_evidence"("audit_id", "kind");

-- CreateIndex
CREATE INDEX "growth_opportunities_audit_priority_idx" ON "growth_opportunities"("audit_id", "priority_score" DESC);

-- CreateIndex
CREATE INDEX "growth_opportunities_lead_status_idx" ON "growth_opportunities"("lead_id", "status");

-- CreateIndex
CREATE INDEX "audit_reviews_audit_metric_idx" ON "audit_reviews"("audit_id", "metric_id");


-- AddForeignKey
ALTER TABLE "audit_metric_results" ADD CONSTRAINT "audit_metric_results_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "growth_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_evidence" ADD CONSTRAINT "audit_evidence_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "growth_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_opportunities" ADD CONSTRAINT "growth_opportunities_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "growth_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_reviews" ADD CONSTRAINT "audit_reviews_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "growth_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Durum ve puan aralığı kısıtları
ALTER TABLE "growth_audits" ADD CONSTRAINT "growth_audits_status_check"
  CHECK ("status" IN ('queued','running','completed','failed','no_verified_website','cancelled'));
ALTER TABLE "growth_audits" ADD CONSTRAINT "growth_audits_score_check" CHECK ("overall_score" IS NULL OR "overall_score" BETWEEN 0 AND 100);
ALTER TABLE "audit_metric_results" ADD CONSTRAINT "audit_metric_results_state_check"
  CHECK ("state" IN ('MEASURED','ESTIMATED','UNKNOWN','NOT_APPLICABLE','FAILED'));
ALTER TABLE "audit_metric_results" ADD CONSTRAINT "audit_metric_results_score_check" CHECK (
  ("original_score" IS NULL OR "original_score" BETWEEN 0 AND 100) AND
  ("reviewer_score" IS NULL OR "reviewer_score" BETWEEN 0 AND 100) AND
  ("final_score" IS NULL OR "final_score" BETWEEN 0 AND 100));
ALTER TABLE "growth_opportunities" ADD CONSTRAINT "growth_opportunities_priority_check" CHECK ("priority_score" BETWEEN 0 AND 100);

-- Aynı firma için eşzamanlı ikinci denetim açılamaz (kuyrukta veya çalışan en fazla bir kayıt)
CREATE UNIQUE INDEX "growth_audits_one_active_per_lead" ON "growth_audits"("lead_id") WHERE "status" IN ('queued','running');
