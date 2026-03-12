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
| **PR7** | Gap detection + monitoring | **Done** (backend) | `gap-detector.ts`, notifications, `NOTIFICATION_THRESHOLD` = 3. Frontend dashboard deferred to post-launch. |
| **PR8** | Speed + scaling | **Pending** | Parallel execution, fast paths, worker concurrency tuning |

**Dependencies:** PR1 -> PR2 -> PR3 -> PR4 -> PR5 -> PR6/PR7 (parallel) -> PR8

---

## Architecture Overview

```
Customer message
       |
       v
[Exact cache check (SHA-256, scoped by kbActiveVersion + replyStyle + customerContext)]
       |hit -> return cached reply
       |miss
       v
[Query enrichment: vague follow-ups enriched with last assistant reply (100 chars, capped 300)]
       |
       v
[Normalize + Embed query (text-embedding-3-small, 512-dim)]
       |
       v
[Semantic cache check (intent-aware thresholds, scoped by PROMPT_VERSION)]
       |hit -> return cached reply
       |miss
       v
[Hybrid retrieval: vector (HNSW cosine) + trigram (pg_trgm GIN)]
       |
       v
[Top 3-5 chunks + businessProfile + conversation history + customerContext]
       |
       v
[GPT (ai-worker)] --> reply + intent + confidence
       |
       v
[Save to semantic cache] + [Log gap if no good chunks (notify merchant at threshold 3)]
```

---

## Key Design Decisions

### KB Versioning (no empty windows)
- `kbVersion` bumps on every KB change
- `kbActiveVersion` set only after ingestion completes
- Retrieval always filters by `kbActiveVersion` -> never uses partially-ingested chunks
- Old version chunks cleaned up separately

### Hybrid Search
- Vector similarity (HNSW, cosine, 512-dim embeddings via `text-embedding-3-small`) for semantic matching
- Trigram (pg_trgm GIN index) for keyword fallback
- Score fusion: `0.7 * vec_score + 0.3 * text_score + language_boost`
- Minimum score threshold: `0.3`, default top-k: `5`

### Query Enrichment (added post-plan)
- Vague follow-up messages (e.g., "وش المدة؟") get enriched with the last assistant reply (up to 100 chars) before embedding
- Total enriched query capped at 300 chars
- Improves retrieval accuracy for conversational follow-ups

### Customer Awareness (added post-plan, PROMPT_VERSION v18+)
- `getCustomerSummary()` in `messages.ts` queries existing messages table for returning customer info
- `customerContext` string (e.g., "Customer name: محمد. Returning customer...") passed in system prompt
- GPT naturally uses customer name and history — no forced greeting instructions
- Exact cache key includes `customerContext` MD5 hash
- Semantic cache skipped when `customerContext` is provided (personalized replies need fresh generation)

### Semantic Cache Intelligence (refined post-plan)
- Intent-aware similarity thresholds: `0.88` to `0.95` depending on intent type
- Skips cache entirely for `PRICE` and `PURCHASE_INTENT` intents (too context-dependent)
- Scoped by `PROMPT_VERSION` (currently `v21`) — cache auto-invalidates on prompt changes
- Tracks `hitCount` per entry for analytics

### Intent Detection (pre-GPT, rule-based)
- 9 intent types: `GREETING`, `PRICE`, `HOURS`, `LOCATION`, `BOOKING`, `POLICY`, `OFFERING_INFO`, `COMPLAINT`, `OTHER`
- Rule-based pattern matching with Arabic dialect support (no LLM call needed)
- Used to select semantic cache thresholds and skip cache for certain intents

### Category Defaults
- Safe fallback responses per business type (restaurant, clothing, salon, etc.)
- Used when retrieval returns no good chunks
- Never invents facts — asks clarifying questions instead

### Feature Flag
```
RAG_MODE = off | shadow | on    (default: on)
```
- `off`: Current behavior (static KB)
- `shadow`: Run RAG pipeline but still use static KB for actual replies (log comparison)
- `on`: Full RAG active

