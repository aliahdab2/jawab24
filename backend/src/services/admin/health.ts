import {
    DEFAULT_AI_MODEL, PAST_DUE_GRACE_DAYS, PLACEHOLDER_TIMEZONE, resolveAiQuotaStatus,
    coerceMultiLang, hasPagePersonaPin,
} from '@jawab24/shared';
import { overlayWorkspaceFields } from '../pipelineFields';

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

/**
 * Per-page Business Info summary (counts/lengths only — never the raw text).
 *
 * Business Info is FOUR stores now, not one, and every one of them reaches the
 * prompt on its own: the free-text KB (`<business_knowledge>`), the structured
 * merchant profile (the authoritative BUSINESS_INFO block), catalog items
 * (`<product_catalog>`, which outranks the free text), and fact collections
 * (list facts + their derived completeness statement). `chunksTotal` is NOT a
 * fifth store — it is the RAG index over the free text, read only on the
 * retrieval path, and it goes to zero on its own whenever a structured write
 * moves `kbActiveVersion` past the newest ingested set. Deciding "empty" from it
 * put 49 of 92 live prod pages permanently RED (2026-08-20).
 */
export interface PageKbSummary {
    kbLength: number;
    kbActiveVersion: number | null;
    kbUpdatedAt: Date | null;
    chunksTotal: number;
    chunksByType: Record<string, number>;
    unresolvedGaps: number;
    /** Non-empty keys of `business_profile.merchant` (the BUSINESS_INFO block). */
    businessProfileFields: number;
    /** Merchant-authored `<product_catalog>` rows. */
    catalogItems: number;
    factCollections: number;
    factRows: number;
    /**
     * Newest ingested chunk version, ignoring the active pointer — null when the
     * page was never ingested. Together with `kbActiveVersion` it separates the
     * two zero-chunk causes, which need opposite actions: never ingested, versus
     * ingested and then outrun by a structured write.
     */
    newestChunkVersion: number | null;
    /** Chunks exist but at an older version than the active pointer. */
    chunksStale: boolean;
    /** This page's replies actually read chunks (store or catalog items). */
    onRetrievalPath: boolean;
    /**
     * True when ANY of the four stores holds content — shipped to the console so
     * the browser does not re-derive it. DERIVED, never authored: build it with
     * `hasBusinessInfoContent` below, which is also what the flag logic calls, so
     * the field and the flags cannot disagree.
     */
    hasAnyContent: boolean;
}

/**
 * "Does the AI have anything to answer from?" — the ONE definition, over all
 * four Business Info stores.
 *
 * `chunksTotal` is deliberately absent. It is the RAG index over the free text,
 * not a store, and it drops to zero whenever a structured write moves
 * `kbActiveVersion` past the newest ingested set — which is how the old
 * `kbLength === 0 || chunksTotal === 0` test put 49 of 92 live prod pages
 * permanently RED with their Business Info fully intact (2026-08-20).
 *
 * The flag logic calls this rather than reading `kb.hasAnyContent`, so a caller
 * that computes the field wrongly cannot make the flags lie — the flags derive
 * it themselves from the counts.
 */
export function hasBusinessInfoContent(kb: {
    kbLength: number;
    businessProfileFields: number;
    catalogItems: number;
    factRows: number;
}): boolean {
    return kb.kbLength > 0
        || kb.businessProfileFields > 0
        || kb.catalogItems > 0
        || kb.factRows > 0;
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
    /**
     * The page's own persona pin (`pages.brand_voice_notes_multi`, D-084). Raw
     * jsonb — normalized here, not trusted, per the double-encoding precedent in
     * MULTI_LANG_SUPPORT_FIELDS below.
     */
    brandVoiceNotesMulti?: unknown;
    kb: PageKbSummary;
}

