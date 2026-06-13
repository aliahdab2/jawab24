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
