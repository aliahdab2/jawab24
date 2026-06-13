CREATE TABLE IF NOT EXISTS "activation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "activation_events_user_event_idx" ON "activation_events" ("user_id","event");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_events_created_at_idx" ON "activation_events" ("created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activation_events" ADD CONSTRAINT "activation_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
