-- PR6: Semantic cache table for vector-based reply caching
-- Enables cache hits for semantically similar questions (not just exact matches)

CREATE TABLE IF NOT EXISTS semantic_cache (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    query_text text NOT NULL,
    query_embedding vector(512),
    intent varchar(50) NOT NULL,
    reply_text text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    kb_active_version_at_creation integer NOT NULL,
    hit_count integer DEFAULT 0,
    created_at timestamp DEFAULT now()
);

-- HNSW index for fast vector similarity search
CREATE INDEX IF NOT EXISTS idx_semantic_cache_embedding
    ON semantic_cache USING hnsw (query_embedding vector_cosine_ops);

-- Lookup indexes
CREATE INDEX IF NOT EXISTS idx_semantic_cache_page_id ON semantic_cache (page_id);
CREATE INDEX IF NOT EXISTS idx_semantic_cache_intent ON semantic_cache (intent);
CREATE INDEX IF NOT EXISTS idx_semantic_cache_page_version ON semantic_cache (page_id, kb_active_version_at_creation);
