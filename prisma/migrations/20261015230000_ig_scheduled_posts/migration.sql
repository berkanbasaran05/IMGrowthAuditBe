-- Zamanlanmış Instagram hikâyeleri (kind 'story'). İşçi dakikada bir zamanı gelen 'queued' satırları yayınlar. Mevcut verilere dokunmaz.
CREATE TABLE "ig_scheduled_posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" VARCHAR(16) NOT NULL DEFAULT 'story',
    "file_name" VARCHAR(120) NOT NULL,
    "caption" TEXT,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "container_id" VARCHAR(64),
    "media_id" VARCHAR(64),
    "error" VARCHAR(500),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ig_scheduled_posts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ig_scheduled_posts_status_check" CHECK ("status" IN ('queued', 'publishing', 'published', 'failed', 'canceled')),
    CONSTRAINT "ig_scheduled_posts_kind_check" CHECK ("kind" IN ('story'))
);
CREATE INDEX "ig_scheduled_posts_status_idx" ON "ig_scheduled_posts"("status", "scheduled_at");
