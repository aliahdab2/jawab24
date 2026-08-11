ALTER TABLE "ecommerce_stores" ADD COLUMN "embedded_token_last_used_at" timestamp;--> statement-breakpoint
CREATE INDEX "idx_users_email_lower" ON "users" USING btree (lower("email"));