-- Enable pgvector for embedding similarity search
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
-- Enable pg_trgm for keyword/trigram search fallback
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"language" varchar(10),
	"title" varchar(500),
	"content_original" text NOT NULL,
	"content_normalized" text NOT NULL,
	"title_normalized" varchar(500),
	"token_count" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"kb_version" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"query_text" text NOT NULL,
	"query_normalized" text NOT NULL,
	"detected_intent" varchar(50),
	"occurrence_count" integer DEFAULT 1,
	"first_seen_at" timestamp DEFAULT now(),
	"last_seen_at" timestamp DEFAULT now(),
	"resolved" boolean DEFAULT false
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kb_chunks_page_id" ON "kb_chunks" ("page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kb_chunks_type" ON "kb_chunks" ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kb_chunks_page_version" ON "kb_chunks" ("page_id","kb_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kb_gaps_page_id" ON "kb_gaps" ("page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kb_gaps_unresolved" ON "kb_gaps" ("page_id","resolved");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kb_gaps" ADD CONSTRAINT "kb_gaps_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Add vector column for embeddings (Drizzle doesn't support vector type natively)
ALTER TABLE "kb_chunks" ADD COLUMN "embedding" vector(512);--> statement-breakpoint
-- HNSW index for fast cosine similarity search on embeddings
CREATE INDEX IF NOT EXISTS "idx_kb_chunks_embedding" ON "kb_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
-- Trigram indexes for keyword search fallback
CREATE INDEX IF NOT EXISTS "idx_kb_chunks_content_trgm" ON "kb_chunks" USING gin ("content_normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kb_chunks_title_trgm" ON "kb_chunks" USING gin ("title_normalized" gin_trgm_ops);
