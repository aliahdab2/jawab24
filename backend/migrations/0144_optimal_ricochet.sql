-- The validation contract (CurrencyInput, CATALOG_CURRENCY_MAX = 30) promises
-- that a long currency label is TRUNCATED to 30, never rejected — the Syrian
-- «ل.س بالعملة القديمة» qualifier is load-bearing (old-vs-new lira is a 100×
-- distinction). Both columns were still varchar(10), so any currency between
-- 11 and 30 chars passed validation and then CRASHED the insert. Found while
-- building the G1b list editor (2026-07-31); pre-existing on the catalog path.
-- (Re-generated via drizzle-kit after a hand-written 0144 shipped without its
-- snapshot and broke the pre-deploy drift check.)
ALTER TABLE "catalog_items" ALTER COLUMN "currency" SET DATA TYPE varchar(30);--> statement-breakpoint
ALTER TABLE "fact_rows" ALTER COLUMN "currency" SET DATA TYPE varchar(30);