import { DEFAULT_AI_MODEL, PLACEHOLDER_TIMEZONE } from '@jawab24/shared';

/**
 * Admin support-console health flags.
 *
 * A pure, DB-free diagnostic layer: `computeHealthFlags` takes data already
 * fetched by `getUserDetail` and returns the list of problems/warnings a support
 * agent should see at a glance ("why isn't this merchant getting good replies?").
 *
 * Kept side-effect free so it is unit-testable with plain fixtures (no Drizzle
 * mocking). The heuristics mirror the `/merchant-settings` + `/reply-quality`
 * skill playbooks — keep the two in sync when a flag changes.
 */

export type FlagSeverity = 'red' | 'yellow' | 'info';

export interface HealthFlag {
    /** Stable key; the frontend maps it to i18n `customer.flag_<key>`. */
    key: string;
    severity: FlagSeverity;
    /** Set for page-scoped flags so the UI can show which page. */
    pageId?: string;
    pageName?: string | null;
    /** ICU interpolation params for the translated message. */
    meta?: Record<string, string | number>;
}

/** Per-page KB summary (counts/lengths only — never the raw KB text). */
export interface PageKbSummary {
    kbLength: number;
    kbActiveVersion: number | null;
    kbUpdatedAt: Date | null;
    chunksTotal: number;
    chunksByType: Record<string, number>;
    unresolvedGaps: number;
}

/** The subset of the settings row the support console reads. */
export interface SupportSettings {
    aiEnabled: boolean | null;
    aiModel: string | null;
    commentsAutoReply: boolean | null;
    messagesAutoReply: boolean | null;
    commentReplyMode: string | null;
    holdLowConfidence: boolean | null;
    businessHoursOnly: boolean | null;
    businessHoursStart: string | null;
    businessHoursEnd: string | null;
    timezone: string | null;
    replyStyle: string | null;
    brandVoiceNotes: string | null;
    brandVoiceNotesMulti: Record<string, string> | null;
    greetingMessageEnabled: boolean | null;
    greetingMessageMulti: Record<string, string> | null;
    awayMessageMulti: Record<string, string> | null;
    limitFallbackEnabled: boolean | null;
    replyDelay: number | null;
    defaultReplyLanguage: string | null;
    supportedLanguages: string[] | null;
    autoDetectLanguage: boolean | null;
    newLeadAlertsEnabled: boolean | null;
    notificationsEnabled: boolean | null;
    onboardingCompletedAt: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}

export interface HealthInputPage {
    id: string;
    name: string | null;
    disconnected: boolean;
    autoReplyEnabled: boolean | null;
    autoReplyDisabledReason: string | null;
    kb: PageKbSummary;
}

export interface HealthInput {
    now: Date;
    lastSeenAt: Date | null;
    settings: SupportSettings | null;
    subscription: {
        status: string | null;
        trialEndsAt: Date | null;
    } | null;
    pages: HealthInputPage[];
    usage: { aiRepliesCount: number; limit: number | null };
    /** True when the user owns no pages but is a member of someone else's workspace. */
    isTeamMemberOnly: boolean;
}

/**
 * Defaults for every setting the console surfaces, mirroring the Drizzle column
 * defaults (backend/src/db/schema.ts:487-552). Reused constants come from the
 * shared package so this can't silently drift from the schema.
 */
export const SETTINGS_DEFAULTS = {
    aiEnabled: true,
    aiModel: DEFAULT_AI_MODEL,
    commentsAutoReply: true,
    messagesAutoReply: true,
    commentReplyMode: 'public',
    holdLowConfidence: false,
    businessHoursOnly: false,
    businessHoursStart: '09:00',
    businessHoursEnd: '18:00',
    timezone: PLACEHOLDER_TIMEZONE,
    replyStyle: 'professional',
    brandVoiceNotes: '',
    brandVoiceNotesMulti: {},
    greetingMessageEnabled: false,
    greetingMessageMulti: {},
    awayMessageMulti: {},
    limitFallbackEnabled: false,
    replyDelay: 3,
    defaultReplyLanguage: 'ar',
    supportedLanguages: ['en', 'ar'],
    autoDetectLanguage: true,
    newLeadAlertsEnabled: true,
    notificationsEnabled: true,
} as const;