export interface HealthInput {
    now: Date;
    lastSeenAt: Date | null;
    settings: SupportSettings | null;
    subscription: {
        status: string | null;
        trialEndsAt: Date | null;
        /**
         * Verdict of THE reply gate (`subscriptionsService.checkSubscriptionStatus`).
         *
         * REQUIRED, and deliberately not derivable here: `status` alone cannot say
         * whether replies are flowing. A manual (cash/transfer) subscription never
         * leaves 'active' — it expires by a snapped UTC-midnight boundary — so a
         * console reading `status` showed a green "active" badge and no red flag
         * while every reply was being refused (owner's own account, 2026-08-14).
         * The tool support diagnoses with must not be the tool that reassures them.
         */
        autoReplyAllowed: boolean;
        /**
         * `resolveEntitlementEnd`'s answer — the instant the CLOCK cuts this
         * subscription off, already rail-correct (snapped for manual, trialEndsAt
         * for a trial, +grace for past_due). null = no clock bounds this row.
         *
         * Taken from the resolver rather than recomputed here so the console cannot
         * date a different fuse than the gate burns: an earlier cut added
         * `currentPeriodEnd + N * DAY_MS` locally, while the gate walks calendar days
         * via `setDate(+N)` — the same number, two different instants across a DST
         * boundary.
         */
        entitlementEndsAt: Date | null;
    } | null;
    pages: HealthInputPage[];
    /**
     * Current-period plan usage plus the non-expiring top-up balance. The balance
     * is REQUIRED because the runtime gate (`canUseAiReplies`) falls through to
     * top-up when the plan cap is exhausted — without it the usage flags would
     * claim replies stop at the cap when they actually keep flowing.
     */
    usage: { aiRepliesCount: number; limit: number | null; topupBalance: number };
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
// ⚠️ 500 characters is NOT a "starved page" threshold on this fleet: measured
// 2026-08-20, the MEDIAN live page holds 148 characters of free text and 71 of
// 92 sit under 500. So this bound alone describes the typical page, and `kb_thin`
// must not rest on it alone — see the flag below, which additionally requires
// that NO structured store holds anything. (The old rule paired it with a chunk
// count via OR, and only looked sane because the false `kb_empty` short-circuit
// hid it from 49 of the 92 pages.)
const KB_THIN_CHARS = 500;
// A page with chunks but no `offering` is red (can't answer pricing) UNLESS the
// KB is a substantial FAQ/info knowledge base — a legitimate service business
// shouldn't sit permanently red. At/above this many FAQ chunks it downgrades to
// yellow ("worth a look") instead.
const NO_OFFERING_FAQ_DOWNGRADE = 3;

/**
 * Every flag key `computeHealthFlags` can emit — the canonical list the i18n
 * parity test asserts against (`customer.flag_<key>` must exist in both locales).
 * The banner also renders two derived keys not emitted here — `merchant_never_seen`
 * (dormant with days=-1) and `hold_low_confidence_weak_kb` (the withWeakKb meta) —
 * both covered in that test's render-variant list.
 */
export const HEALTH_FLAG_KEYS = [
    'no_pages', 'ai_disabled', 'all_channels_silent', 'channel_silent',
    'trial_expired', 'subscription_inactive', 'subscription_past_due_grace',
    'usage_over_cap', 'usage_near_cap',
    'usage_on_topup', 'usage_near_cap_on_topup', 'usage_topup_nearly_drained',
    'limit_fallback_off', 'page_disconnected', 'auto_reply_user_off',
    'auto_reply_system_off', 'auto_reply_off_unknown', 'kb_empty',
    'no_offering_chunks', 'kb_thin', 'kb_chunks_stale', 'unresolved_kb_gaps',
    'persona_placeholder', 'page_persona_override',
    'hold_low_confidence', 'business_hours_only', 'timezone_default',
    'no_away_message', 'greeting_written_not_enabled', 'trial_ending_soon',
    'merchant_dormant', 'team_member', 'settings_untouched', 'onboarding_incomplete',
] as const;

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

/**
 * Multilingual JSONB fields the console displays. Normalized after overlaying
 * (mirroring settingsService.normalizeMultiFields): the workspace store can
 * hold these double-encoded — a JSON *string* — via drift-heal/backfill, and a
 * string here would corrupt `isEmptyRecord` (Object.keys('…') is non-empty),
 * `isPlaceholderPersona` (Object.values over characters), and the console UI.
 */
const MULTI_LANG_SUPPORT_FIELDS = ['brandVoiceNotesMulti', 'greetingMessageMulti', 'awayMessageMulti'] as const;

/**
 * Overlay the workspace-store pipeline fields onto the legacy settings row —
 * the EFFECTIVE settings, as the reply pipeline sees them (D-026).
 *
 * The reply pipeline reads pipeline fields from the workspace JSONB
 * (`workspaceSettingsService.getSettings(page.workspaceId)`), never from the
 * legacy per-user row this console selects. The two stores drift by design:
 * `NEW_SIGNUP_SETTINGS_SEED` writes auto-reply OFF into the JSONB only, so a
 * new signup's legacy row shows the column defaults (everything ON) while the
 * pipeline is silent. Feeding the raw legacy row to the console hid exactly
 * the failure class support hunts here ("why isn't this merchant getting
 * replies?" — 30 drifted users on 2026-08-02, all showing healthy toggles).
 *
 * Pure and per-field fail-open: only fields the legacy row already carries are
 * replaced (nothing pipeline-internal leaks into the payload), and a field the
 * workspace store lacks keeps its legacy value. `aiModel` stays legacy — see
 * WORKSPACE_OVERLAY_FIELDS.
 */
export function overlayPipelineSettings(
    legacy: SupportSettings,
    workspace: Record<string, unknown>,
): SupportSettings {
    // onlyExistingKeys = the leak-guard: the console selects an explicit column
    // subset, so workspace-internal fields must never enter the payload.
    const effective = overlayWorkspaceFields(
        legacy as unknown as Record<string, unknown>,
        workspace,
        { onlyExistingKeys: true },
    );
    for (const field of MULTI_LANG_SUPPORT_FIELDS) {
        const value = effective[field];
        // Preserve null (row never touched) — coerce only actual values.
        if (value !== null && value !== undefined) effective[field] = coerceMultiLang(value);
    }
    return effective as unknown as SupportSettings;
}

/**
 * Pick the workspace whose settings govern this user's replies — the input to
 * `overlayPipelineSettings`.
 *
 * The reply pipeline resolves settings **per page**, from `page.workspaceId` —
 * never from the viewed user's memberships. So when the console displays pages,
 * the pages' own workspace is the truth; memberships only decide when the pages
 * can't (none connected, or team-member-only):
 *
 *  1. All displayed pages in one workspace → that workspace.
 *  2. Pages split across workspaces (page-transfer drift — the single settings
 *     card can't represent them all) → the workspace covering the most
 *     displayed pages; ties prefer a workspace this user owns, then the
 *     smallest id, so the pick is deterministic.
 *  3. No pages → the owned membership's workspace, else the first membership
 *     (memberships arrive ordered by workspace creation date).
 *
 * NOTE this is deliberately NOT settingsService.resolveWorkspaceId — that takes
 * an arbitrary un-ordered `limit(1)` membership and never looks at pages. Under
 * the one-workspace-per-user invariant the two agree; this one stays correct
 * for the drift states (transferred pages, multi-membership) support gets
 * called about.
 */
export function resolvePipelineWorkspaceId(
    pageWorkspaceIds: ReadonlyArray<string | null>,
    memberships: ReadonlyArray<{ workspaceId: string; ownerId: string }>,
    userId: string,
): string | undefined {
    const pageCounts = new Map<string, number>();
    for (const id of pageWorkspaceIds) {
        if (id) pageCounts.set(id, (pageCounts.get(id) ?? 0) + 1);
    }
    if (pageCounts.size > 0) {
        const owned = new Set(memberships.filter(m => m.ownerId === userId).map(m => m.workspaceId));
        return [...pageCounts.entries()].sort((a, b) =>
            b[1] - a[1]
            || Number(owned.has(b[0])) - Number(owned.has(a[0]))
            || a[0].localeCompare(b[0]),
        )[0][0];
    }
    return (memberships.find(m => m.ownerId === userId) ?? memberships[0])?.workspaceId;
}

/** Template markers left in a persona, e.g. "[Your Assistant's Name]". */
const PLACEHOLDER_MARKER = /\[[^\]]{2,}\]/;

