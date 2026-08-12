-- «بوست اليوم» goes asynchronous.
--
-- Generation takes ~35s — seven times the 5s at which the industry standard
-- says return at once and notify — and nginx cuts this route at 30s, so the
-- synchronous shape could not work: on 2026-08-12 a merchant watched it fail
-- while the post was being created and their daily slot spent on it.
--
-- A request now claims its slot, stores a `pending` row and returns; a worker
-- fills it in. `status` therefore gains 'pending' and 'failed' alongside the
-- existing 'ready' and 'superseded'. Existing rows are all terminal states
-- already, so nothing needs backfilling.
--
-- `image_degraded` records why a READY row shipped text-only. It used to be
-- returned by the generate call and never stored, which only worked while that
-- call did the work; the worker finishes long after the request returned, so
-- the row is now the only place the answer can reach the client.
ALTER TABLE "post_suggestions" ADD COLUMN "failure_reason" varchar(40);--> statement-breakpoint
ALTER TABLE "post_suggestions" ADD COLUMN "image_degraded" varchar(20);--> statement-breakpoint
ALTER TABLE "post_suggestions" ADD COLUMN "fulfilled_at" timestamp;
