ALTER TABLE "instagram_media" ADD COLUMN "trigger_image_url" text;--> statement-breakpoint
ALTER TABLE "instagram_media" ADD COLUMN "trigger_image_key" text;--> statement-breakpoint
ALTER TABLE "instagram_media" ADD COLUMN "trigger_image_bytes" integer;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "trigger_image_url" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "trigger_image_key" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "trigger_image_bytes" integer;