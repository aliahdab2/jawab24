DROP TABLE "rules";--> statement-breakpoint
DROP TABLE "templates";--> statement-breakpoint
ALTER TABLE "comments" DROP CONSTRAINT "comments_template_id_templates_id_fk";
--> statement-breakpoint
ALTER TABLE "comments" DROP COLUMN IF EXISTS "template_id";--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN IF EXISTS "max_templates";--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN IF EXISTS "max_rules";