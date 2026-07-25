# Reply Cache — Design, Operations & Revert Runbook

> The single source of truth for how reply caching works, how to measure it, and —
> if it ever stops earning its keep — exactly how to revert the gender-related
> machinery. Rationale lives in `DECISIONS.md` (D-030, D-033, D-036); this doc is
> the operational map. Last full revision: 2026-07-25.

## 1. What the cache is for

**Burst latency, not primarily cost.** Ad-driven traffic sends hundreds of
near-identical first messages in bursts; a cache hit answers in milliseconds
instead of the 2–6 s model round-trip, and absorbs OpenAI rate/latency spikes.
The dollar value of the exact/semantic layers is real but small (≈ $2/week at
historical hit rates); the dominant *cost* lever is OpenAI's own server-side
prompt cache (§2.1), which is unaffected by anything in this doc. This framing
was settled during the 2026-07-22 external review — don't re-argue the cache in
dollar terms.

## 2. The three layers

A reply attempt passes through, in order:

### 2.1 OpenAI prompt cache (server-side, always on)
Not our code. The static prompt prefix (system prompt + few-shot + Business
Info) repeats across calls, so 85–93 % of `dm_reply` input tokens bill at ¼
price as `cached input`. Unaffected by our key design, flushes, or flags. This
is where most of the money is saved.

### 2.2 Exact cache (Redis, `backend/src/services/ai.ts`)
Hash-keyed full-reply cache. TTL **30 days** (`'EX', 30*24*60*60`). Key anatomy
in §3. Serves both channels; DMs only on **first touch** (no conversation
history — reads *and* saves are gated on `!hasConversationHistory`; the save
gate is the #476 context-leak fix, see §8-Exception).

### 2.3 Semantic cache (pgvector, `backend/src/services/kb/semantic-cache.ts`)
Embedding-similarity lookup for *paraphrases* of already-answered questions.
Intent-aware cosine thresholds (0.88 greeting … 0.95 complaint, default 0.93).
Skipped entirely for `PRICE`, `PURCHASE_INTENT`, `COMPLAINT` intents, when
`customerContext` is present, and mid-conversation. TTL backstop
`SEMANTIC_CACHE_TTL_DAYS = 30` (kept in sync with `utils/cleanup.ts`). Scoped by
`kbActiveVersion` + `PROMPT_VERSION` + channel + replyStyle + model +
brandVoiceHash. In practice this layer serves **comments**; DM traffic rarely
reaches it.

## 3. Exact-cache key anatomy (`buildCacheKey`, ai.ts)

Segments concatenated then **SHA-256-hashed** (so Redis `--scan` can never find
individual segments — counters are the only visibility):

- `PROMPT_VERSION` (`pv:`) — any prompt bump orphans every entry ("flush")
- `kbActiveVersion` — any Business Info/catalog edit orphans the page's entries
- normalized message text (`normalizeForExactCacheKey` — shared with the warm job)
- `postMessage` (comments), `replyStyle`, `customerContext`, channel
- **DM-only gender/name segment — the precedence chain (D-033/D-036):**

| Priority | Segment | When | Shared across |
|---|---|---|---|
| 1 | `g:d` | `AI_DUAL_VARIANT_ENABLED` **and** reader's gender map-known | ALL senders (entry stores `variants:{m,f}`, reader's variant picked at serve time) |
| 2 | `g:n` | reply certified genderless (`gender:'unknown'` + `used_name:false` + name-substring check) | ALL senders |
| 3 | `g:m` / `g:f` | sender's gender confidently known via the fleet map | all same-gender senders |
| 4 | `n:<md5(first name)[:16]>` | fallback — gender unknown, reply not certified neutral | only same-first-name senders |

Read order is most-specific-first (a warmer personalized entry beats a blander
shared one): `g:d` probe → `checkCache` (`g:m`/`g:f` **or** `n:`) → `g:n`.
Two Redis probes max (+1 when dual-variant is live). Unknown-gender readers
**never** probe gender buckets — no guessing, ever (D-033).

**History note:** segment 4 is the v51 (2026-07-04) gendered-addressing change
that collapsed DM hit rates from 20–33 % to ~1 % (every distinct first name =
its own key). Segments 1–3 are the recovery machinery. The goal state is that
4 is a rare tail, not the main path.

## 4. Save-side rules (what is allowed into the cache)

