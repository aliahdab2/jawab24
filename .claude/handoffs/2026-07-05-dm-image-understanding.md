# DM Image Understanding — Context Handoff

**Read this whole file first to resume without prior context.** Feature: Jawab24 now
reads customer-sent photos in DMs (Facebook/Instagram/WhatsApp) and answers from them,
mirroring the existing voice-transcription path. Built, committed, pushed — **not yet
PR'd or merged**.

> Not gitignored: this file lives in `.claude/handoffs/` which is NOT in `.gitignore`.
> It's untracked, so it won't be committed unless explicitly `git add`ed. Don't `git add -A`.

---

## 1. Scope / status

| Item | State |
|---|---|
| Feature | Customer DM images → gpt-4.1-mini vision → normal reply pipeline |
| Branch | `feat/dm-image-understanding` (3 commits, pushed, working tree clean) |
| PR | **None opened yet** |
| Repo | `/Users/aliahdab/Documents/AutoReply` (monorepo: backend, ai-worker, frontend, packages/shared) |
| Plan file | `~/.claude/plans/curried-humming-whale.md` (full plan + Phase-0 results) |
| Memory | `~/.claude/projects/-Users-aliahdab-Documents-AutoReply/memory/project_image_understanding.md` |

Commits (newest first):
- `5b753cbf` fix(reply): answer bare customer images instead of acknowledging them
- `ef84cb65` feat(reply): finalize image caps (PAYG x2) and admin cost label
- `27d0a5b3` feat(reply): understand customer images in DMs via vision

## 2. What it does (design)

**Describe-then-enqueue**, identical shape to voice transcription:
1. Customer sends image → `nonTextHandler.ts` image branch (FB/IG: `describeFromUrl`; WhatsApp: `describeFromBuffer` via existing `getMediaInfo`/`downloadMedia`).
2. Vision (gpt-4.1-mini, `detail:'high'`) returns a text description.
3. Stored + enqueued as body `[صورة: <desc>]` / `[Image: <desc>]` (backend i18n `attachmentImageDescribed`), pipeline `image_understanding`.
4. Reply pipeline runs unchanged; **ai-worker injects a per-call IMAGE MESSAGE prompt directive** when the marker is present, so a bare product screenshot is answered (price/availability from KB), a receipt → low-confidence human follow-up, unrelated → spam.
- **Image bytes are never stored** — only the text description. **No per-merchant toggle** (default-on like voice; an earlier toggle was built then reverted per owner).

## 3. Model choice (settled — do not re-litigate)

**gpt-4.1-mini.** Measured live on 11 real Nourva images: gpt-4o-mini was ~3× pricier/image (33× image-token inflation) AND worse Arabic OCR; gpt-5-mini marginally cheaper but a reasoning model with a currency-OCR slip, no edge. Gemini ruled out by DECISIONS.md D-001. Cost ≈ $0.0015/image, ~$2–3/mo platform-wide.

## 4. Caps (final, owner-approved)

Per-plan daily image cap (`IMAGE_DAILY_LIMITS` in `backend/src/services/imageUnderstanding.ts`), **doubled when the merchant has an active top-up/PAYG balance** (`PAYG_LIMIT_MULTIPLIER = 2`, via `subscriptionsService.getTopupBalance`):

| Plan | Base | PAYG ×2 |
|---|---|---|
| free | 3 | 6 |
| starter | 5 | 10 |
| business | 40 | 80 |
| pro | 75 | 150 |
| scale-20k | 150 | 300 |
| scale-30k | 200 | 400 |

- Cap is an **abuse ceiling, not a cost lever** — actual spend tracks usage; each image reply also consumes 1 reply from the plan/top-up quota. Global kill switch: `IMAGE_UNDERSTANDING_ENABLED=false`. Fail-closed on Redis/DB error (→ nudge). Gate never throws.
- KB-vision extraction (`kb-upload.ts`) reuses the same shared `lib/dailyCap` helper (separate `vision_extract` counter, unchanged).

## 5. Files changed

**New:** `backend/src/services/imageUnderstanding.ts` (service + gate), `backend/src/utils/mediaDownload.ts` (shared fetch+timeout+size-cap, dedups transcription), `backend/src/lib/dailyCap.ts` (shared daily cap), `packages/shared/src/imageMessage.ts` (marker protocol), tests: `imageUnderstanding.test.ts`, `mediaDownload.test.ts`, `imageMessageMarker.test.ts` (drift guard).

**Modified (key):** `nonTextHandler.ts` (FB/IG + WhatsApp image branches), `transcription.ts` (uses `fetchMediaBuffer`), `subscriptions.ts` (`resolveWorkspaceSubscription` extracted, reused by `getUsageSummary`), `aiPipeline.ts` (`image_understanding`), `ai.ts`/`config/index.ts`, `ai-worker/src/services/reply/promptBuilder.ts` (IMAGE MESSAGE directive), `frontend` MessageDetailModal + MessageCard + `renderMessageText.tsx` (icon chips + `stripImageDescription` delegates to shared), admin i18n cost label, `scripts/playground-eval.ts` (Category 60 cases 663–665), `SYSTEM_ANALYSIS.md`, `.planning/codebase/ARCHITECTURE.md`+`INTEGRATIONS.md` (`.planning` files ARE tracked in this repo).

## 6. Local environment (currently running, background)

