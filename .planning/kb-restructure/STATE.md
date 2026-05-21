# KB Restructure — Execution State

> **Read this first** if you're a fresh Claude session. This file is the single source of truth for where the KB restructure work stands. The full strategy is at `~/.claude/plans/brief-for-the-expert-encapsulated-hearth.md` — read that for the *why*, read this for the *what's next*.

**Last updated:** 2026-05-22
**Current stage:** Stage 1 — Foundations (in progress)
**Current task:** 1.1 complete, 1.2 next (`source_tier` column)
**Branch:** `kb-restructure/stage-1-valid-until` (1.1 work committed locally, not pushed)

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
- [ ] **1.2 `source_tier` on `kb_chunks`** — add enum column (1–5: live API / structured catalog / approved narrative / raw narrative / auto-extracted-pending). Default existing rows to tier 4. Update retrieval scoring to add `sourceTierBoost` of ~+0.15 per tier above 4.
- [ ] **1.3 Ingestion-time warnings** — detect catalog-like patterns (price tokens + product nouns, date ranges + course nouns) in raw KB on save; show a non-blocking warning in the editor. Touches: ingestion service + `KnowledgeBaseRawEditor.tsx`.
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

Stage 1.1:
- `backend/src/db/schema.ts` — added `validUntil` column to `kbChunks`
- `backend/migrations/0106_zippy_tigra.sql` — `ALTER TABLE kb_chunks ADD COLUMN valid_until timestamp`
- `backend/migrations/meta/0106_snapshot.json` — drizzle snapshot
- `backend/migrations/meta/_journal.json` — drizzle journal
- `backend/src/services/kb/retrieval.ts` — added `valid_until` filter to vector_candidates CTE + updated docstring
- `backend/test/integration/retrieval.test.ts` — added `should filter chunks past valid_until` test

---

## Next session pickup

**Concrete action a fresh session can execute immediately:**

Start Stage 1.2 — add `source_tier` column to `kb_chunks` and wire it into retrieval scoring.

Current branch is `kb-restructure/stage-1-valid-until` with 1.1 changes uncommitted (verify with `git status`). Either commit 1.1 first as its own atomic commit, then continue on the same branch — or open a sibling branch off main if you want 1.1 and 1.2 reviewed separately.

1. Read [backend/src/db/schema.ts](backend/src/db/schema.ts) around the `kbChunks` definition (now ~lines 841-867 after 1.1)
2. Add `sourceTier: integer('source_tier').notNull().default(4)` — default tier 4 (raw narrative chunks); existing rows get 4 implicitly
3. Generate migration: `cd backend && npx drizzle-kit generate:pg` — expect a single `ALTER TABLE kb_chunks ADD COLUMN source_tier integer NOT NULL DEFAULT 4`
4. Update [backend/src/services/kb/retrieval.ts](backend/src/services/kb/retrieval.ts):
   - Read `source_tier` in the candidates CTE
   - Add `+ ((4 - LEAST(source_tier, 4)) * 0.15)` to the `final_score` (tier 1 = +0.45, tier 2 = +0.30, tier 3 = +0.15, tier 4 = +0, tier 5 = -0.15... actually clamp tier 5 to a hard exclusion since auto-extracted-pending shouldn't reach the LLM)
   - Document the tier scale in the docstring
5. Add integration test: insert tier-1 and tier-4 chunks with identical embeddings + content; verify tier-1 ranks first
6. Run `npm run test:integration -- test/integration/retrieval.test.ts` and `npx tsc --noEmit` and `npm run lint`
7. Eval re-baseline (Stage 1.2 row in this file) — local backend + ai-worker + `scripts/playground-eval.ts` per the run command above
8. Update STATE.md: check 1.2 off, fill eval row, append to "Files touched", set next action to 1.3 (ingestion-time warnings)

**Open question to resolve during 1.2:** the proposed scoring weight (+0.15 per tier above 4) is a guess. Document the eval delta in the open-questions section and adjust if the boost over- or under-corrects on real eval cases.

If anything in the strategy plan feels wrong in light of what you actually find in the code, **update the plan**, don't silently improvise.