1. **Quality gate** (`cacheQualityGate.ts`, #476): one `cacheRejectReason
   (confidence, flags)` decision gates BOTH exact + semantic saves. Blocks
   `low` confidence (including the model's own `low_confidence` flag at medium
   confidence), `info_not_in_kb`, `price_not_in_kb`, `language_mismatch`.
   Fail-open on missing fields. Pure code — no extra model call, no latency.
2. **Neutral certification** (`g:n` save): model's own labels are the
   certificate — `gender:'unknown'` + strict `used_name:false` + normalized
   name-substring check. ~18 % of Arabic DM replies qualify (measured 07-25).
3. **Gender-bucket guard** (`g:m`/`g:f` save): reply's self-reported gender
   must match the reader's bucket AND the reply must not contain the sender's
   name; otherwise downgrade to per-name (counter `save_downgrade:*`).
4. **Dual-variant transform** (`genderVariantTransform.ts`, #479 — **dark**):
   at save time a fire-and-forget model call produces the opposite-gender
   rendering; content-invariance guards (digit-sequence equality, length-ratio
   0.7–1.4) discard any variant that bends a price. Transform failure ⇒ legacy
   save. Dialect preservation is explicitly NOT code-checkable — it is the job
   of the (still un-built) transform eval that gates the flag.
5. **No-history gate**: DM saves (like reads) only on first touch — the #476
   context-leak fix. **This is a correctness rule, not cache machinery** (§8).

## 5. The gender map (`genderMap.ts`) + backfill

Fleet-learned name→gender map in Redis (`gender:name:<hash>:{m,f}` counters,
90-day rolling TTL). Confidence requires ≥ 5 observations at ≥ 90 % majority
(`MIN_OBSERVATIONS=5`, `MIN_MAJORITY_RATIO=0.9`). Observations accrue from each
reply's self-reported labels — D-015-compliant (model inference, never a
hand-maintained name list).

Organic learning is too slow for the long tail (prod has **16,506 distinct
first names**; 3 weeks of organic accrual ≈ 175 names). The one-off
**backfill** (`scripts/backfill-gender-map.ts`, #478) batch-classifies
historical `conversations.sender_name` first names and seeds via
`seedGenderObservation` (seed = exactly 5, so ONE contrary organic observation
self-heals a wrong seed; skip-if-exists; `unknown` writes nothing). Cost ≈
$0.02–0.05 / 2,000 names. Run recipe (prod DB/Redis are compose-internal; prod
image has no tsx): esbuild-bundle → `docker cp` into the active backend
container → `node /tmp/backfill-gender-map.cjs --dry-run|--apply --limit 2000
--user-id <admin uuid>`. Suggested cadence: quarterly, or after large merchant
onboarding. First applied 2026-07-25: top-2,000 names → 1,202 seeded (415 m /
787 f), 578 unknown, `gender:name:*` keys 350 → 1,558.

## 6. Warm job (`backend/src/scripts/warm-reply-cache.ts`, #477)

Post-deploy hook (deploy-on-server.sh, non-fatal): replays the top
`WARM_CACHE_TOP_N` (300) last-7-days AI-replied **comments** through
`generateForPlayground` — writes caches, sends nothing, deadline-capped
(`WARM_CACHE_DEADLINE_MS` 10 min). Exists because every `PROMPT_VERSION` bump
flushes the cache (v53's bump cratered comment hits to 1.7 % for a week; the
v59 bump on 07-24 recovered to 26 % the same morning thanks to warming).
Non-public/dual-mode pages are skipped by design (their comments flatten to
name-bucketed DM keys). Summary in `metrics:cache:warm:last_run`; cumulative
`warm:generated_total` vs `warm:hits_total` is the ROI counter (46 → 38 as of
07-25 — each hit is a free reply). Cost rows bill under the merchant's userId
with pipeline `cache_warm`.

## 7. Flags, counters, measurement

**Kill switches** (all read at boot — changing them needs
`up -d --no-deps --force-recreate` of the backend, NOT a plain restart):

| Env var | Default | Controls |
|---|---|---|
| `AI_QUALITY_GATE_ENABLED` | on (`!== 'false'`) | §4.1 save gate |
| `AI_NEUTRAL_BUCKET_ENABLED` | on | `g:n` bucket |
| `AI_GENDER_BUCKET_ENABLED` | on | `g:m`/`g:f` bucket |
| `AI_DUAL_VARIANT_ENABLED` | **off** (`=== 'true'`) | `g:d` dual-variant — keep dark until the dialect eval passes (D-036) |
| `WARM_REPLY_CACHE_DISABLED=1` | off | skips the deploy-time warm |

**Counters** (Redis, prefix `metrics:cache:`): `quality_gate:save_ok:<pipeline>`
/ `save_reject:<reason>:<pipeline>` · `neutral_bucket:hit|save_ok|save_reject:
<gendered|used_name|name_substring|not_reported>` · `gender_bucket:read|save_ok|
save_downgrade:<used_name|name_substring|gender_mismatch>` · `dual_variant:
hit:{m|f}|save_ok|save_reject:<no_api_key|unparseable|numbers_changed|
length_drift|transform_failed>` · `warm:last_run|generated_total|hits_total`.

**Measurement recipes** (read-only):

```bash
# Daily hit rates per pipeline
./scripts/prod-db-query.sh "SELECT created_at::date, pipeline, count(*),
  count(*) FILTER (WHERE cached),
  round(100.0*count(*) FILTER (WHERE cached)/count(*),1)
  FROM ai_usage_log WHERE created_at >= '<date>'
  AND pipeline IN ('dm_reply','comment_reply') GROUP BY 1,2 ORDER BY 1,2;"

# Counters (SSH + docker exec pattern — password via container env, never argv)
# see memory/prod-redis-access; scan prefix metrics:cache:
```

Gate health = rejects/(rejects+save_ok) per pipeline; **> 25–30 % sustained**
means the gate is starving the cache — investigate flag distribution before
touching anything else. Healthy reference (07-24 checkpoint): dm 1.8 %,
comment 6.7 %.

## 8. Revert runbook — «if the cache does not improve we revert everything»

Standing owner ruling (2026-07-22). This section makes it executable.

**Judge per stage, on its own trial window:**

- **Foundation (#476 gate + #477 warm)** — judged on COMMENT metrics at the
  3-day checkpoint. **Verdict already rendered 2026-07-24: KEEP** (comment
  49.8 % on 07-24 vs 31.9 % pre-deploy best; survived the v59 flush at 26 %
  next morning; gate rejects in the healthy band).
- **Gender stack (#478 backfill + #479 dual-variant + the v53/g:n buckets)** —
  judged on DM hit % after a fair trial: backfill applied + ~2 weeks, and for
  #479 specifically ~2 weeks *flag-on* (it ships dark; flat DM numbers while
  the flag is dark are NOT failure). Success ≈ DM moving from ~2 % toward
  8–15 % (buckets alone) / 20–33 % June parity (dual-variant). Guard metric:
  `gender_bucket:save_downgrade:gender_mismatch` near zero — a spike means the
  map is mislabeling; stop and review before judging the design.

**Revert mechanics, cheapest first** (each step independently sufficient —
stop at the first one that restores acceptable behavior):

1. **Flags off** (env-only, minutes): `AI_DUAL_VARIANT_ENABLED` already off /
   `AI_GENDER_BUCKET_ENABLED=false` / `AI_NEUTRAL_BUCKET_ENABLED=false` /
   `AI_QUALITY_GATE_ENABLED=false`; recreate backend. Map entries and cache
   entries self-expire (90 d / 30 d) — no data cleanup needed.
2. **Warm job off**: `WARM_REPLY_CACHE_DISABLED=1` in the deploy env.
3. **Gender-map wipe** (only if seeded data itself is suspect): delete
   `gender:name:*` keys — the map regrows organically; nothing else references it.
4. **Full v51 revert** (last resort, ~1 day of work): remove gendered DM
   addressing from the prompt AND the `n:`/gender segments from
   `buildCacheKey` — returns to the pre-July-4 shared-key world. This
   sacrifices the gendered-personalization product feature; owner call only.

**⚠️ THE EXCEPTION — do not revert `cea25bf4` (in #476):** the exact-cache
save-side `!hasConversationHistory` gate is a **correctness fix** — before it,
mid-conversation replies could be saved under first-touch keys and serve one
customer's context to another customer. Reverting it reintroduces a real
wrong-content bug. It stays under ANY revert scenario, including step 4.

**Bookkeeping:** any reversal gets a new `D-NNN` entry superseding D-036
(append-only — never edit the old ruling).

## 9. Timeline (context for future readers)

| Date (2026) | Event |
|---|---|
| June | DM exact cache healthy: 20–33 %/day (shared first-touch keys) |
| Jul 04 | **v51** gendered DM addressing + per-name keys → DM hits collapse to ~1 % |
| Jul 17 | **v53** (#452, D-030) `g:m`/`g:f` fleet-map buckets — starved, no recovery |
| Jul 21 | **#474** (D-033) `g:n` certified-neutral shared bucket (~18 % ceiling) |
| Jul 22 | **#476–#479** (D-036): quality gate + context-leak fix, warm job, backfill script, dual-variant (dark) |
| Jul 24 | 3-day checkpoint: comment cache verdict KEEP (49.8 % peak; gate healthy) |
| Jul 25 | v59-flush survival confirmed (26 % same-morning); gender-map backfill APPLIED (1,202 names seeded; map 350 → 1,558 keys) |

Related reading: `DECISIONS.md` D-015 / D-030 / D-033 / D-036 ·
`.planning/dm-cache-gender-study.md` (the July-22 deep study) · code comments
around `buildCacheKey` in `backend/src/services/ai.ts`.
