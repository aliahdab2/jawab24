# Post-mortem — Stage 2 catalog v1 (failed)

**Date written:** 2026-05-26
**Branch deleted:** `archive/stage-2-catalog-main` (local + origin)
**PR:** #190 (https://github.com/aliahdab2/jawab24/pull/190) — merged 2026-05-24, reverted same day at commit `1dfa8c65`
**Original feature commit:** `896f05ff` (still reachable from main's revert history; this is not code loss)

## What happened

PR #190 shipped Stage 2 of the KB restructure: catalog entities backend (catalog_items + catalog_item_schedules tables, services, controllers, routes), AI tools (catalog tool registration in ai-worker + tool loop in backend), and read-only UI. It merged to main, passed CI, and was deployed. On the first post-deploy eval run, the suite dropped from **95.7% → ~90%** on the existing 304 cases — approximately 17 tests regressed.

PR #190 was reverted (`1dfa8c65`) on the same day. The branch was preserved as `archive/stage-2-catalog-main` in case the regression diff could be bisected later.

## Investigation attempted

Significant time was spent trying to identify which specific change caused the regression. **Root cause was not found.** The revert was wholesale (large diff spanning ai-worker, backend services, and DB schema), so isolating a single culprit would have required either:
- Reapplying sub-components one at a time and re-running eval per step (~30 min eval per pass × multiple commits = days of work), or
- Adding instrumentation to compare per-test behavior between pre/post-merge runs (catalog branch is too divergent from main to do this cheaply).

Neither was completed. The archive branch has been carrying mental overhead without delivering insight.

## Decision

**Delete `archive/stage-2-catalog-main` and restart Stage 2 from a clean design.** The original code is still in git history (reachable via the revert commit on main, and from several other branches that contain `896f05ff`), so this is symbolic — it removes the branch from `git branch -a` listings and from active mental scope.

Future Stage 2 attempts will be v2: redesigned, not resurrected.

## Lessons for v2

1. **Eval gate BEFORE merge, not after.** v1's eval run happened post-deploy. v2 must add a pre-merge eval check — at minimum the existing 304 cases (no point gating on cases the change is *trying* to improve, since those are expected to flip). If the suite drops by more than 1pp on existing cases, the PR is blocked at review.
2. **Smaller PRs (3 instead of 1).** v1 shipped DB schema + tools + UI + tool-loop integration as a single PR. v2 should split into independently shippable pieces:
   - **PR A:** schema only (catalog_items + schedules tables, no reads/writes from app code). Pure additive, eval delta should be 0.
   - **PR B:** entity tools registered, behind a per-page feature flag (or hardcoded `false` for all pages). Eval delta should be 0 because no page can trigger the tools.
   - **PR C:** UI + flag-flip mechanism for dogfood merchants.
3. **Each PR eval-gated independently.** Even within v2, run the eval on each PR's branch before merge. v1's all-or-nothing review meant the regression was discovered too late to bisect cheaply.
4. **Tool whitelist expansion = risk to non-tool tests.** Adding a new tool to the OpenAI tool-list changes the model's tool-selection behavior on *every* request, not just requests that need the new tool. Eval cases that previously answered from raw KB may start spuriously invoking the new tool and degrading their answer quality. v2 must explicitly test the "tool exists but should NOT be called for this question" pattern (cases like greetings, brand-voice questions, off-topic).

## Suspects (unverified — for v2 designer to consider)

These are educated guesses based on the revert diff. None were proven. v2 design should weigh each before deciding what to keep / drop / restructure.

| # | Suspect | Mechanism | Evidence weight |
|---|---|---|---|
| 1 | **Tool list bloat changed model behavior on non-catalog questions** | Adding `search_entities` / `get_entity_details` / `list_active_entities` to the tool whitelist made the model more "tool-eager" on questions answerable from raw KB. The model spent budget on tool calls that returned empty results, then composed shorter/lower-quality answers. | High — matches the "5pp on existing cases" pattern (regression hits cases NOT designed to exercise catalog) |
| 2 | **`ecommerceToolLoop.ts` refactor (+141 lines) altered existing ecommerce tool behavior** | The refactor was needed to support catalog tools in the same loop. Could have changed retry / error-handling / context-passing for the existing `get_products` / `search_products` tools. | Medium — would show up as regression in ecommerce-product test cases specifically |
| 3 | **`reply/generator.ts` changes (+43 lines)** | Touched the path that runs for *every* reply, catalog or not. Most direct way to regress non-tool cases. | Medium — change is small, but it's in a hot path |
| 4 | **No structured-vs-narrative prompt hierarchy yet** | Without the BUSINESS_INFO precedence (Stage 2.6 work), adding catalog tools meant the model had two equally-weighted authorities (raw KB chunks + catalog tool results) with no instruction on which to prefer. Inconsistent answer quality follows. | Medium — explains *why* v2 should sequence behind 2.6, but doesn't fully explain the 5pp magnitude |
| 5 | **Catalog tool descriptions / schemas confused the model** | If the tool descriptions overlapped semantically with ecommerce product tools (similar terms like "products", "items"), the model may have called the wrong tool on ecommerce questions. | Low — guessable but not verified; could be ruled out cheaply by reading the tool definitions diff |
| 6 | **Migration `0108_magical_obadiah_stane.sql` interaction** | The catalog tables existed in prod but had no rows (no merchant had used the UI yet). Any query that joined or counted across these tables would return empty, but shouldn't change AI behavior. **Unlikely culprit** — listed for completeness only. | Very low |

v2 designer should start by ruling out suspects 1 and 3 cheaply (single-PR experiments) before committing to a full re-architecture.

## What's preserved

- Original feature commit `896f05ff` is reachable from main's revert history (`git show 896f05ff`).
- The revert diff itself (`git show 1dfa8c65`) is the canonical record of what v1 contained — useful as a starting point for v2 design.
- Strategy plan at `~/.claude/plans/brief-for-the-expert-encapsulated-hearth.md` is unchanged; the *why* and *what* of Stage 2 still hold, only the *how* needs redesign.
- This post-mortem.
