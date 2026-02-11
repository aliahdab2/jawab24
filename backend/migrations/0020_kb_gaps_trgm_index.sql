-- PR7: Add trigram index on kb_gaps.query_normalized for similarity() deduplication
-- Without this index, findSimilarGap() does a sequential scan on all unresolved gaps

CREATE INDEX IF NOT EXISTS idx_kb_gaps_query_trgm
    ON kb_gaps USING gin (query_normalized gin_trgm_ops);
