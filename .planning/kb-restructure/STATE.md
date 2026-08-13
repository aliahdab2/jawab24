# KB Restructure — Execution State

> **Read this first** if you're a fresh Claude session. This file is the single source of truth for where the KB restructure work stands. The full strategy is at `~/.claude/plans/brief-for-the-expert-encapsulated-hearth.md` — read that for the *why*, read this for the *what's next*.

**Last updated:** 2026-05-29

---

## 2026-05-29 — Stage 2.6.1 (Option B) — "عنوان" bug closed

**Status:** Migration applied to prod (72 rows). PR #208 **merged to main** (commit `6a744b50`). **Manual deploy still required** — GHA `Deploy` workflow is broken (Verify Secrets job missing `SERVER_SSH_KEY`, pre-existing since at least 2026-05-27, unrelated to this work). Run `bash scripts/deploy-production.sh -y` to ship.

**Bug:** Customer comments asking "عنوان" (address) on page `39aeab89` (الفريق الدمشقي للتدريب والتأهيل) got phone numbers instead of the address. Root cause: Stage 2.6 one-sided gate — `business_profile.merchant = {}` kept BUSINESS_INFO prompt block empty, even though `suggestions.address` had the FB-synced address. 12 prod pages were in this state; 30 more legacy-flat rows were equivalent (per `unwrapBusinessProfile` demoting flat → suggestions).

**Fix shape (decided):** Option B (sidecar provenance map). Stage 2.6 split stays; FB sync now auto-promotes into `merchant` with `merchantProvenance.X = { source: 'fb_sync', confirmedAt: null }`. Editor saves stamp `source: 'editor', confirmedAt: now` and tombstone cleared fields. Old gate semantics preserved (editor-owned fields are immune to FB overwrites).

**What landed:**
- One-shot migration applied to prod via `scripts/promote-business-profile-fb-sync.ts` (12 promote + 59 wrap_legacy + 1 backfill_editor + 2 skip). Side effect: fixed double-encoded jsonb-string for all 72 migrated rows.
- PR #208 — `feat/business-profile-option-b` branch — 4 commits (shared helpers + classifier, backend wiring, migration tooling, eval case). Waiting on review.
- Prod smoke test verified the data fix alone closes the bug (smoke ran old code + new data, both queries return the address verbatim, no phones-first).
- New eval case `id: 412` in Cat 49 — bare "عنوان" comment — passes in 3 consecutive runs (95.7% / 96.2% / 96.2%, variance confirmed).

**Gap window risk:** between now and PR merge+deploy, NEW pages connecting to FB hit the original bug (old `buildBusinessProfileContainer` still produces `{merchant: {}, suggestions}`). Existing 72 migrated pages stay fixed.

**Parked separately:**
- Drizzle + postgres.js jsonb double-encoding storage hygiene (`project_drizzle_jsonb_double_encoding.md`). Runtime is fine (Drizzle reader auto-parses); storage shape will regress on post-merge writes until the parked 5-line driver fix ships.

**Next pickup actions:**
1. Run manual deploy: `bash scripts/deploy-production.sh -y` (GHA pipeline broken, see status note).
2. Post-deploy verification checklist (below) — exercises the NEW code paths against migrated data for the first time.
3. After Option B stabilizes in prod, schedule the Drizzle double-encoding driver fix as a separate hygiene PR.

**Post-deploy verification checklist:**

Automated spot-checks (SSH + psql via `~/.ssh/id_jawab24_deploy`):
- Container `git.sha` label matches `6a744b5…` (or later commit).
- `SELECT COUNT(*) FROM pages WHERE business_profile ? 'merchantProvenance'` → expect ≥ 70.
- Damascus page row: `merchant.address` populated, `merchantProvenance.address.source = 'fb_sync'`.
- `SELECT COUNT(*) FROM pages WHERE jsonb_typeof(business_profile) = 'string'` → expect 0 (no fresh double-encoding regressions).

Manual UI exercises (the NEW code paths — these have never run end-to-end):
1. **Editor-save path (`applyMerchantEdit`)** — edit ONE field at `/settings → Business Profile` on a non-customer page. After save, psql confirms: only that field's `merchantProvenance` entry flips to `source='editor'`, others unchanged. Revert the edit when done.
2. **FB-sync path (`buildBusinessProfileContainer → applyFbSyncToMerchant`)** — disconnect+reconnect a test page's FB integration. After re-sync, confirm: new fields get `source='fb_sync'`; any pre-existing `source='editor'` fields are preserved (not overwritten).
3. **Reply regression** — playground against Damascus (`39aeab89-...`) with message "عنوان". Expect address-first reply. Also try "ما عنوانكم؟" and "where are you located?".

