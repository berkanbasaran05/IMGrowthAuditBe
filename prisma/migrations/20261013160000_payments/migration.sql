-- Ödeme linkleri ve ödeme sağlayıcısı işlemleri. Mevcut tablolara dokunmaz.
-- CreateTable
CREATE TABLE "payment_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "token_hint" VARCHAR(12) NOT NULL,
    "created_by" VARCHAR(80),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "last_opened_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "conversation_id" VARCHAR(64) NOT NULL,
    "checkout_token" VARCHAR(200),
    "status" VARCHAR(20) NOT NULL DEFAULT 'initialized',
    "source" VARCHAR(20) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paid_price" DECIMAL(14,2),
    "installment" SMALLINT,
    "provider_payment_id" VARCHAR(80),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "payment_links_token_hash_key" ON "payment_links"("token_hash");
-- CreateIndex
CREATE INDEX "payment_links_payment_idx" ON "payment_links"("payment_id");
-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_conversation_id_key" ON "payment_transactions"("conversation_id");
-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_checkout_token_key" ON "payment_transactions"("checkout_token");
-- CreateIndex
CREATE INDEX "payment_transactions_payment_created_idx" ON "payment_transactions"("payment_id", "created_at" DESC);
-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_status_check" CHECK ("status" IN ('initialized','success','failure'));
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_source_check" CHECK ("source" IN ('portal','link'));
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_amount_check" CHECK ("amount" > 0);
