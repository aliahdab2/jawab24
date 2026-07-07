-- Before making (ecommerce_store_id, notification_type, platform_event_id) unique, any
-- pre-existing duplicate rows (from the old racy SELECT-then-INSERT path) would make the
-- CREATE UNIQUE INDEX fail. Neutralize them WITHOUT deleting audit rows: keep the earliest
-- row per key and NULL out platform_event_id on the rest — NULLs are distinct under the
-- unique index, so the audit trail (incl. any that were actually sent) is preserved.
UPDATE "customer_notifications_log" SET "platform_event_id" = NULL
WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", ROW_NUMBER() OVER (
			PARTITION BY "ecommerce_store_id", "notification_type", "platform_event_id"
			ORDER BY "created_at" ASC, "id" ASC
		) AS rn
		FROM "customer_notifications_log"
		WHERE "platform_event_id" IS NOT NULL
	) t
	WHERE t.rn > 1
);--> statement-breakpoint
DROP INDEX IF EXISTS "idx_cust_notif_log_store_type_event";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_cust_notif_log_store_type_event" ON "customer_notifications_log" ("ecommerce_store_id","notification_type","platform_event_id");