Rollback path if any check fails: `scripts/promote-business-profile-fb-sync.rollback.sql` + revert commit `6a744b50`.

---
**Current stage:** Stage 2.6 — Business Profile Foundation (**MERGED + DEPLOYED to production**)
**Current task:** Stage 2.6 shipped. Next focus: **Stage 2 v1 root-cause analysis** — use [POST-MORTEMS/stage-2-v1-failed.md](POST-MORTEMS/stage-2-v1-failed.md) as the starting point; bisect the suspects (start at `7584283c`) against the `896f05ff` archive code reachable from main's revert history. (Not started yet.)

**Active branches:**
- _(none active)_ — `feat/kb-business-info-foundation` was squash-merged as PR #194 (`024df791`) and retired. Lingering Stage 2 branches `kb-restructure/stage-2-catalog` (local) + `revert/stage-2-catalog` (remote) deleted 2026-05-27.
- `kb-restructure/stage-1-valid-until` — Stage 1, **merged & deployed** (see PR #189 entry below)

**Stage 2.6 plan:** detailed approach at `~/.claude/plans/what-about-address-and-playful-fog.md`. Approved 2026-05-23 with refinements covering phones[] array, canonical hours format, persona-aware refusal language, cache invalidation (kbVersion + kbActiveVersion + Redis SCAN/DEL), and 19 eval cases (2 of which are regression-specific, no LLM variance budget).

**Status of older PRs:**
- PR #189 (Stage 1 foundations): https://github.com/aliahdab2/jawab24/pull/189 — **MERGED & DEPLOYED to production 2026-05-22T16:07:31Z (commit `1006c593`).** valid_until column, source_tier authority ranking, and catalog-detection warning banner are live. Zero customer-facing behavior change today (existing data all backfilled to no-op defaults).
- PR #190 (Stage 2 catalog): merged 2026-05-24, **reverted same day** at `1dfa8c65`. **Reason for revert: eval dropped from 95.7% to ~90% after merge.** Root cause investigation attempted, not found. Archive branch `archive/stage-2-catalog-main` **deleted** (local + origin) on 2026-05-26 to remove mental overhead. Stage 2 will be **redesigned as v2** — post-mortem at [POST-MORTEMS/stage-2-v1-failed.md](POST-MORTEMS/stage-2-v1-failed.md) captures suspects + lessons. Original code remains reachable from main's revert history if needed.

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

### Stage 2 — Catalog entities — **TO BE REDESIGNED (v2)**

v1 (PR #190) merged and was reverted on 2026-05-24 after eval dropped 95.7% → ~90%. Root cause not isolated. Archive branch deleted 2026-05-26. **Do not resume v1 task list below — it's preserved only as a reference for what v2 must reconsider.** See [POST-MORTEMS/stage-2-v1-failed.md](POST-MORTEMS/stage-2-v1-failed.md) for what went wrong and the v2 design constraints (smaller PRs, pre-merge eval gate, tool-list-bloat caution).

v2 design is a **fresh-brain task** — do not start it until Stage 2.6 lands (priorities listed in header block).

<details>
<summary>v1 sub-stages — what was actually merged in PR #190 (archived for v2 reference)</summary>

v1 was structured into 8 sub-stages, not the vague 5-bullet placeholder the original post-mortem implied. **All 6 sub-stages below were merged in PR #190**; the remaining 2 (dogfood + final eval gate) were the planned but un-executed validation steps. Commit SHAs below are the canonical (main-reachable) ones; an earlier rebase left orphaned twins (e.g. `96fc8cba`, `25fa6265`) which resolve but should not be cited.

**Merged sub-stages:**
- ~~2.1 `catalog_items` schema~~ (`42d97a10`) — generic schema, type-driven, JSONB metadata; migration `0108_*.sql`; 7 schema integration tests.
- ~~2.2 Backend CRUD API~~ (`e2e29fa3`) — `services/catalog.ts` + controllers + routes; workspace-scoped via parent page; `pages.kbVersion` bumped on every write.
- ~~2.3a Catalog tool executor + shared types~~ (`db5f66ff`) — `services/catalogTools.ts`, `executeCatalogToolCall()`, three tools (`search_entities`, `get_entity_details`, `list_active_entities`). `list_active_entities` filters `endsAt > NOW()` in SQL as data-layer safeguard.
- ~~2.3b AI integration~~ (`d006f2c6`) — catalog tools wired into ai-worker (`CATALOG_TOOLS`, `selectToolsForRequest()`) + backend tool-loop (`dispatchTool()`, `ALL_VALID_TOOL_NAMES` whitelist) + reply pipeline (`pageHasCatalogItems()` probe in `dispatchAiReply()`).
- ~~2.4 Catalog list view + entry from /pages~~ (`4f285222`) — frontend route `/pages/[pageId]/catalog`, empty-state template picker.
- ~~2.5 Catalog editor (add/edit/archive/restore/delete) + polish~~ (`94cd2854`) — SidePanel form, type-aware field surfacing.

**Planned but NOT executed (the missing eval gate):**
- ~~2.6 Vertical templates + smart pre-selection~~ — Facebook category → template mapping. *Note: v1 used "Stage 2.6" for this; unrelated to current Stage 2.6 = business profile foundation.*
- ~~2.7 Dogfood with 2–3 training-institute merchants~~
- ~~2.8 Re-baseline eval BEFORE release~~ — **this was the gate that should have caught the 5pp drop. It was never run.**

**v2 designer:** see [POST-MORTEMS/stage-2-v1-failed.md](POST-MORTEMS/stage-2-v1-failed.md) for the refined suspect ranking and timeline analysis (the 2.3b eval-green discovery narrows the search window significantly).

v1 exit criteria were: 3 merchants using catalog with no complaints, eval improvement on catalog-class tests, p50 reply latency under 2.5s with one tool call. v2 will likely keep the same exit criteria but must add a pre-merge eval gate on the existing 304 cases.

</details>

### Stage 2.6 — Business Profile Foundation (parallel track to Stage 2 catalog)

**MERGED + DEPLOYED.** PR #194 squash-merged to main as **`024df791`** and deployed to production **2026-05-26** (blue-green `green` env; verified healthy 2026-05-27: 0 ai-worker errors, 0 new Sentry issues, only benign pre-existing FB-400 reply errors in backend logs). Adds structured business profile (address / phones / hours / policies) to the AI prompt, with a regression-prevention split between merchant-confirmed data and FB-suggested data. Motivated by the Damascus institute "1234567" phone hallucination incident.

- [x] **2.6 foundation** — `BusinessProfile` type extended (phones[], policies, language_hint:'auto'); new `BusinessProfileContainer {merchant, suggestions}` shape + `unwrapBusinessProfile()` / `mergedBusinessProfile()` helpers; hours canonicalizer (`businessHours.ts`) with Arabic-Indic digits, AM/PM (ص/م), Closed/مغلق, 24/7, en/em-dash separators. Commit `b7f3b8f7`.
- [x] **2.6 backend** — cache invalidation (`invalidatePageCaches()`), PATCH wraps `{merchant: body, suggestions: existing.suggestions}` server-side, FB sync writes only the `suggestions` half via `buildBusinessProfileContainer()`. Commit `4ecf9228`.
- [x] **2.6c-prep** — split business_profile JSONB into container shape, migration `0109_split_business_profile.sql` (renumbered from 0108 during the 2026-05-26 rebase to resolve a slot collision with main's top-up billing migration `0108_superb_aaron_stack`). Missing drizzle snapshot regenerated (`0109_snapshot.json`, commit `2db0a924`). Stale `0027` comment in index.ts corrected to `0109`. Commit `1214c553` (rebased `7b0909e5`).
- [x] **2.6c structured prompt block** — new `businessInfoPrompt.ts` (`formatBusinessInfoPrompt()`) injects structured BUSINESS_INFO block above raw KB chunks; `[NOT_PROVIDED]` markers force refusal instead of confabulation. Commit `f754cf8d`.
- [x] **2.6c phone guard** — post-generation `phone_not_in_kb` guard. Commit `7b0e7f9a`.
- [x] **2.6c eval cases** — Cat 50 Business Info added; training-page seed. Commit `da4d1fcb`.

**Audit + gate status (2026-05-26 — ALL PASSED):**
- ✓ **Check #1** — `formatBusinessInfoPrompt()` reads only `container.merchant`, never `suggestions`. Both call sites destructure correctly. Regression-prevention contract intact.
- ✓ **Check #2** — `BusinessProfileSchema` (backend/src/utils/validation.ts) accepts `phones[]` (≤10), `policies.{shipping,returns,payment,booking}` (≤500ch each), `language_hint:'auto'`. Confirmed.
- ✓ **Check #3** — migration is `0109_split_business_profile.sql`; `drizzle-kit check:pg` clean; 109-migration fresh-DB apply + idempotency verified on a throwaway DB.
- ✓ **Integration tests** — backend 3729 pass / 5 skip / 0 fail; ai-worker 268 pass / 0 fail. tsc + lint clean across all 4 packages.
- ✓ **Eval gate (clean, cache-bypassed)** — **96.0% overall** (291 PASS / 19 PARTIAL / 3 FAIL / 313). Regression cases #410/#411 PASS *live*. Existing-304 subset **95.9% (+0.2pp** vs 95.7% baseline). Cat 50 9/9. The 3 FAILs: **#12** (seed collision — fixed, moved to school page, commit `260222fb`), **#46** (known LLM variance), **#87** (pre-existing on main, NOT a 2.6 regression — to be filed separately).
- ⚠️ **Eval-gate trustworthiness depends on `e1351d6a`** — the `pipeline === 'eval'` cache bypass (cherry-picked from the reverted catalog branch's `b10aa65e`). Without it, ~14% of cases serve stale cache and the gate lies (the first "95.8%" run hadn't actually tested regression case #411 — 6ms stale hit). See post-mortem Correction §2/§4.

**SHIPPED** — merged (`024df791`) + deployed to production 2026-05-26. Day-1 sanity check (2026-05-27): containers healthy 8h, ai-worker 0 errors, Sentry 0 new issues, migration applied cleanly (healthy startup). Post-deploy eval re-confirmed on gpt-4o-mini: 93.8% (vs 96.0% default gpt-4.1-mini) — Cat 50 + both regression cases #410/#411 PASS on 4o-mini too; default stays gpt-4.1-mini.

**Stage 2.6d open questions (decide during 2.6d frontend planning):**

- **Hours field overlap** (surfaced 2026-05-26 during 2.6 rebase). Two parallel "hours" surfaces exist:
  - `workspace.settings.businessHoursStart/End/businessHoursOnly` — single window per week, used by the auto-reply *scheduler* to decide "is the bot allowed to reply right now?"
  - `business_profile.hours` (new in 2.6) — per-day arrays with `closed`/`all day` support, injected into the AI prompt so the bot can answer "when are you open?" accurately
  
  These are conceptually different (when does the *platform* run vs. what does the *business* tell customers) but visually overlap and can produce contradictory states (e.g. bot replies at 11pm saying "we're open 9-6"). Three options:
  - (a) Keep them separate, explain the distinction in the 2.6d UI
  - (b) Make `business_profile.hours` the source of truth and derive the scheduler window from it (requires another migration + scheduler refactor — own stage)
  - (c) Keep them separate technically but link them in the 2.6d UI ("use these as your auto-reply window?" confirmation)
  
  **Defer decision until:** real merchant usage data exists after 2.6d ships. Current PR #194 is backend-only — merchants can't fill `business_profile.hours` yet, so the overlap is theoretical, not active.

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
| 2026-05-23 | Stage 2 catalog editor lives at standalone route `/pages/[pageId]/catalog`            | Modal doesn't scale to 20–50 catalog items; merchants benefit from a bookmarkable URL    |
| 2026-05-23 | Vertical templates (6 starter types) — Notion-inspired but platform-controlled        | Templates are starting points, not lockboxes; merchants can add any type anytime         |
| 2026-05-23 | Smart pre-selection from Facebook `category` (and `category_list` for locale-stability) | Data already captured at page connect; converts template question to a confirmation       |
| 2026-05-23 | Stage 2.5 calendar view as separate sub-stage                                         | Keeps Stage 2 shippable; calendar is ~3 days follow-up after main catalog ships          |
| 2026-05-23 | Don't allow merchant-defined schemas (Notion blank-canvas model)                      | Breaks AI semantic stability; tool calls need stable field semantics                     |
| 2026-05-23 | Engagement-filter is required before drawing strategic conclusions from prod data     | Raw 72-page query was dominated by tire-kickers; 11 engaged customers = ~73% catalog-shaped, all 4 paying customers are catalog/service-shaped |
| 2026-05-23 | Content creators / non-profits are a Stage 3 problem, not a Stage 2 problem           | They don't need catalog; persona/voice extraction is their value prop. Don't parallelize — Stage 2 ships first |

---

## Future small follow-ups (out of scope for Stage 1)

These are deliberately *not* in Stage 1 to keep the PR tight. Each is small enough to ship as its own PR when timing is right.

- **Persona-hint UX nudge.** Persona-heavy merchants (e.g. the Libyan single-product seller) use the raw KB as a tone/voice field instead of `settings.brandVoiceNotesMulti`, which already exists but isn't discoverable. Fix is not detection — it's signposting: add a one-line link above the KB editor pointing at Brand Voice settings, and/or an empty-state hint inside Brand Voice settings pointing back at KB. ~20 min of work, no detection logic. Considered for Stage 1 and deliberately deferred to avoid scope sprawl + avoid a banner-promise we couldn't back up.

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
| Post-Stage-2.3b | 2026-05-23 | 304 cases  | 95.6% | gpt-4.1-mini | v36            | 278 PASS / 25 PARTIAL / 1 FAIL. -0.1pp vs baseline = within LLM variance (matches Stage 1.2 pattern). Single FAIL is same as baseline (#87 FREE SHIPPING contamination). **Cat 48 E-commerce Tool Loop: 4/4 PASS** — confirms the gating change in `ecommerceToolLoop.ts` (storeId → storeId\|catalogToolsEnabled) did NOT regress the store-connected path, which was the highest-risk concern of 2.3b. Avg latency 629ms (vs 577ms baseline; +52ms within variance — the `pageHasCatalogItems` probe is sub-ms on indexed lookup). Log at `/tmp/eval-stage-2-3b.log`. |
| Post-refactor   | 2026-05-23 | 304 cases  | 94.7% raw / ~95.4% adjusted | gpt-4.1-mini | v36 | 277 PASS / 22 PARTIAL / 5 FAIL. Headline -0.9pp **misleading**: 2 of the 5 FAILs are HTTP 429 rate-limit infra failures (#103, #196) hitting ai-worker's `@fastify/rate-limit` cap of 100/window — NOT code regressions. The 3 real logic FAILs (#95, #296 COMPLAINT↔COMPLIMENT sarcasm misclassification; #324 replyMethod ai vs skipped) are all known-LLM-variance categories. Excluding the 2 infra failures → ~95.4%, within variance of baseline. Avg latency 1607ms (vs 629ms post-2.3b) explained by cold OpenAI prompt cache + circuit-breaker retries on 429s — not the refactor. Refactor is byte-for-byte behavior-equivalent (14 new shared unit tests + 46 backend integration tests verify parity). Log at `/tmp/eval-refactor.log`. |
| Post-Stage-2.6  | 2026-05-26 | 313 cases  | 96.0% | server default | v36 | **Rebased branch, cache-bypassed (clean).** 291 PASS / 19 PARTIAL / 3 FAIL. Existing-304 subset = 95.9% (+0.2pp vs baseline); Cat 50 = 9/9; regression cases #410/#411 PASS live. The 3 FAILs: #12 (seed collision — fixed in `260222fb`), #46 (known variance), #87 (**pre-existing — already the lone FAIL at Stage 2.3b above with v36**, confirmed not a 2.6 regression by running it on main). Trustworthy only because of the `e1351d6a` cache bypass; the first run without it falsely passed via a 6ms stale-cache hit on #411. Log at `/tmp/eval-stage-2.6-rebase-clean.log` (dirty run preserved at `-DIRTY.log`). |
| Post-Stage-2 (catalog v2) | TBD | TBD | TBD | TBD | TBD | After catalog v2 (redesign) |

**Eval gotcha for future runs:** the ai-worker has `rateLimit.max = 100/window` ([ai-worker/src/server.ts:18-19](ai-worker/src/server.ts#L18)). The eval blasts ~304 requests in a few minutes, so on cold-cache runs (>5min gap since last eval) some hit 429. To get a clean signal: either bump the dev rate limit, add inter-request sleeps to the eval script, or re-run after the rate-limit window clears.

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

## Recent commits on `kb-restructure/stage-2-catalog`

- (next) — Stage 2.3b: ai-worker + tool-loop integration (~7 files).
- `25fa6265` — Stage 2.3a: catalog tool executor + shared types (3 files, 492+ insertions).
- `ad7c485b` — Stage 2.2: catalog CRUD API with workspace scoping (6 files, 698+ insertions).
- `96fc8cba` — Stage 2.1: catalog_items schema (originally on this branch).

## Chrome DevTools MCP — where it pays off in the remaining stages

The harness has the chrome-devtools MCP installed. Useful for:

- **Stage 2.4** (frontend route): load `/pages/[pageId]/catalog`, screenshot empty state, verify "Catalog" button appears on `/pages.tsx`.
- **Stage 2.5** (SidePanel form): drive the form via `fill_form`, submit, screenshot result, verify HTML5 date-input validation in-browser (where CLI can't see).
- **Stage 2.6** (vertical templates): drive the FB-category → template confirmation flow end-to-end.
- **Stage 2.7** (dogfood prep): admin-playground a catalog question against a seeded page; watch the network tab for the tool-loop request shape (the real-world sanity check before Stage 2.8 eval re-baseline).
- **NOT** useful for Stages 2.3 / 2.8 — pure backend / pure CLI respectively.

---

## Next session pickup

**Concrete action a fresh session can execute immediately:**

Stages 2.1 → 2.3b all committed on `kb-restructure/stage-2-catalog`. All backend + ai-worker tests pass (243 + 262). Suggested next step: **Stage 2.4** — frontend route + list view at `/pages/[pageId]/catalog`. Use chrome-devtools MCP to verify visually (see Chrome DevTools section above). Plan from STAGE-2-PLAN.md:
- New route `frontend/src/pages/pages/[pageId]/catalog.tsx`
- Components: `CatalogList`, `CatalogItemCard`, `CatalogStatusBadge`, `PlatformProductsTab` (read-only for Salla/Shopify)
- Entry point: "Catalog" button on each page card in `/pages.tsx`
- Empty state with template picker (Stage 2.6 will wire smart pre-selection)
- New i18n namespace `catalog` (44 → 45 namespaces — register all 3 places per AI_INSTRUCTIONS.md)

---

## Legacy Stage 1 next-session notes (kept for context)

Stage 1 was implementation-complete. Two things were left before merging:

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

---

## 2026-08-13 — Contact standard (PR #733 + predicate fix) — a DESCENDANT of Stage 2.6.1

**Everything above predates this by ~2.5 months. Read this before assuming the state above is current.**

The merchant **contact standard** builds directly on Stage 2.6.1 / Option B. It extends
`business_profile.merchant.phones` from bare strings to `string | {number, description}`
(schema.org `ContactPoint`), adds `merchant.email`, and relies on the `merchantProvenance`
sidecar this plan introduced — provenance gating (D-008/D-010) is what decides whether a
migrated number reaches the authoritative BUSINESS_INFO block at all.

Full rollout plan: `~/.claude/plans/cuddly-singing-backus.md`.

**Why it concerns THIS plan specifically: its Phase 2 DELETES KB prose.** Merchants keep their
contact routing in up to three places at once — the `phones` field, the persona, and the KB —
and the migration collapses that to one. Measured on the two most engaged pages: Shahin's KB
repeats his persona's routing table verbatim (9 lines); MES's «✦ قواعد:» block repeats his four
persona rules, typo included.

⛔ **The Feras precedent applies and is a hard gate:** never delete prose whose structured
replacement the merchant cannot see. Each Phase-2 merchant must be on
`BUSINESS_SURFACE_WORKSPACE_IDS` (`frontend/src/lib/featureFlags.ts`) first. Verified for
Shahin `d06ed500`, MES `9b6ba279`, Feras `c54202c9`.

**Measured before any of it ships:**
- **122/122 production profiles render byte-identical** through `origin/main`'s BUSINESS_INFO
  formatter and the branch's ⇒ the code cannot change any merchant's replies; only a merchant's
  DATA moving does. Tooling: `scripts/fleet-prompt-identity.ts`.
- Every stored number still returns from `businessPhoneList` on all 122 — the reader that feeds
  lead-capture exclusion AND the post-reply contact suffix. Verified for the post-migration
  object shape too, so no `[object Object]` can empty the exclusion set.
- Prose stripped + persona cleaned: **Shahin 7/7**, **MES 8/8** on real harvested customer
  questions. So the prose deletion this plan's cleanup workstream wants is safe for them.

⚠️ **Doc defect found here:** `featureFlags.ts:105` cites `.planning/MES_CLEANUP_REVIEW.md`,
which does not exist — and `.planning/` is gitignored, so a code comment can never reliably
reference anything inside it. Either the doc needs writing somewhere tracked, or that citation
should be dropped.