/** The settings keys the console diffs against defaults, in display order. */
export const SUPPORT_SETTINGS_KEYS = Object.keys(SETTINGS_DEFAULTS) as Array<keyof typeof SETTINGS_DEFAULTS>;

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_ENDING_SOON_DAYS = 3;
const DORMANT_DAYS = 14;
const KB_THIN_CHARS = 500;
const KB_THIN_CHUNKS = 5;
const USAGE_NEAR_CAP_RATIO = 0.8;

/** Order-insensitive equality for the string arrays we store (e.g. supportedLanguages). */
function arraysEqualUnordered(a: unknown, b: unknown): boolean {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    const sa = [...a].map(String).sort();
    const sb = [...b].map(String).sort();
    return sa.every((v, i) => v === sb[i]);
}

/** True when a jsonb "multi" map (e.g. brandVoiceNotesMulti) has no entries. */
function isEmptyRecord(v: unknown): boolean {
    return v === null || v === undefined
        || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);
}

function valueEqualsDefault(value: unknown, def: unknown): boolean {
    // A null/undefined column value means the schema default is in effect — equal,
    // regardless of the default's type (must be checked before the array/object
    // branches, or a null array column reads as "changed").
    if (value === null || value === undefined) return true;
    if (Array.isArray(def)) return arraysEqualUnordered(value, def);
    if (typeof def === 'object') {
        // jsonb map defaults are always `{}` — non-default iff the row has entries.
        return isEmptyRecord(value);
    }
    return value === def;
}

/**
 * Keys of the settings row that deviate from their schema default. Used to draw
 * the "changed from default" markers; a null settings row → [] (everything
 * default, surfaced separately as the `settings_untouched` info flag).
 */
export function computeNonDefaultKeys(settings: Partial<SupportSettings> | null): string[] {
    if (!settings) return [];
    const changed: string[] = [];
    for (const key of SUPPORT_SETTINGS_KEYS) {
        const def = (SETTINGS_DEFAULTS as Record<string, unknown>)[key];
        if (!valueEqualsDefault((settings as Record<string, unknown>)[key], def)) {
            changed.push(key);
        }
    }
    return changed;
}

/** Template markers left in a persona, e.g. "[Your Assistant's Name]". */
const PLACEHOLDER_MARKER = /\[[^\]]{2,}\]/;

/**
 * A persona counts as "not really set" when every variant (the base notes and
 * each language in brandVoiceNotesMulti) is either empty or still carries an
 * unfilled `[...]` template marker.
 */
export function isPlaceholderPersona(
    notes: string | null | undefined,
    notesMulti: Record<string, string> | null | undefined,
): boolean {
    const variants: string[] = [];
    if (notes) variants.push(notes);
    if (notesMulti) variants.push(...Object.values(notesMulti));
    const nonEmpty = variants.map(v => v.trim()).filter(Boolean);
    if (nonEmpty.length === 0) return true;
    return nonEmpty.every(v => PLACEHOLDER_MARKER.test(v));
}

const SEVERITY_ORDER: Record<FlagSeverity, number> = { red: 0, yellow: 1, info: 2 };

/**
 * Compute the ordered health-flag list (red → yellow → info) for a merchant.
 * Pure: no DB, no clock — `now` is passed in.
 */
