# Language Detection — Migration to Statistical Detector

## Why

The current detector at `backend/src/utils/language.ts` is a hand-coded
heuristic: Unicode script ranges + hardcoded word lists per language
(`ENGLISH_COMMON`, `SWEDISH_COMMON`) + regex checks for Turkish, German,
French, Spanish. It works, but:

- **Doesn't scale with new languages.** Every language we add (planned:
  Turkish, more Swedish coverage, others) needs hand-curated word arrays
  and regex rules.
- **Confidence scores are made-up.** The `0.5 + matches * 0.1` formula
  has no statistical basis — thresholds like "< 0.6 = ambiguous" are
  empirical guesses.
- **Short text is a weak spot.** Single-word Latin tokens (e.g. "ICDL",
  "ok", "hi") can't be distinguished from "one word of clear English"
  without heuristics that fail at the edges (recently patched: the
  "ICDL mid-Arabic chat" bug).
- **Maintenance burden.** Punctuation stripping, edge cases, and
  threshold tuning keep recurring as real-world inputs surface.

## Goal

Replace the body of `detectLanguage` with a statistical language
detector, **keeping the public signature unchanged** so callers don't
change:

```ts
export function detectLanguage(text: string): LanguageDetectionResult
export function detectLanguageCode(text: string): SupportedLanguage
export function detectCommentLanguage(comment, postMessage): SupportedLanguage
export function isRTL(text: string): boolean
```

## Recommended library: `tinyld`

- Covers 110+ languages, zero dependencies, ~1MB, pure JS
- Returns `{ lang: ISO639-1, accuracy: 0..1 }`
- Works well on short text (its primary use case)
- MIT license, actively maintained
- Alternatives evaluated:
  - `franc` — 400+ languages, but struggles on short text (<20 chars)
  - `cld` / `cld3` — native addons; install friction on macOS/Linux CI
  - `@xenova/transformers` (BERT language ID) — overkill, slow, large

## Plan

### Phase 1 — drop-in replacement
1. `npm i tinyld -w backend`
2. Rewrite `detectLanguage` body:
   - Keep the early script-range guards for Arabic (RTL signal is
     still semantically important for our RTL-aware UI and reply
     language logic) and other non-Latin scripts we don't support
     (Hebrew, CJK, Japanese, Korean, Cyrillic, Thai → 'unknown').
   - For Latin-script text, delegate to `tinyld.detectAll(text)`.
   - Map `tinyld` result to `SupportedLanguage` (ar, en, sv, de, fr,
     es, tr, unknown) — anything else → 'unknown'.
   - Return `accuracy` as `confidence` directly (real statistical score).
3. Delete `ENGLISH_COMMON`, `SWEDISH_COMMON`, and the per-language
   regex blocks (Turkish/German/French/Spanish word-match checks).
4. Run existing `test/utils/language.test.ts` — 41 tests act as the
   regression suite. Tune any failures (some thresholds in existing
   tests may need adjustment to match real statistical confidence).

### Phase 2 — tune thresholds
1. The `< 0.6` confidence threshold in `generator.ts` DM path was
   calibrated to the current detector. Re-validate with `tinyld`.
2. Add a structured log field `detected_language_confidence` to
   `reply_sent` logs so we can observe real-world distribution and
   refine thresholds empirically.
3. Update the test that uses confidence 0.5/0.8 as mock values —
   `tinyld` produces different ranges for the same inputs. Mock
   values should reflect typical `tinyld` outputs.

### Phase 3 — expand SupportedLanguage
With a statistical detector in place, adding a new language is just:
1. Add the code to `SupportedLanguage` type
2. Add to `languageNames` map in `ai-worker/src/services/openai.ts`
3. Add prompt-level i18n strings (`backend/src/utils/i18n.ts`)
4. Done — `detectLanguage` handles it automatically.

## Risk & rollback

- Bundle impact: ~1MB on backend container. Negligible for a Node
  service (no cold-start sensitivity).
- Per-call latency: `tinyld` runs in <1ms for short text (tested).
- Accuracy regression: existing 41 unit tests are the safety net.
  Additional real-world eval: run the 226-test AI eval suite before
  and after — compare scores.
- Rollback: keep the swap behind a feature flag
  (`LANG_DETECTOR=tinyld|legacy`) for one deploy cycle, flip to
  `tinyld` by default, then remove flag + legacy code.

## Out of scope

- **LLM-based detection.** We could skip pre-detection entirely and
  let GPT pick the language. Considered and rejected: pre-detection
  is cheap, cacheable, and decouples language from AI generation
  (important for fallback replies, away messages, greetings).
- **Client-side detection.** Not needed — all language-dependent
  logic runs server-side.

## Success criteria

- `detectLanguage` signature unchanged; all callers keep working.
- All 41 `language.test.ts` tests pass (possibly with updated
  confidence assertions).
- Full backend test suite passes (`npm run test`).
- ICDL regression test in `generator.test.ts` still passes.
- AI eval suite (`npm run eval`) score delta within ±1% of current
  baseline (97.6%).
- Bundle size increase < 1.5MB measured in Docker image.
