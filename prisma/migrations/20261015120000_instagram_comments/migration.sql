-- Instagram yorumdan DM'e: olay kaydı (idempotent) + konuşmada yanıt kapısı. Mevcut verilere dokunmaz.
ALTER TABLE "ig_conversations" ADD COLUMN "reply_gate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ig_conversations" ADD COLUMN "comment_media" VARCHAR(64);

CREATE TABLE "ig_comment_events" (
    "comment_id" VARCHAR(64) NOT NULL,
    "media_id" VARCHAR(64),
    "igsid" VARCHAR(64) NOT NULL,
    "username" VARCHAR(80),
    "action" VARCHAR(32) NOT NULL,
    "handled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ig_comment_events_pkey" PRIMARY KEY ("comment_id")
);
CREATE INDEX "ig_comment_events_igsid_idx" ON "ig_comment_events"("igsid", "handled_at");