### Lazy Initialization
- `RetrievalService` and `KbIngestionService` use lazy-init via `getIngestionService()` / `getRetrievalService()`
- Zero overhead when `RAG_MODE=off`

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
  prompt_version varchar(10),       -- added post-plan: scopes cache to PROMPT_VERSION
  hit_count integer DEFAULT 0,      -- added post-plan: tracks cache hit frequency
  created_at timestamp
);
-- HNSW index on query_embedding
-- Indexes on page_id, intent, (page_id + kb_active_version_at_creation)
```

---

## Code Inventory

All KB service files live in `backend/src/services/kb/`:

| File | Lines | Purpose |
|------|-------|---------|
| `chunker.ts` | 357 | Splits KB text into typed chunks (offering, policy, FAQ, etc.) |
| `gap-detector.ts` | 255 | Records unanswered questions, deduplicates via pg_trgm similarity (0.5 threshold), notifies merchants |
| `semantic-cache.ts` | 214 | Intent-aware semantic cache with per-intent similarity thresholds |
| `category-defaults.ts` | 186 | Safe fallback responses by business type (7+ categories) |
| `ingestion.ts` | 183 | Orchestrates chunk + embed + store pipeline, manages version activation |
| `retrieval.ts` | 144 | Hybrid search (HNSW + trigram) with score fusion and language boost |
| `pgvector-store.ts` | 108 | VectorStore implementation: upsert, search, delete |
| `embedding.ts` | 83 | OpenAI embedding provider (text-embedding-3-small, 512-dim) |
| `intent-detector.ts` | 82 | Rule-based pre-GPT intent classification (9 types, Arabic dialect aware) |
| `interfaces.ts` | 46 | TypeScript interfaces: EmbeddingProvider, VectorStore, ChunkWithEmbedding, ScoredChunk |

**Total: ~1,658 lines** across 10 files.

---

## Remaining Work

### PR8: Speed + Scaling (pending)
- Worker concurrency: currently defaults to `10` (via `QUEUE_CONCURRENCY` env var)
- Potential optimizations:
  - Parallel execution of embedding + retrieval steps where possible
  - Fast paths for high-confidence exact cache hits (skip enrichment)
  - Connection pooling tuning for pgvector queries under load
  - Benchmark and tune `QUEUE_CONCURRENCY` for production workload

### Post-launch (deferred)
- **KB Gaps dashboard**: Frontend admin UI to view/resolve unanswered questions (PR7 backend is done, no UI yet)
- **Gap resolution workflow**: Allow merchants to add KB content directly from gap entries
- **Cache analytics**: Surface `hitCount` data to show cache efficiency metrics
- **Embedding model upgrades**: Evaluate newer/larger embedding models as they become available
- **HNSW parameter tuning**: Current indexes use defaults (m=16, ef_construction=64). Tuning to m=24, ef_construction=200 gives ~1-3% recall improvement but requires a table-locking migration. Revisit when any user exceeds 50k chunks. Can also tune `hnsw.ef_search` at query time without a migration.
- **Drizzle ORM/Kit upgrade**: Currently on drizzle-orm 0.29.3 / drizzle-kit 0.20.13. Newer versions changed CLI commands (`generate:pg` → `generate`), config format (`driver` → `dialect`), and migration snapshot format. High risk with 45 existing migrations and no functional benefit (raw SQL used for all pgvector operations). Defer until a compelling feature requires it.
- **Semantic cache eviction**: No size cap on semantic_cache table. Consider periodic cleanup of entries with `hit_count = 0` older than 30 days.

---

## Prompt Versioning

Prompt changes are tracked via `PROMPT_VERSION` in `packages/shared/src/index.ts` (currently `v21`).

Key version history:
- **v14**: Baseline (95.4% eval accuracy)
- **v16**: Softened product_catalog instruction — "refer to" instead of "ALWAYS refer to first" (+2.9% accuracy)
- **v17**: Sharpened style descriptions, natural behavior rules, emoji mirroring
- **v18**: Customer awareness — pass customer name + returning status as context
- **v19**: Structured angry_customer flag, confidence rules, vague follow-up examples (97.5% → 99.6%)
- **v21**: Current production version

Semantic cache auto-invalidates when `PROMPT_VERSION` changes — no manual cache flush needed.
