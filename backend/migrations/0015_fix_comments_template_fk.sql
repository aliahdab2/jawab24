-- Fix comments.template_id FK: change ON DELETE no action → ON DELETE set null
-- This prevents FK violations when deleting a user whose templates are cascade-deleted
-- while comments (referencing those templates) are cascade-deleted through a different path
ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_template_id_templates_id_fk";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
