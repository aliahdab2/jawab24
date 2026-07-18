-- Partial indexes for "Post Replies sent" counts (admin customer detail,
-- dashboard breakdown). These queries filter replied = true AND
-- reply_method = 'post_reply' across full table history; without an index
-- they scan the whole partition (messages is 200k+ rows in production).
-- Partial indexes stay tiny (only post_reply rows) and make the counts
-- index-only lookups. Hand-written: drizzle-kit 0.20 can't express partial
-- indexes in schema.ts — keep these in sync manually if the columns change.
CREATE INDEX IF NOT EXISTS "idx_messages_post_reply_page" ON "messages" ("page_id") WHERE "replied" = true AND "reply_method" = 'post_reply';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comments_post_reply_post" ON "comments" ("post_id") WHERE "replied" = true AND "reply_method" = 'post_reply';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_instagram_comments_post_reply_media" ON "instagram_comments" ("media_id") WHERE "replied" = true AND "reply_method" = 'post_reply';
