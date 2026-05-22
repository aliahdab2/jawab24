# KB Restructure — Execution State

> **Read this first** if you're a fresh Claude session. This file is the single source of truth for where the KB restructure work stands. The full strategy is at `~/.claude/plans/brief-for-the-expert-encapsulated-hearth.md` — read that for the *why*, read this for the *what's next*.

**Last updated:** 2026-05-23
**Current stage:** Stage 1 — Foundations (complete, awaiting PR)
**Current task:** Stage 1 done. Open PR with all 3 commits.
**Branch:** `kb-restructure/stage-1-valid-until` — pushed to origin. 1.1 committed as `22cd666f`, 1.2 as `f0263935`, 1.3 pending commit. PR not yet opened.

---

## Quick context for fresh sessions

Jawab24's Knowledge Base today is mostly a free-text textarea. Merchants paste persona instructions, canned templates, course catalogs, and policies all into the same field, then RAG retrieval treats them all equally. This caused at least one real incident (an expired course recommended to a customer).

The plan is **not** a rewrite. It's a staged refactor that:
1. Adds **source-aware retrieval** (authority tiers) so live data beats stale chunks
2. Adds **freshness filtering** (`validUntil` on chunks, time-bound entity tables for catalog data)
3. Adds **ingestion-time warnings** when merchants paste catalog-like content into the raw KB
4. Eventually adds an **entity-centric tool layer** (`search_entities`, `get_entity_details`, `list_active_entities`) and a **"paste-we-organize" classifier** so merchants never have to learn the data model

The full reasoning, peer-review refinements, code verification, and competitive analysis are in the strategy plan. **Don't redo that work.** This file tracks execution against it.

---

## Stage roadmap

### Stage 1 — Foundations (this week, ~1–2 weeks total)
Smallest reversible changes that directly prevent the catalyst incident class of bugs. Additive only — no behavior change for merchants who don't use the new features.

