-- Marka Partneri asistanı konuşmaları: kalıcı kayıt ve panel listesi.
CREATE TABLE "assistant_conversations" (
    "id" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locale" VARCHAR(5) NOT NULL DEFAULT 'tr',
    "ip_hash" CHAR(64),
    "lead_id" VARCHAR(120),
    "company" VARCHAR(200),
    "sector" VARCHAR(200),
    "audit_domain" VARCHAR(255),
    "first_message" VARCHAR(300),
    "user_turns" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assistant_conversations_updated_idx" ON "assistant_conversations"("updated_at" DESC);
CREATE INDEX "assistant_conversations_lead_idx" ON "assistant_conversations"("lead_id");

-- Önceki sürümün key_values içinde tuttuğu konuşmalar (assistant:<id>) yeni tabloya taşınır.
INSERT INTO "assistant_conversations" ("id", "created_at", "updated_at", "locale", "lead_id", "company", "sector", "audit_domain", "first_message", "user_turns", "cost_usd", "data")
SELECT
    substr(k."key", 11),
    COALESCE((k."value"::jsonb ->> 'createdAt')::timestamptz, CURRENT_TIMESTAMP),
    COALESCE((k."value"::jsonb ->> 'updatedAt')::timestamptz, CURRENT_TIMESTAMP),
    COALESCE(k."value"::jsonb ->> 'locale', 'tr'),
    k."value"::jsonb ->> 'leadId',
    left(k."value"::jsonb -> 'profile' ->> 'firma', 200),
    left(k."value"::jsonb -> 'profile' ->> 'sektor', 200),
    left(k."value"::jsonb -> 'audit' ->> 'domain', 255),
    left((SELECT v ->> 'text' FROM jsonb_array_elements(k."value"::jsonb -> 'view') v WHERE v ->> 'role' = 'user' LIMIT 1), 300),
    COALESCE((k."value"::jsonb ->> 'userTurns')::int, 0),
    COALESCE((k."value"::jsonb -> 'usage' ->> 'costUsd')::double precision, 0),
    k."value"::jsonb
FROM "key_values" k
WHERE k."key" LIKE 'assistant:%' AND length(k."key") = 42;

DELETE FROM "key_values" WHERE "key" LIKE 'assistant:%' AND length("key") = 42;
