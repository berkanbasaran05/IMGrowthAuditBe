-- Marka Partneri: görsel yüklemeleri ve iş analizi raporları.
CREATE TABLE "assistant_uploads" (
    "id" UUID NOT NULL,
    "conversation_id" VARCHAR(32) NOT NULL,
    "mime" VARCHAR(40) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_uploads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assistant_uploads_conversation_idx" ON "assistant_uploads"("conversation_id");

CREATE TABLE "business_reports" (
    "id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "conversation_id" VARCHAR(32) NOT NULL,
    "lead_id" VARCHAR(120),
    "kind" VARCHAR(32) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "overall_score" INTEGER NOT NULL,
    "locale" VARCHAR(5) NOT NULL DEFAULT 'tr',
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_reports_token_hash_key" ON "business_reports"("token_hash");
CREATE INDEX "business_reports_conversation_idx" ON "business_reports"("conversation_id");
