-- Collapse duplicate (user_id, token) rows BEFORE the unique index, or the
-- CREATE below aborts the whole migration on any database that already has one.
--
-- Duplicates exist because registerDeviceToken was a non-transactional
-- check-then-insert against a table with no unique constraint: two concurrent
-- registrations of the same token both read zero rows and both inserted. The
-- keeper is the freshest row per pair — last_used_at, then created_at, then id
-- as a deterministic tie-break. NULLS LAST matters: both timestamps are
-- nullable, and a NULL-vs-NULL comparison would otherwise leave the pair intact
-- and fail the index.
DELETE FROM "device_tokens"
WHERE "id" IN (
    SELECT "id" FROM (
        SELECT "id",
               row_number() OVER (
                   PARTITION BY "user_id", "token"
                   ORDER BY "last_used_at" DESC NULLS LAST,
                            "created_at"   DESC NULLS LAST,
                            "id"           DESC
               ) AS rn
        FROM "device_tokens"
    ) ranked
    WHERE ranked.rn > 1
);
--> statement-breakpoint
-- Not CONCURRENTLY: drizzle runs each migration inside a transaction, and
-- CREATE INDEX CONCURRENTLY cannot run in one. device_tokens holds roughly one
-- row per user per device, so the brief lock is not worth splitting the
-- migration in two to avoid.
CREATE UNIQUE INDEX "idx_device_tokens_user_token" ON "device_tokens" USING btree ("user_id","token");