// `hasPagePersonaPin` (imported above, from @jawab24/shared) is the ONE
// predicate for "this page pins its own persona" — the reply pipeline's
// resolveBrandVoiceNotes decides the pin with the same function, so the console
// can never claim a page is pinned when the pipeline disagrees.

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
    // Both channels off = merchant is fully silent (red). One channel off is a
    // legitimate deliberate config (e.g. DMs-only) — surface it, but yellow.
    const commentsOff = settings?.commentsAutoReply === false;
    const messagesOff = settings?.messagesAutoReply === false;
    if (commentsOff && messagesOff) {
        add('red', 'all_channels_silent');
    } else if (commentsOff) {
        add('yellow', 'channel_silent', { meta: { channel: 'comments' } });
    } else if (messagesOff) {
        add('yellow', 'channel_silent', { meta: { channel: 'messages' } });
    }

    // Subscription / trial state.
    if (subscription) {
        const status = subscription.status;
        const trialEndsAt = subscription.trialEndsAt;
        // THE REFUSAL IS CHECKED FIRST, unconditionally. It used to sit in an
        // `else if` behind `status === 'trialing'`, which recreated the very bypass
        // this console was fixed to remove: a trialing row with a FUTURE trialEndsAt
        // whose gate refuses for some other reason (a manual grant past its snapped
        // end) matched the trial arm, fell through `daysLeft > TRIAL_ENDING_SOON`,
        // and emitted nothing at all — a healthy chip over a frozen account.
        if (!subscription.autoReplyAllowed) {
            // `trial_expired` stays the more specific label when that is genuinely
            // the cause; otherwise the generic refusal carries the raw status as meta.
            const trialIsTheCause = status === 'trialing' && trialEndsAt && trialEndsAt.getTime() < now.getTime();
            if (trialIsTheCause) {
                add('red', 'trial_expired');
            } else {
                add('red', 'subscription_inactive', { meta: { status: status ?? 'unknown' } });
            }
        } else if (status === 'trialing' && trialEndsAt) {
            const daysLeft = Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS);
            if (daysLeft <= TRIAL_ENDING_SOON_DAYS) {
                add('yellow', 'trial_ending_soon', { meta: { daysLeft } });
            }
        } else if (status === 'past_due' && subscription.entitlementEndsAt) {
            // Gate ALLOWS — the retry grace is still running, so replies really are
            // flowing and red would be a lie. But the fuse must stay visible: the
            // old status-only rule flagged this red, and moving to the gate would
            // otherwise have DELETED support's only warning that a card failed.
            //
            // Requires entitlementEndsAt. A past_due row with no currentPeriodEnd is
            // never refused by the gate at all (the grace check is guarded on it), so
            // announcing "3 days left, then they stop" would hand support a deadline
            // that never arrives — the resolver returns null for exactly that row.
            const daysLeft = Math.max(
                0,
                Math.ceil((subscription.entitlementEndsAt.getTime() - now.getTime()) / DAY_MS),
            );
            add('yellow', 'subscription_past_due_grace', { meta: { daysLeft } });
        }
    }

    // Usage vs the merchant's real runway (plan cap + top-up balance), classified
    // by the shared `resolveAiQuotaStatus` policy so this console can't drift from
    // the runtime gate the way it did before (a merchant with 9,417 top-up replies
    // was told "replies will go silent at the cap").
    //
    // `nearWall` — not the plan cap — is what the "replies will stop" wording keys
    // off. With no top-up balance it reduces to the historical 80%-of-cap rule, so
    // nothing changes for merchants who never bought a top-up.
    const limit = usage.limit;
    const balance = usage.topupBalance;
    const quota = resolveAiQuotaStatus({ used: usage.aiRepliesCount, limit, topupBalance: balance });
    if (limit !== null && quota.state !== 'unmetered') {
        const used = usage.aiRepliesCount;
        // Floor, not round — 999/1000 must read "99%", never "100%" under the
        // near-cap (not over-cap) message.
        const percent = Math.floor((used / limit) * 100);
        switch (quota.state) {
            case 'exhausted':
                // Plan cap AND top-up both spent: replies really have stopped.
                add('red', 'usage_over_cap', { meta: { used, limit } });
                break;
            case 'on_topup':
                // Past the cap, running on top-up. Calm unless the balance itself
                // is nearly gone — that's an imminent outage, not context.
                add(
                    quota.nearWall ? 'yellow' : 'info',
                    quota.nearWall ? 'usage_topup_nearly_drained' : 'usage_on_topup',
                    { meta: { used, limit, balance } },
                );
                break;
            case 'near_cap_on_topup':
                // Approaching the cap with a balance behind it. Still yellow (the
                // overflow burns paid credit) but the message says replies continue.
                // If the balance is too thin to change the outcome (`nearWall`), fall
                // through to the plain near-cap warning instead — it IS the wall.
                add('yellow', quota.nearWall ? 'usage_near_cap' : 'usage_near_cap_on_topup', {
                    meta: { used, limit, percent, balance },
                });
                break;
            case 'near_cap':
                add('yellow', 'usage_near_cap', { meta: { used, limit, percent } });
                break;
        }
        // The limit fallback only runs on the `!limitCheck.allowed` branch of the
        // generator, i.e. at the real wall — never while top-up covers the overflow.
        if (quota.nearWall && settings?.limitFallbackEnabled === false) {
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
            } else {
                // Off with no recorded reason (legacy rows toggled off before the
                // reason column existed, or a path that cleared it without
                // re-enabling). Runtime treats a null reason as NOT system-disabled
                // (commentProcessor), i.e. effectively user-off — surface it so a
                // silent page never reads as healthy.
                add('yellow', 'auto_reply_off_unknown', scope);
            }
        }

        const {
            kbLength, chunksTotal, chunksByType, unresolvedGaps,
            businessProfileFields, catalogItems, factRows,
            chunksStale, onRetrievalPath,
        } = p.kb;
        // Derived here, not read off the payload — see hasBusinessInfoContent.
        const hasAnyContent = hasBusinessInfoContent(p.kb);

        // "The AI has nothing to answer from" — true only when ALL FOUR stores
        // are empty. It was `kbLength === 0 || chunksTotal === 0`, which is two
        // separate errors: the OR made a stale RAG index alone sufficient for a
        // RED (the 49-page class), and neither operand could see the structured
        // stores, so a page whose entire Business Info is a catalog price list
        // or a delivery-zone table read as empty no matter how complete it was.
        if (!hasAnyContent) {
            add('red', 'kb_empty', scope);
            anyThinOrEmptyKb = true;
        } else {
            // Offerings: `catalog_items` is the FIRST-CLASS home for priced
            // offerings now (its block outranks the free text in the prompt), so
            // having items settles the question — no chunk can contradict it.
            // Only when there are none do we fall back to asking the chunk index,
            // and that question is meaningless while the index is stale: a page
            // with 40 offering chunks at v51 and the pointer at v54 would be told
            // it cannot answer pricing.
            const chunkIndexUsable = chunksTotal > 0;
            if (catalogItems === 0 && chunkIndexUsable && !chunksByType.offering) {
                // Product merchant with no offerings can't answer pricing (red),
                // but a substantial FAQ/info KB is a legitimate service business —
                // downgrade to yellow so it isn't permanently red.
                const substantialFaq = (chunksByType.faq ?? 0) >= NO_OFFERING_FAQ_DOWNGRADE;
                add(substantialFaq ? 'yellow' : 'red', 'no_offering_chunks', scope);
            }
            // Thin: short free text AND nothing in ANY structured store.
            //
            // Both halves are load-bearing, and each was measured (2026-08-20,
            // 92 live pages). The chunk-count half of the old rule is dropped
            // rather than repaired — a stale index reports 0 chunks for a
            // 10k-character KB, and off the retrieval path the count describes
            // nothing a customer receives. The char bound cannot stand alone
            // either: it matches 71 of 92 pages, so pairing it with "some
            // structured entries" by an arbitrary cutoff just moved the noise
            // (a `< 5` cutoff still flagged 71). Requiring EMPTY structured
            // stores flags 36 — the same order as the 33 the old rule produced,
            // but for a reason that survives inspection: little prose and no
            // address, phones, hours, policies, catalog or fact list anywhere.
            const structuredEntries = businessProfileFields + catalogItems + factRows;
            if (kbLength < KB_THIN_CHARS && structuredEntries === 0) {
                add('yellow', 'kb_thin', scope);
                anyThinOrEmptyKb = true;
            }
        }
        // A stale index is only a real defect where replies read it. Elsewhere
        // it is invisible bookkeeping and must not colour the account — that
        // conflation is what this whole block was fixed for.
        if (chunksStale && onRetrievalPath) {
            add('yellow', 'kb_chunks_stale', scope);
        }
        if (unresolvedGaps > 0) {
            add('yellow', 'unresolved_kb_gaps', { ...scope, meta: { count: unresolvedGaps } });
        }
    }

    // ---- Settings-level warnings (YELLOW) ----
    if (settings) {
        // The persona flags below describe the WORKSPACE persona. Any page
        // carrying its own pin ignores it outright — resolveBrandVoiceNotes
        // returns inside the override with no workspace fallback — so a
        // workspace-scoped verdict must not be read as fleet-wide. Same trap
        // D-087 fixed for reply mode; named here so the console cannot repeat it.
        const personaPinnedPages = pages.filter(p => hasPagePersonaPin(p.brandVoiceNotesMulti));
        if (personaPinnedPages.length > 0) {
            add('info', 'page_persona_override', {
                meta: { count: personaPinnedPages.length, pages: personaPinnedPages.map(p => p.name ?? p.id).join('، ') },
            });
        }
        // Scoped to the pages that actually USE the workspace persona: a
        // placeholder nobody reads is not a live defect, and firing on it sends
        // support to fix text that reaches no customer. With no pages at all
        // there is nothing to scope by, so the flag keeps its original meaning
        // (the persona is still the account's, and `no_pages` already fired).
        const anyPageUsesWorkspacePersona = pages.length === 0 || personaPinnedPages.length < pages.length;
        if (anyPageUsesWorkspacePersona
            && isPlaceholderPersona(settings.brandVoiceNotes, settings.brandVoiceNotesMulti)) {
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