export function computeHealthFlags(input: HealthInput): HealthFlag[] {
    const { now, lastSeenAt, settings, subscription, pages, usage, isTeamMemberOnly } = input;
    const flags: HealthFlag[] = [];
    const add = (severity: FlagSeverity, key: string, extra?: Partial<HealthFlag>) =>
        flags.push({ key, severity, ...extra });

    // ---- Account-level, replies-broken (RED) ----
    if (pages.length === 0 && !isTeamMemberOnly) {
        add('red', 'no_pages');
    }
    if (settings?.aiEnabled === false) {
        add('red', 'ai_disabled');
    }
    if (settings?.commentsAutoReply === false) {
        add('red', 'channel_silent', { meta: { channel: 'comments' } });
    }
    if (settings?.messagesAutoReply === false) {
        add('red', 'channel_silent', { meta: { channel: 'messages' } });
    }

    // Subscription / trial state.
    if (subscription) {
        const status = subscription.status;
        const trialEndsAt = subscription.trialEndsAt;
        if (status === 'trialing' && trialEndsAt) {
            const msLeft = trialEndsAt.getTime() - now.getTime();
            if (msLeft < 0) {
                add('red', 'trial_expired');
            } else {
                const daysLeft = Math.ceil(msLeft / DAY_MS);
                if (daysLeft <= TRIAL_ENDING_SOON_DAYS) {
                    add('yellow', 'trial_ending_soon', { meta: { daysLeft } });
                }
            }
        } else if (status === 'past_due' || status === 'canceled') {
            add('red', 'subscription_inactive', { meta: { status } });
        }
    }

    // Usage vs plan cap.
    const limit = usage.limit;
    if (limit !== null && limit > 0) {
        const used = usage.aiRepliesCount;
        const percent = Math.round((used / limit) * 100);
        if (used >= limit) {
            add('red', 'usage_over_cap', { meta: { used, limit } });
        } else if (used >= USAGE_NEAR_CAP_RATIO * limit) {
            add('yellow', 'usage_near_cap', { meta: { used, limit, percent } });
        }
        if (used >= USAGE_NEAR_CAP_RATIO * limit && settings?.limitFallbackEnabled === false) {
            add('yellow', 'limit_fallback_off');
        }
    }

    // ---- Per-page (RED then YELLOW) ----
    let anyThinOrEmptyKb = false;
    for (const p of pages) {
        const scope = { pageId: p.id, pageName: p.name };
        if (p.disconnected) {
            add('red', 'page_disconnected', scope);
        }
        if (p.autoReplyEnabled === false) {
            const reason = p.autoReplyDisabledReason;
            if (reason === 'user') {
                add('yellow', 'auto_reply_user_off', scope);
            } else if (reason) {
                add('red', 'auto_reply_system_off', { ...scope, meta: { reason } });
            }
        }

        const { kbLength, chunksTotal, chunksByType, unresolvedGaps } = p.kb;
        if (kbLength === 0 || chunksTotal === 0) {
            add('red', 'kb_empty', scope);
            anyThinOrEmptyKb = true;
        } else {
            if (!chunksByType.offering) {
                add('red', 'no_offering_chunks', scope);
            }
            if (kbLength < KB_THIN_CHARS || chunksTotal < KB_THIN_CHUNKS) {
                add('yellow', 'kb_thin', scope);
                anyThinOrEmptyKb = true;
            }
        }
        if (unresolvedGaps > 0) {
            add('yellow', 'unresolved_kb_gaps', { ...scope, meta: { count: unresolvedGaps } });
        }
    }

    // ---- Settings-level warnings (YELLOW) ----
    if (settings) {
        if (isPlaceholderPersona(settings.brandVoiceNotes, settings.brandVoiceNotesMulti)) {
            add('yellow', 'persona_placeholder');
        }
        if (settings.holdLowConfidence === true) {
            // Escalates when the KB is also thin/empty — the classic "bot that only
            // says hello then holds everything" failure mode.
            add('yellow', 'hold_low_confidence', anyThinOrEmptyKb ? { meta: { withWeakKb: 1 } } : undefined);
        }
        if (settings.businessHoursOnly === true) {
            add('yellow', 'business_hours_only', {
                meta: {
                    start: settings.businessHoursStart ?? '',
                    end: settings.businessHoursEnd ?? '',
                    timezone: settings.timezone ?? '',
                },
            });
            if (settings.timezone === PLACEHOLDER_TIMEZONE) {
                add('yellow', 'timezone_default');
            }
            if (isEmptyRecord(settings.awayMessageMulti)) {
                add('yellow', 'no_away_message');
            }
        }
        if (settings.greetingMessageEnabled === false && !isEmptyRecord(settings.greetingMessageMulti)) {
            add('yellow', 'greeting_written_not_enabled');
        }
    }

    // Dormancy — can't be working any hold / needs-attention queue.
    if (!lastSeenAt) {
        add('yellow', 'merchant_dormant', { meta: { days: -1 } });
    } else {
        const days = Math.floor((now.getTime() - lastSeenAt.getTime()) / DAY_MS);
        if (days > DORMANT_DAYS) {
            add('yellow', 'merchant_dormant', { meta: { days } });
        }
    }

    // ---- INFO ----
    if (isTeamMemberOnly) {
        add('info', 'team_member');
    }
    if (!settings) {
        add('info', 'settings_untouched');
    } else if (settings.onboardingCompletedAt === null || settings.onboardingCompletedAt === undefined) {
        add('info', 'onboarding_incomplete');
    }

    // Stable sort by severity; preserves insertion order within a severity.
    return flags
        .map((f, i) => ({ f, i }))
        .sort((a, b) => SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity] || a.i - b.i)
        .map(({ f }) => f);
}