- [x] **1.1 `validUntil` on `kb_chunks`** — DONE 2026-05-22. Nullable `timestamp` column added; retrieval CTE filters `valid_until IS NULL OR valid_until > NOW()` before vector ranking. Migration `0106_zippy_tigra.sql` is single ADD COLUMN, no data touched. Integration test added (`should filter chunks past valid_until and keep current/null ones`). All 5 retrieval integration tests pass. Lint + tsc clean. Editor UI for setting `validUntil` deferred to Stage 2.
- [x] **1.2 `source_tier` on `kb_chunks`** — DONE 2026-05-22. Integer column with `DEFAULT 4 NOT NULL` (migration `0107_huge_longshot.sql`). Both retrieval paths add `(4 - LEAST(source_tier, 4)) * 0.15` to final_score and exclude tier 5. `RetrievedChunk.sourceTier` exposed in interface. 2 new integration tests cover tier ordering + tier-5 exclusion (7/7 retrieval tests pass total). For current data (all rows backfilled to tier 4), the boost is mathematically 0 → no behavior change until tier-1/2/3/5 chunks are written by future stages.
- [x] **1.3 Ingestion-time warnings** — DONE 2026-05-23. New `backend/src/services/kb/content-classifier.ts` with `detectCatalogLikePatterns()` (13 unit tests covering negative cases, real merchant fixtures, threshold boundaries). Wired into `PATCH /pages/:id` controller — response now carries optional `kbWarnings` field when raw KB contains 3+ price mentions or 2+ course keywords with any price. Frontend modal renders a dismissible warning banner (uses semantic `alert-warning` class, AR + EN i18n with ICU plurals). Pure no-op for retrieval/eval (classifier doesn't touch chunking or scoring).
- [ ] **1.4 Re-baseline eval** — run `scripts/playground-eval.ts` before and after Stage 1. Document delta. Stop and diagnose if eval drops >1 point.

**Stage 1 exit criteria:** eval baseline unchanged or improved, no merchant complaints, three merchants confirm they noticed nothing different (additive change worked).

### Stage 2 — Catalog entities (this month, ~3–4 weeks)
- [ ] **2.1 `catalog_items` + `catalog_item_schedules` tables** — generic schema (see plan, "Data model" section)
- [ ] **2.2 Entity tools** — `search_entities`, `get_entity_details`, `list_active_entities` added to ai-worker tool whitelist
- [ ] **2.3 Catalog UI** — section in the existing `KnowledgeBaseSections` modal, surfaces empty-state by default
- [ ] **2.4 Dogfood with 2–3 training-institute merchants** — manual per-merchant enablement (no feature flag system exists yet, see Open Questions)
- [ ] **2.5 Re-baseline eval** — expect improvement on catalog-related tests, no regression elsewhere

**Stage 2 exit criteria:** 3 merchants using catalog with no complaints, eval improvement on catalog-class tests, p50 reply latency stays under 2.5s with one tool call.

### Stage 3 — "Paste, we organize" classifier (next quarter, ~6–10 weeks)
- [ ] **3.1 LLM extraction pipeline** — composes on top of existing `file-extractor.ts`
- [ ] **3.2 Diff-view approval UI** — merchant accepts/edits/rejects per item
- [ ] **3.3 "Restructure my KB" action** — one-shot extraction over existing raw KB content
- [ ] **3.4 Entity-tagged chunks** — when chunk mentions an entity that has tool data, retrieval suppresses the chunk in favor of the tool result

**Stage 3 exit criteria:** 5+ merchants migrated via the extraction flow with >70% accept rate on proposals.

### Stage 4 — Mature (6+ months out)
- [ ] **4.1 Raw KB documented as fallback** in new merchant onboarding
- [ ] **4.2 Feature flag system** if not built by then
- [ ] **4.3 Verifiability surface** — show merchant *which source* answered each customer (steal-from-Fini move)
- [ ] **4.4 Honest accuracy dashboard** — show merchant per-month: answered correctly / declined / mistakes (steal-from-everyone move)

---

## Decisions log

| Date       | Decision                                                                              | Why                                                                          |
| ---------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 2026-05-22 | Hybrid architecture (structured + tool-calling + RAG for narrative)                   | Validated by codebase reality + Fini Labs precedent + peer review            |
| 2026-05-22 | No graph database (Neo4j-style)                                                       | Postgres + FKs delivers same behavioral outcome at fraction of operational cost |
| 2026-05-22 | No per-vertical schemas                                                               | Generic `type` enum + JSONB metadata; verticals add types, not schemas       |
| 2026-05-22 | No silent KB migration                                                                | Merchant-in-the-loop only; "Restructure my KB" is opt-in (Stage 3)           |
| 2026-05-22 | Same product for product-funnel + catalog merchants, not a split                      | Single-product is N=1 catalog; splitting doubles maintenance                 |
| 2026-05-22 | Entity-centric tools (`search_entities` etc.), not per-vertical tools                 | New verticals add types not tools; matches OpenAI Assistants pattern         |
| 2026-05-22 | Source-aware retrieval (tier-weighted scoring) is the highest-leverage Stage-1 change | Prevents stale-chunk-beats-live-data class of bugs (catalyst incident)       |
| 2026-05-22 | No feature flag system built up-front                                                 | Per-merchant manual enablement for first 3 dogfood merchants; revisit at Stage 2 boundary |

---

## Open questions

- **Feature flag system:** when do we build one? Currently planning manual per-merchant enablement for Stage 2 dogfooding. Build a generic system if Stage 2 surfaces a third merchant who wants it.
- **`source_tier` scoring weight:** +0.15 per tier above 4 is a guess. Calibrate empirically in Stage 1.4 — does pushing tier-3 chunks above tier-4 in mixed contexts actually improve eval scores?
- **`validUntil` ingestion path:** how do merchants set this? Stage 1 ships the column + retrieval filter, but the editor doesn't expose it yet. Likely a Stage 2 UI add.
- **"Paste-we-organize" classifier reliability:** unknown. The biggest research risk in the whole plan. Will only know after Stage 3.1 prototype.
- **kb_gaps surfacing UI:** the `kb_gaps` table already exists. Worth a Stage 1 quick win to expose to merchants? Currently parked — adds scope to Stage 1.

---

## Eval baseline tracking

| Stage           | Date | Suite size | Pass rate | Model        | PROMPT_VERSION | Notes                                |
| --------------- | ---- | ---------- | --------- | ------------ | -------------- | ------------------------------------ |
| Pre-Stage-1     | 2026-05-18 | 304 cases  | 95.7% | gpt-4.1-mini | v36            | Baseline. 279 PASS / 24 PARTIAL / 1 FAIL. Count confirmed by re-run on 2026-05-22 (earlier verification-agent claim of ~289 was wrong). |
| Post-Stage-1.1  | 2026-05-22 | 304 cases  | 95.7% | gpt-4.1-mini | v36            | 279 PASS / 24 PARTIAL / 1 FAIL. Identical to baseline (no-op for existing rows with `valid_until = NULL`). Avg latency 536ms. Integration tests: 5/5 pass. Log at `/tmp/eval-stage-1-1.log`. |
| Post-Stage-1.2  | 2026-05-22 | 304 cases  | 95.6% | gpt-4.1-mini | v36            | 279 PASS / 23 PARTIAL / 2 FAIL. -0.1pp vs baseline. Diagnosed as LLM variance, NOT regression: test #46 (Cat 4 safety, Arabic Riyadh question) was already PARTIAL in baseline (failed `contains:الرياض` check). In 1.2 the confidence calibration also flipped (high → medium), pushing it to FAIL. No PASS test regressed. For tier-4-only data (every existing row), boost formula `(4 - LEAST(4, 4)) * 0.15 = 0` is mathematically a no-op. Integration tests prove tier ordering works on real tier-1/2/3/5 data. Log at `/tmp/eval-stage-1-2.log`. |
| Post-Stage-1.3  | 2026-05-23 | 304 cases  | 95.7% | gpt-4.1-mini | v36            | 279 PASS / 24 PARTIAL / 1 FAIL. Identical to baseline. **Confirms the 1.2 dip was pure LLM variance** — test #46 flipped back to PARTIAL this run with no code change to retrieval logic. Avg latency 577ms. Classifier doesn't touch retrieval, so no behavior change expected for eval. Log at `/tmp/eval-stage-1-3.log`. |
| Post-Stage-1.2  | TBD  | TBD        | TBD       | TBD          | TBD            | After `source_tier`                  |
| Post-Stage-1.3  | TBD  | TBD        | TBD       | TBD          | TBD            | After ingestion warnings             |
| Post-Stage-2    | TBD  | TBD        | TBD       | TBD          | TBD            | After catalog entities live          |

Run command (from memory):
```bash
export $(grep -v '^#' backend/.env | xargs)
TOKEN=$(curl -s -X POST http://localhost:3000/auth/demo | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
ADMIN_TOKEN="$TOKEN" VERBOSE=1 npx tsx scripts/playground-eval.ts
```

---

## Files touched (current work branch)

Branch: `kb-restructure/stage-1-valid-until`

Stage 1.1 (commit `22cd666f`, pushed):
- `backend/src/db/schema.ts` — added `validUntil` column to `kbChunks`
- `backend/migrations/0106_zippy_tigra.sql` — `ALTER TABLE kb_chunks ADD COLUMN valid_until timestamp`
- `backend/migrations/meta/0106_snapshot.json` — drizzle snapshot
- `backend/migrations/meta/_journal.json` — drizzle journal
- `backend/src/services/kb/retrieval.ts` — added `valid_until` filter to vector_candidates CTE + updated docstring
- `backend/src/services/kb/pgvector-store.ts` — added `valid_until` filter to symmetrical vector-only path
- `backend/test/integration/retrieval.test.ts` — added `should filter chunks past valid_until` test

Stage 1.2 (commit `f0263935`, pushed):
- `backend/src/db/schema.ts` — added `sourceTier` column to `kbChunks` (integer, default 4, NOT NULL)
- `backend/migrations/0107_huge_longshot.sql` — `ALTER TABLE kb_chunks ADD COLUMN source_tier integer DEFAULT 4 NOT NULL`
- `backend/migrations/meta/0107_snapshot.json` — drizzle snapshot
- `backend/migrations/meta/_journal.json` — drizzle journal updated
- `backend/src/services/kb/retrieval.ts` — tier added to candidates CTE; boost added to final_score; tier-5 excluded; `RetrievedChunk.sourceTier` exposed
- `backend/src/services/kb/pgvector-store.ts` — tier-5 excluded from vector-only path
- `backend/test/integration/retrieval.test.ts` — 2 new tests (tier ordering, tier-5 exclusion)

Stage 1.3 (pending commit):
- `backend/src/services/kb/content-classifier.ts` — NEW. Heuristic detector for catalog-like patterns (3+ prices or 2+ course keywords + 1+ price). Patterns tuned against real dev-DB merchant KBs (electronics store, training institute).
- `backend/test/services/kb/content-classifier.test.ts` — NEW. 13 unit tests: negative cases (policy w/ threshold price, FAQ, brand story), positive cases (real merchant fixtures, English variants, $ prefix), threshold boundary (exactly 2 vs exactly 3 prices).
- `backend/src/controllers/pages.ts` — calls classifier in `update` controller when KB text supplied; returns `kbWarnings` in response when `hasCatalog: true`.
- `frontend/src/components/knowledge-base/types.ts` — added `KbWarnings` / `KbCatalogReason` types mirroring backend shape.
- `frontend/src/components/knowledge-base/KnowledgeBaseModal.tsx` — `onSave` signature returns warnings; modal stores in state; renders dismissible banner using existing `alert-warning` semantic class with ICU-plural body text.
- `frontend/src/pages/pages.tsx` — `onSave` callback returns `response.data.kbWarnings`.
- `frontend/src/i18n/en/kb.json` + `frontend/src/i18n/ar/kb.json` — added `catalogWarning.priceListTitle`, `catalogWarning.courseCatalogTitle`, `catalogWarning.body` (ICU plural with all 6 Arabic forms).

---

## Next session pickup

**Concrete action a fresh session can execute immediately:**

Stage 1 is implementation-complete. Two things left before merging:

1. **Commit Stage 1.3** (currently uncommitted on `kb-restructure/stage-1-valid-until`). Verify with `git status` — should show the new classifier, its test, the controller change, the frontend modal + types + pages.tsx changes, and the two kb.json updates. Atomic commit, conventional message.

2. **Open the Stage 1 PR** to `main` with all three commits (`22cd666f`, `f0263935`, and the new 1.3 commit). Title suggestion: `feat(kb): source-aware retrieval foundations (valid_until, source_tier, catalog-detection warning)`. PR body should call out:
   - The three sub-stages and what each delivers
   - Eval: 95.7% → 95.7% (unchanged after final run, confirmed prior 1.2 dip was variance)
   - Zero user-visible behavior change for current data — all columns default to no-op values
   - Banner is the only user-visible UI; only fires when merchant pastes 3+ prices or course-catalog patterns
   - Reviewer attention: the SQL changes in `retrieval.ts` and the source-tier scoring formula are hot-path code

After PR opens, decision is whether to deploy Stage 1 alone or wait until Stage 2 builds something that *writes* to these columns. Per the strategy plan: probably wait for Stage 2 — there's no user-visible value to deploying empty infrastructure until the catalog UI lands.

If you decide to deploy Stage 1 alone after merge: standard pipeline (PR merge → tag → Jenkins → gitops). Migrations 0106 + 0107 are both safe ADD COLUMN operations with `IF NOT EXISTS`-equivalent semantics (fail-fast if already applied). Local dev DB has them; production DB needs them.

If anything in the strategy plan feels wrong in light of what you actually find in the code, **update the plan**, don't silently improvise.
