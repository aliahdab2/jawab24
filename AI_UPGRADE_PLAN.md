# Jawab24 Smart AI Upgrade Plan

## Goal

Transform Jawab24 from a "static KB injector" (sends entire `knowledgeBase` text capped at 1500 chars into every GPT prompt with exact-match SHA-256 cache) into a RAG-powered business AI brain with pgvector, Arabic-aware normalization, semantic caching, and speed optimizations.

---

## PR Progress

| PR | Scope | Status | Key Files |
|----|-------|--------|-----------|
| **PR1** | Shared utilities: Arabic normalization + sanitization | **Done** | `packages/shared/src/utils/arabic-normalize.ts`, `sanitize.ts`, `sanitize-kb.ts` + tests |
| **PR2** | KB versioning + business profile + category defaults | **Done** | Migration 0017, `schema.ts` (pages: kb_version + business_profile), `pages.ts` bump logic, `category-defaults.ts` + 35 tests |
| **PR3** | DB extensions + kb_chunks + kb_gaps + interfaces | **Done** | Migration 0018 (pgvector, pg_trgm, kb_chunks, kb_gaps tables), `interfaces.ts` (EmbeddingProvider, VectorStore) |
| **PR4** | Ingestion pipeline | **Done** | `chunker.ts`, `embedding.ts`, `pgvector-store.ts`, `ingestion.ts` + 26 tests, `openai` dep added |
| **PR5** | Retrieval + wiring into reply flow | **Done** | `retrieval.ts`, `generator.ts` uses chunks, `openai.ts` uses `<business_knowledge>`, `RAG_MODE` flag, ingestion wired into `pages.ts` KB save + sync |
| **PR6** | Semantic cache + intent detector | **Done** | `semantic-cache.ts`, `intent-detector.ts`, cache flow in `ai.ts`, `RAG_MODE` default changed to `on` |
| **PR7** | Gap detection + monitoring | **Done** (backend) | `gap-detector.ts`, notifications, `NOTIFICATION_THRESHOLD` lowered to 3. Frontend dashboard deferred to post-launch. |
| **PR8** | Speed + scaling | Pending | Parallel execution, fast paths, worker concurrency 5->15 |

**Dependencies:** PR1 -> PR2 -> PR3 -> PR4 -> PR5 -> PR6/PR7 (parallel) -> PR8

---

## Architecture Overview

```
Customer message
       |
       v
[Exact cache check] ──hit──> return cached reply
       |miss
       v
[Normalize + Embed query]
       |
       v
[Semantic cache check] ──hit──> return cached reply
       |miss
       v
[Hybrid retrieval: vector (HNSW) + trigram (pg_trgm)]
       |
       v
[Top 3-5 chunks + businessProfile + conversation history]
       |
       v
[GPT (ai-worker)] ──> reply + intent + confidence
       |
       v
[Save to semantic cache] + [Log gap if no good chunks]
```

## Key Design Decisions

### KB Versioning (no empty windows)
- `kbVersion` bumps on every KB change
- `kbActiveVersion` set only after ingestion completes
- Retrieval always filters by `kbActiveVersion` -> never uses partially-ingested chunks
- Old version chunks cleaned up separately

### Hybrid Search
- Vector similarity (HNSW, cosine, 512-dim embeddings) for semantic matching
- Trigram (pg_trgm GIN index) for keyword fallback
- Score fusion: `0.7 * vec_score + 0.3 * text_score + language_boost`

### Category Defaults
- Safe fallback responses per business type (restaurant, clothing, salon, etc.)
- Used when retrieval returns no good chunks
- Never invents facts — asks clarifying questions instead

### Feature Flag
```
RAG_MODE = off | shadow | on
```
- `off`: Current behavior (static KB)
- `shadow`: Run RAG pipeline but still use static KB for actual replies (log comparison)
- `on`: Full RAG active

---

## Schema Changes

### Migration 0017 (PR2): KB versioning + business profile
```sql
ALTER TABLE pages ADD COLUMN kb_version integer DEFAULT 1;
ALTER TABLE pages ADD COLUMN kb_active_version integer DEFAULT 1;
ALTER TABLE pages ADD COLUMN kb_updated_at timestamp;
ALTER TABLE pages ADD COLUMN business_profile jsonb DEFAULT '{}'::jsonb;
ALTER TABLE pages ADD COLUMN business_profile_updated_at timestamp;
```

### Migration 0018 (PR3): pgvector + kb_chunks + kb_gaps
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- kb_chunks: chunked KB content with embeddings
CREATE TABLE kb_chunks (
  id uuid PRIMARY KEY,
  page_id uuid REFERENCES pages(id) ON DELETE CASCADE,
  type varchar(50),          -- 'offering', 'policy', 'faq', 'info', 'hours', 'location'
  language varchar(10),
  title varchar(500),
  content_original text,
  content_normalized text,   -- normalizeArabic() applied
  title_normalized varchar(500),
  token_count integer,
  metadata jsonb,
  embedding vector(512),     -- text-embedding-3-small
  kb_version integer,
  created_at timestamp,
  updated_at timestamp
);
-- HNSW index for vector search
-- GIN trigram indexes for keyword search

-- kb_gaps: tracks unanswered questions
CREATE TABLE kb_gaps (
  id uuid PRIMARY KEY,
  page_id uuid REFERENCES pages(id) ON DELETE CASCADE,
  query_text text,
  query_normalized text,
  detected_intent varchar(50),
  occurrence_count integer DEFAULT 1,
  first_seen_at timestamp,
  last_seen_at timestamp,
  resolved boolean DEFAULT false
);
```

### Migration 0019 (PR6): Semantic cache
```sql
CREATE TABLE semantic_cache (
  id uuid PRIMARY KEY,
  page_id uuid REFERENCES pages(id) ON DELETE CASCADE,
  query_text text,
  query_embedding vector(512),
  intent varchar(50),
  reply_text text,
  metadata jsonb,
  kb_active_version_at_creation integer,
  created_at timestamp
);
-- HNSW index on query_embedding
```
