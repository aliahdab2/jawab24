-- GA4 client id for server-side conversion attribution (Measurement Protocol).
-- Nullable and additive: existing users simply have no attribution id, which
-- degrades an MP send to "skipped", never to an error on their login path.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ga_client_id" varchar(64);
