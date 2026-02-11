CREATE TABLE IF NOT EXISTS "semantic_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"query_text" text NOT NULL,
	"intent" varchar(50) NOT NULL,
	"reply_text" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"kb_active_version_at_creation" integer NOT NULL,
	"hit_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_semantic_cache_page_id" ON "semantic_cache" ("page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_semantic_cache_intent" ON "semantic_cache" ("intent");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_semantic_cache_page_version" ON "semantic_cache" ("page_id","kb_active_version_at_creation");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "semantic_cache" ADD CONSTRAINT "semantic_cache_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Below: manual additions for types Drizzle cannot generate natively

-- pgvector column for semantic cache (query embedding)
ALTER TABLE "semantic_cache" ADD COLUMN IF NOT EXISTS "query_embedding" vector(512);

-- HNSW index for fast vector similarity search on semantic cache
CREATE INDEX IF NOT EXISTS idx_semantic_cache_embedding
    ON semantic_cache USING hnsw (query_embedding vector_cosine_ops);

-- Timestamp index for TTL-based cache expiry
CREATE INDEX IF NOT EXISTS idx_semantic_cache_created_at
    ON semantic_cache (created_at);

-- pg_trgm GIN index on kb_gaps.query_normalized for similarity() deduplication
CREATE INDEX IF NOT EXISTS idx_kb_gaps_query_trgm
    ON kb_gaps USING gin (query_normalized gin_trgm_ops);
