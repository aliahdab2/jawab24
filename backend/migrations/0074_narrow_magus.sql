ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_template_id_templates_id_fk";
--> statement-breakpoint
ALTER TABLE "comments" DROP COLUMN IF EXISTS "template_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "rules";--> statement-breakpoint
DROP TABLE IF EXISTS "templates";--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN IF EXISTS "max_templates";--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN IF EXISTS "max_rules";