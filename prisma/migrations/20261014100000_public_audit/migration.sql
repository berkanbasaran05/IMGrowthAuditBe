-- Ücretsiz dijital analiz: herkese açık formdan gelen denetim talepleri. Mevcut tablolara dokunmaz.
-- Sorgu belirteci yalnızca SHA-256 özetiyle saklanır; IP adresi tuzlu özet olarak tutulur.
CREATE TABLE "public_audit_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" CHAR(64) NOT NULL,
    "lead_id" VARCHAR(120) NOT NULL,
    "audit_id" UUID,
    "report_id" UUID,
    "source" VARCHAR(20) NOT NULL,
    "locale" VARCHAR(5) NOT NULL DEFAULT 'tr',
    "ip_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "public_audit_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "public_audit_requests_source_check" CHECK ("source" IN ('web', 'instagram')),
    CONSTRAINT "public_audit_requests_locale_check" CHECK ("locale" IN ('tr', 'en'))
);
CREATE UNIQUE INDEX "public_audit_requests_token_hash_key" ON "public_audit_requests"("token_hash");
CREATE INDEX "public_audit_requests_lead_created_idx" ON "public_audit_requests"("lead_id", "created_at" DESC);
