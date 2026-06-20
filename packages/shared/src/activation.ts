// Activation funnel — shared contract between backend (emit + query) and
// frontend (admin observability panel). Single source of truth so the step
// vocabulary and response shape can't drift across the two sides.

/** The five activation milestones, in funnel order. */
export type ActivationEvent =
    | 'signup'
    | 'page_connected'
    | 'kb_filled'
    | 'autoreply_enabled'
    | 'first_autoreply_sent';

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

/** Ordered funnel steps — the sequence rendered signup → first reply. */
export const ACTIVATION_FUNNEL_STEPS: readonly ActivationEvent[] = [
    'signup',
    'page_connected',
    'kb_filled',
    'autoreply_enabled',
    'first_autoreply_sent',
] as const;

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
