// Activation funnel — shared contract between backend (emit + query) and
// frontend (admin observability panel). Single source of truth so the step
// vocabulary and response shape can't drift across the two sides.

/**
 * The five activation milestones (funnel order), plus standalone demand
 * signals that reuse the same one-row-per-user store but are NOT funnel
 * steps — they must never be added to ACTIVATION_FUNNEL_STEPS:
 *  - 'no_fb_pages'        — Facebook login completed but /me/accounts was empty
 *                           and the workspace has no connected pages (the
 *                           "Instagram-only merchant" drop-off candidate)
 *  - 'ig_direct_interest' — merchant explicitly asked for Instagram-without-
 *                           Facebook connect from the empty-pages state
 */
export type ActivationEvent =
    | 'signup'
    | 'page_connected'
    | 'kb_filled'
    | 'autoreply_enabled'
    | 'first_autoreply_sent'
    | 'no_fb_pages'
    | 'ig_direct_interest';

/**
 * Why /me/accounts came back empty for a fresh workspace — the classification
 * carried in the no_fb_pages event metadata AND returned by POST /pages/sync
 * as `reason`, so the empty state can show matching guidance. Shared so the
 * backend emit vocabulary and the frontend rendering can't drift.
 */
export type NoPagesReason =
    | 'permissions_declined' // pages_show_list not granted — re-consent fixes it
    | 'pages_unreachable'    // page target_ids authorized but no page could be fetched
    | 'instagram_only'       // no pages, but instagram_basic has authorized IG accounts
    | 'no_pages'             // all scopes granted, no page/IG targets — account manages nothing
    | 'unknown';             // /debug_token failed (usually an expired/invalid token)

/**
 * Minimum knowledge-base length (trimmed chars) for a page to count as having
 * its business info "filled". Single source of truth shared by the backend
 * activation funnel (`kb_filled` emit) and the frontend dashboard checklist /
 * KB nudge — they MUST agree, so the threshold lives here.
 */
export const KB_FILLED_MIN_CHARS = 80;

/**
 * True when a page carries real, merchant-provided business info — the gate for
 * the `kb_filled` activation milestone and the dashboard checklist / KB nudge.
 *
 * Two conditions, both required:
 *  1. At least `KB_FILLED_MIN_CHARS` of trimmed text exists.
 *  2. That text differs from the Facebook auto-sync snapshot
 *     (`suggestedKnowledgeBase`).
 *
 * The first page sync writes the SAME generated text into both `knowledgeBase`
 * and `suggestedKnowledgeBase`, so identical content means "auto-filled from the
 * FB page, never enriched by the merchant" — which must NOT count as filled, or
 * the checklist shows ✅ while replies still answer from shallow info. Once the
 * merchant edits the text or adds onboarding-wizard sections, the two diverge.
 */
export function isBusinessInfoProvided(
    knowledgeBase: string | null | undefined,
    suggestedKnowledgeBase: string | null | undefined,
): boolean {
    const kb = (knowledgeBase ?? '').trim();
    if (kb.length < KB_FILLED_MIN_CHARS) return false;
    return kb !== (suggestedKnowledgeBase ?? '').trim();
}

/**
 * Ordered funnel steps — the sequence rendered signup → first reply.
 * `satisfies` (not an annotation) keeps the literal element types, so
 * consumers can type step-keyed records without covering the demand signals.
 */
export const ACTIVATION_FUNNEL_STEPS = [
    'signup',
    'page_connected',
    'kb_filled',
    'autoreply_enabled',
    'first_autoreply_sent',
] as const satisfies readonly ActivationEvent[];

export interface ActivationFunnelStep {
    /** One of the ActivationEvent milestones. */
    key: ActivationEvent;
    /** Distinct users in the signup cohort who reached this step. */
    count: number;
}

export interface ActivationFunnel {
    /** Window size in days the cohort was selected over. */
    days: number;
    /** Steps in funnel order: signup → page_connected → … → first_autoreply_sent. */
    steps: ActivationFunnelStep[];
    /** Median wall-clock hours from signup to first auto-reply (null if nobody reached it). */
    medianHoursToFirstReply: number | null;
}
