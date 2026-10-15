-- Panel bildirimlerinin okundu bilgisi. Bildirimler anlık hesaplanır; burada yalnızca okunanlar tutulur.
CREATE TABLE "notification_reads" (
    "key" VARCHAR(200) NOT NULL,
    "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("key")
);
