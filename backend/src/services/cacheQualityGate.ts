/**
 * Save-side quality gate for the AI reply caches (exact + semantic).
 *
 * A cached reply is a reply we have decided to repeat — for up to 30 days, to
 * every customer who sends the same (normalized) message. A reply the model
 * itself marked weak must therefore never be saved: serving it once is a
 * one-off; serving it from cache turns one weak answer into a policy.
 *
 * The gate trusts the reply's own labels (the same trust model as the
 * gender/neutral bucket save guards in ai.ts — no reply-text inspection):
 *   - `confidence === 'low'` — the model's own uncertainty signal. The reply
 *     validator also coerces confidence to 'low' when it detects unanswered
 *     questions, so this catches validator-flagged weakness too.
 *   - `info_not_in_kb` — the customer asked something the Business Info can't
 *     answer. The merchant may fill the gap tomorrow; the kbv: key segment only
 *     rotates on KB saves, so an early cache entry would keep serving the
 *     "I don't have that information" answer meanwhile.
 *   - `price_not_in_kb` — the reply mentions a price not grounded in the KB.
 *   - `date_not_in_source` / `stale_date` — the reply quoted a calendar date that no
 *     source supports, or one already in the past. Dates are the most perishable
 *     content a reply can carry: a cached one is wrong later even when it was right
 *     when generated.
 *   - `reply_not_grounded` — the grounding verifier found an unsupported claim.
 *     Never worth repeating.
 *   - `language_mismatch` — the reply came back in the wrong language.
 *
 * Fail-open by design: undefined confidence/flags pass the gate. Failover or
 * legacy worker responses without these fields must keep caching exactly as
 * they did before the gate existed.
 *
 * Pure module — no I/O. The caller (ai.ts) computes ONE decision per generated
 * reply and applies it to both the exact-cache and semantic-cache save sites,
 * so the two layers can never diverge. Kill-switch: AI_QUALITY_GATE_ENABLED
 * (config.ai.qualityGateEnabled) — checked by the caller, not here.
 */

export type CacheRejectReason =
    | 'low_confidence'
    | 'info_not_in_kb'
    | 'price_not_in_kb'
    | 'date_not_in_source'
    | 'stale_date'
    | 'reply_not_grounded'
    | 'language_mismatch'
    | 'self_identification_stripped';

/**
 * Flags that block caching, in priority order (first tripped wins — mirrors
 * the reason-counter convention of the gender/neutral bucket guards).
 * Exact membership only: dynamic companion flags such as `expected_lang:<x>` /
 * `reply_lang:<x>` never match and never block on their own.
 *
 * `low_confidence` appears BOTH as a confidence value ('low') and as a
 * model-emitted flag (systemPrompt: "low_confidence if you are uncertain") —
 * the model can flag itself uncertain while still reporting confidence
 * 'medium'. Both routes must gate, and they share one reason label.
 */
const REJECT_FLAGS: readonly CacheRejectReason[] = [
    'low_confidence',
    'info_not_in_kb',
    'price_not_in_kb',
    // Checks 1c/1d: the reply quoted a calendar date that is in no source, or one
    // that has already passed. A date is the most perishable thing a reply can
    // contain — caching it for up to 30 days guarantees it is wrong later even if
    // it was right when generated, which is why these gate the cache while
    // remaining non-destructive to the reply itself.
    'date_not_in_source',
    'stale_date',
    // Post-send grounding audit found an assertion Business Info doesn't
    // support. Caching it would serve the same fabrication to every customer
    // who asks a similar question — the one failure mode worse than one bad reply.
    'reply_not_grounded',
    'language_mismatch',
    // Check 6 mutated the reply (stripped the reveal sentence) — caching the
    // trimmed remainder against the customer's actual question would serve a
    // partial answer for 30 days (#495 review L2). This flag is ALSO what keeps
    // an exhausted strip (reply stripped to empty) out of the caches: the save
    // decision is made here, at generation time, well before the pipeline
    // decides to withhold — so the hold is not what protects the cache, this
    // entry is. Removing it would start caching empty replies.
    'self_identification_stripped',
];

/**
 * Decide whether a generated reply may be cached.
 *
 * @param confidence the model-reported confidence — typed `string` (not the
 *   enum) because it arrives over HTTP from the ai-worker and the wire shape
 *   is not trusted; anything other than the literal 'low' passes.
 * @param flags the model+validator flag list, free-form strings.
 * @returns null when the reply is cacheable, else the (single) reject reason.
 */
export function cacheRejectReason(
    confidence: string | undefined,
    flags: readonly string[] | undefined,
): CacheRejectReason | null {
    if (confidence === 'low') return 'low_confidence';
    if (flags) {
        for (const reason of REJECT_FLAGS) {
            if (flags.includes(reason)) return reason;
        }
    }
    return null;
}