- backend **:3000** (`cd backend && npx tsx src/index.ts`) — NOTE: on 3000, not 3100; matches `frontend/.env.local`. ⚠️ If Telavox Papi Web starts it clashes on 3000 → restart backend with `PORT=3100` and point frontend there.
- ai-worker **:3002** (`cd ai-worker && npx tsx src/index.ts`) — running the fixed prompt code.
- frontend **:3001** (`cd frontend && npm run dev`).
- Postgres **:5433** (OrbStack). Secrets in `env/backend.env` (never read/echo).
- **`packages/shared` must be built** (`npm run build -w packages/shared`) — `dist/` is gitignored; consumers import from `@jawab24/shared` dist.
- Prod read-only access: `ssh -i ~/.ssh/id_jawab24_deploy root@91.99.95.196` then `docker exec -i jawab24-postgres ...` (see memory `reference_prod_postgres_access`).

## 7. Verification status (honest)

- ✅ Targeted suites pass: promptBuilder 78, image gate 22, mediaDownload 7, drift-guard 5. Pre-commit hook ran eslint+tsc across backend/ai-worker/frontend on both commits.
- ✅ Live E2E (real Nourva image → real vision → local ai-worker → real KB): product screenshot → correct "160 دينار / free delivery" answer (intent QUESTION); history follow-up resolves; legal doc → no pitch, no 500.
- ⚠️ **NOT re-run since last edits:** full backend + ai-worker unit suites, and `npm run eval` (cases 663–665 are new). Last full backend green was 4338 before the eval-file + doc edits (those don't touch unit suites). **Run these before merge.**

## 8. Hard rules (this repo)

- **No `Co-Authored-By` / trailers / AI attribution** in commits (user global rule overrides the harness default). Conventional commits. Commit author = user.
- RTL logical props (`ps-/pe-`, `start/end`), i18n keys via next-intl (`useTranslations`) / backend `utils/i18n.ts`, no `any`, zero lint errors+warnings, run tests after changes, proper root-cause fixes.
- Read `AI_INSTRUCTIONS.md` + `DECISIONS.md` first.

## 9. To resume

1. Read this file.
2. `cd /Users/aliahdab/Documents/AutoReply && git checkout feat/dm-image-understanding` (already there; tree clean).
3. `npm run build -w packages/shared` (ensure shared dist current).
4. Final verify: `cd backend && npx vitest run`; `cd ai-worker && npx vitest run`; `cd frontend && npm run translation:validate`; optional `npm run eval`.
5. Then decide next step (below).

## 10. Next steps / remaining

- [ ] **Run full suites + eval smoke** (cases 663–665) — the one gap before merge.
- [ ] **Open the PR** for `feat/dm-image-understanding`. Put the model-comparison table + per-plan cost table (both in the plan file) in the description.
- [ ] **Clean up 2 demo rows** in the LOCAL dev DB (added to visualize the inbox UI, conversation "أم ريان"): `DELETE FROM messages WHERE id IN ('5f4a7f80-465b-4b95-ab5d-76dd5da2cf0d','3c6c158e-5e48-43e0-8113-7c8b3a9031d6');`
- [ ] Post-deploy: watch `image_understanding` cost rows + nudge-rate drop to confirm real-world behavior.
- **Documented v1 limitations:** only `attachments[0]` (multi-image = 1 read); FB/IG combined text+image events drop the attachment; captioned WhatsApp images take caption-as-text (no vision).

**Parked (owner-deferred, revisit only if the feature proves valuable):**
- Native **shared-post** image vision (customer uses Share button → today only the caption is read, NOT the post image). Do it cost-wise: describe once, cache by post ID (`post_image_desc:{platform}:{postId}`).
- WhatsApp captioned-image vision enrichment. KB ingestion of own-post image descriptions (helps comment-reply path).

## 11. Open product questions

- None blocking. Owner accepted current caps and default-on. The "should native *shares* also read the image" question = the parked follow-up above.

## 12. Key conversation turns (compact)

- Started as "should we use Gemini / cheaper / local model?" → concluded stay gpt-4.1-mini; pivoted to building customer-image understanding (the real gap: images were getting a "please type" nudge).
- Removed the per-merchant settings toggle at owner's request (redundant with `messagesAutoReply`, inconsistent with voice which has none).
- Extracted shared helpers (`fetchMediaBuffer`, `dailyCap`, `resolveWorkspaceSubscription`, `imageMessage`) after owner pushed on "no duplicated code."
- Caps iterated many rounds; owner landed on 3/5/40/75/150/200 ×2-on-PAYG after real Nourva data (Pro, ~63 img/day peak 107, buys heavy top-ups, ~6.5% image:reply ratio).
- **Live E2E caught a real bug pre-merge:** bare product image → model said "thanks for sharing" instead of answering. Fixed with the per-call IMAGE MESSAGE prompt directive (no PROMPT_VERSION bump — injected only when marker present, non-image prompts byte-identical). Re-tested: now answers correctly.

## 13. Where-am-I map

- Service + gate: `backend/src/services/imageUnderstanding.ts`
- Wiring: `backend/src/services/reply/nonTextHandler.ts` (image branches)
- Prompt fix: `ai-worker/src/services/reply/promptBuilder.ts` (search "IMAGE MESSAGE")
- Marker protocol: `packages/shared/src/imageMessage.ts`
- Caps: `IMAGE_DAILY_LIMITS` in the service
- Plan: `~/.claude/plans/curried-humming-whale.md`

---

**Default next action for the new Claude:** ask the user what they want to do (run final verification, open the PR, or start the parked shared-post work). The handoff is context, not a directive.
