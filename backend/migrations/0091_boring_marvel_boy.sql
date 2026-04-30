CREATE TABLE IF NOT EXISTS "email_unsubscribes" (
	"email" varchar(255) PRIMARY KEY NOT NULL,
	"unsubscribed_at" timestamp DEFAULT now() NOT NULL,
	"source" varchar(32)
);
