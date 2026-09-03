-- Retire the SMS delivery rail: WhatsApp is the only customer-notification
-- channel (D-123 — the Vonage provider was dropped by owner ruling 2026-08-25).
--
-- Two steps, and both are needed. The default governs every store seeded from
-- now on; the backfill governs the rows that already exist, which all carry
-- 'sms' and would otherwise route to a rail whose code is gone.
--
-- Measured before writing (production, read-only, 2026-09-03): 12 template rows,
-- every one channel='sms' AND is_enabled=false, and customer_notifications_log
-- is empty. So the backfill changes no observable behaviour today — it removes a
-- dead default before a merchant can switch a type on and hit it.
ALTER TABLE "customer_notification_templates" ALTER COLUMN "channel" SET DEFAULT 'whatsapp';
--> statement-breakpoint
UPDATE "customer_notification_templates" SET "channel" = 'whatsapp' WHERE "channel" = 'sms';
