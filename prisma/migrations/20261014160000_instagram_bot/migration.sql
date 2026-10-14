-- Instagram DM analiz botu: konuşma durumu. Mevcut tablolara dokunmaz.
-- public_token: herkese açık analiz sorgu belirteci (rapor bağlantısını yeniden üretmek için); yalnızca sonuç gönderilene kadar tutulur.
CREATE TABLE "ig_conversations" (
    "igsid" VARCHAR(64) NOT NULL,
    "username" VARCHAR(80),
    "state" VARCHAR(20) NOT NULL DEFAULT 'idle',
    "domain" VARCHAR(255),
    "lead_id" VARCHAR(120),
    "audit_id" UUID,
    "public_token" VARCHAR(64),
    "last_score" INTEGER,
    "last_mid" VARCHAR(255),
    "audits_day" CHAR(10),
    "audits_today" INTEGER NOT NULL DEFAULT 0,
    "audits_total" INTEGER NOT NULL DEFAULT 0,
    "messages_in" INTEGER NOT NULL DEFAULT 0,
    "handoff_until" TIMESTAMPTZ(6),
    "last_inbound_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ig_conversations_pkey" PRIMARY KEY ("igsid"),
    CONSTRAINT "ig_conversations_state_check" CHECK ("state" IN ('idle', 'awaiting_url', 'auditing', 'sending', 'result_sent', 'handoff'))
);
CREATE INDEX "ig_conversations_state_updated_idx" ON "ig_conversations"("state", "updated_at");
