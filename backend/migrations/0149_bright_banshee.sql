-- drizzle-kit v5→v7 meta upgrade artifact, hand-trimmed.
-- Kit 0.20 (snapshot v5) could not represent CHECK constraints or partial-index
-- WHERE clauses, so the first v7 generate re-proposed 9 objects. Seven already
-- exist in prod (added by 0108, 0112, 0147 — re-ADDing would fail: Postgres has
-- no ADD CONSTRAINT IF NOT EXISTS) and were removed from this file; the 0149
-- snapshot still records them, so future generates stay clean. The two below
-- were declared in schema.ts but never migrated (v5 kit silently ignored
-- check()) — verified missing from prod, and existing rows verified compliant
-- (only 'salla'/'shopify' present).
DO $$ BEGIN
 ALTER TABLE "ecommerce_stores" ADD CONSTRAINT "ecommerce_stores_platform_check" CHECK ("platform" in ('shopify', 'salla', 'zid'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pending_ecommerce_installs" ADD CONSTRAINT "pending_ecommerce_installs_platform_check" CHECK ("platform" in ('shopify', 'salla', 'zid'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
