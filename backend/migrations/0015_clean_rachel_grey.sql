ALTER TABLE "comments" DROP CONSTRAINT "comments_template_id_templates_id_fk";
--> statement-breakpoint
ALTER TABLE "pending_shopify_installs" DROP CONSTRAINT "pending_shopify_installs_claimed_by_user_id_users_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pending_shopify_installs" ADD CONSTRAINT "pending_shopify_installs_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
