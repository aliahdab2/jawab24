CREATE INDEX IF NOT EXISTS "idx_comments_created_at" ON "comments" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comments_created_time" ON "comments" ("created_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_instagram_comments_created_at" ON "instagram_comments" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_instagram_comments_created_time" ON "instagram_comments" ("created_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_replied" ON "messages" ("replied");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_created_at" ON "messages" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_created_time" ON "messages" ("created_time");