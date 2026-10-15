-- Zamanlanmış içerik türleri: hikâyeye ek olarak gönderi (image), karusel ve Reels. Yalnızca ekleme yapar:
-- mevcut satırlar (kind 'story', file_name) olduğu gibi kalır; media_files NULL ise file_name kullanılır.
ALTER TABLE "ig_scheduled_posts" DROP CONSTRAINT IF EXISTS "ig_scheduled_posts_kind_check";
ALTER TABLE "ig_scheduled_posts" ADD CONSTRAINT "ig_scheduled_posts_kind_check" CHECK ("kind" IN ('story', 'image', 'carousel', 'reels'));
ALTER TABLE "ig_scheduled_posts" ADD COLUMN IF NOT EXISTS "media_files" JSONB;
ALTER TABLE "ig_scheduled_posts" ADD COLUMN IF NOT EXISTS "cover_file" VARCHAR(120);
ALTER TABLE "ig_scheduled_posts" ADD COLUMN IF NOT EXISTS "child_container_ids" JSONB;
ALTER TABLE "ig_scheduled_posts" ADD COLUMN IF NOT EXISTS "container_created_at" TIMESTAMPTZ(6);
