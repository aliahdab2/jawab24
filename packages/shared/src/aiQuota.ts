// AI reply quota state — the single source of truth for "how close is this
// merchant to actually running out of Smart Replies?".
//
// The plan cap is NOT the wall. `subscriptionsService.canUseAiReplies` falls
// through to the non-expiring top-up balance once the plan quota is spent, and
// `incrementAiReplies` charges the overflow against that balance. So the real
// runway for a period is `planLimit + topupBalance`, and any surface that
// measures against the plan cap alone will either alarm when nothing is wrong
// (a merchant past the cap with balance behind it) or stay calm while replies
// are about to stop (a merchant past the cap with a nearly-drained balance).
//
// That rule had been copy-pasted across every surface that talks about the cap,
// and the admin console was missing it altogether — which is how a merchant with
// 9,417 top-up replies was told "replies will go silent at the cap". Keep the
// policy here; consumers map the returned state to their own copy/severity.
//
// Consumers:
//   - `computeHealthFlags` (backend/src/services/admin/health.ts) — support console
//   - `resolveAiUsageNotificationType` (backend/src/services/subscriptions.ts) —
//     the merchant's 80%/100% threshold notification
//   - `AiUsageWarningBanner` (frontend/src/components/dashboard) — dashboard banner
//   - `CommandCenter` (frontend/src/components/dashboard) — Smart Replies tile severity
//
// NOT a consumer, deliberately: `computeCrossedAiThresholds`. It answers "which
// PLAN-CAP boundary did this increment just cross", which is a billing event and
// has to stay measured against the plan cap. `incrementAiReplies` charges overflow
// to the balance and never pushes `ai_replies_count` past the cap, so an
// 80%-of-CAPACITY boundary would sit beyond anything that counter can ever reach —
// re-pointing it at capacity would silently delete the 80% notification for every
// top-up holder. Detection stays on the cap; only the wording and the severity
// key off the wall.

/**
 * Fraction of TOTAL capacity (plan + top-up) at which a merchant counts as
 * approaching the wall. With no top-up balance this reduces to the historical
 * "80% of the plan cap" behaviour.
 */
export const AI_QUOTA_NEAR_WALL_RATIO = 0.8;

export type AiQuotaState =
    /** No finite plan cap to measure against (unlimited plan, or no cap set). */
    | 'unmetered'
    /** Comfortably inside the plan quota. */
    | 'under_cap'
    /** Approaching the plan cap with nothing behind it — the cap IS the wall. */
    | 'near_cap'
    /** Approaching the plan cap, but a top-up balance absorbs the overflow. */
    | 'near_cap_on_topup'
    /** Plan quota spent; replies are flowing from the top-up balance. */
    | 'on_topup'
    /** Plan quota AND top-up balance both spent — replies genuinely stop here. */
    | 'exhausted';

export interface AiQuotaInput {
    /** Plan replies consumed this period (`usage.ai_replies_count`). */
    used: number;
    /** Plan cap (`plans.max_ai_replies_per_month`); null = unlimited. */
    limit: number | null;
    /** Non-expiring top-up balance (`users.topup_balance`). */
    topupBalance: number;
}

export interface AiQuotaStatus {
    state: AiQuotaState;
    /** Total replies available this period (plan + top-up); null when unmetered. */
    capacity: number | null;
    /** Replies left before replies actually stop; null when unmetered. */
    remaining: number | null;
    /**
     * True once consumption reaches `AI_QUOTA_NEAR_WALL_RATIO` of total capacity —
     * i.e. replies really are about to stop. This, not the plan cap, is what a
     * "replies will stop" warning must key off.
     */
    nearWall: boolean;
}

/**
 * Classify a merchant's reply runway. Pure — no DB, no clock.
 *
 * A negative or missing balance is clamped to 0 so a bad row can only ever make
 * the verdict more conservative, never invent runway that doesn't exist.
 */
export function resolveAiQuotaStatus({ used, limit, topupBalance }: AiQuotaInput): AiQuotaStatus {
    const balance = Number.isFinite(topupBalance) ? Math.max(0, topupBalance) : 0;

    // No finite cap: the plan doesn't meter replies, so there is no wall to warn
    // about. `limit <= 0` lands here too — it carries no usable signal, and the
    // callers that gate on a cap already treat it as "not metered".
    if (limit === null || limit <= 0) {
        return { state: 'unmetered', capacity: null, remaining: null, nearWall: false };
    }

    const capacity = limit + balance;
    const remaining = Math.max(0, capacity - used);
    const nearWall = used >= AI_QUOTA_NEAR_WALL_RATIO * capacity;

    if (used >= capacity) {
        return { state: 'exhausted', capacity, remaining: 0, nearWall: true };
    }
    if (used >= limit) {
        return { state: 'on_topup', capacity, remaining, nearWall };
    }
    if (used >= AI_QUOTA_NEAR_WALL_RATIO * limit) {
        return {
            state: balance > 0 ? 'near_cap_on_topup' : 'near_cap',
            capacity,
            remaining,
            nearWall,
        };
    }
    return { state: 'under_cap', capacity, remaining, nearWall };
}
