import { eq, sql } from 'drizzle-orm';
import {
    ACTIVATION_FUNNEL_STEPS,
    KB_FILLED_MIN_CHARS,
    isBusinessInfoProvided,
    type ActivationEvent,
    type ActivationFunnel,
} from '@jawab24/shared';
import { db } from '../db';
import { activationEvents, pages } from '../db/schema';
import { captureError } from '../utils/sentryHelpers';
import { sendGa4EventForUser } from './ga4';
import { workspaceSettingsService } from './workspaceSettings';

/**
 * Activation funnel instrumentation — lightweight, internal product analytics.
 *
 * We track five milestones per user as they move from signup to their first
 * automated reply. Each milestone is recorded at most once per user (a unique
 * (user_id, event) index + onConflictDoNothing — see schema.ts), so:
 *   - 'first_autoreply_sent' is idempotent for free (fires only the first time),
 *   - the funnel query can count each user once per step without DISTINCT, and
 *   - re-emitting on a later login / re-sync is a harmless no-op.
 *
 * No external analytics service — this is a single Postgres table.
 */

// ActivationEvent, funnel response types, KB_FILLED_MIN_CHARS, and the
// isBusinessInfoProvided gate live in @jawab24/shared (single source of truth
// shared with the frontend) — imported above and re-exported here so existing
// backend importers keep working.
export { KB_FILLED_MIN_CHARS, isBusinessInfoProvided };

/**
 * Record an activation milestone for a user. Fire-and-forget: never blocks or
 * throws into the caller's path (mirrors the aiMetrics emit pattern). Idempotent
 * via the unique (user_id, event) index — the first emit wins, its metadata is
 * preserved, later emits are silent no-ops.
 *
 * NOTE (hot path): `first_autoreply_sent` is emitted from the reply pipeline on
 * EVERY successful send, so for an already-activated user this issues a full
 * INSERT … ON CONFLICT DO NOTHING that is then discarded — a per-reply write
 * proportional to reply volume, not to activating-user count. It is the cheapest
 * class of Postgres write (a 2-column unique-index probe) and runs off the
 * critical path, so it ships as-is. FOLLOW-UP if reply volume makes it matter:
 * gate the INSERT behind a small in-process LRU of already-activated userIds,
 * keeping the unique index as the correctness backstop.
 *
 * Returns the in-flight promise so tests can await it; production callers
 * intentionally do not await.
 */
export async function recordActivationEvent(
    userId: string,
    event: ActivationEvent,
    metadata: Record<string, unknown> = {},
): Promise<void> {
    // async + try/catch (not a bare .catch) so even a SYNCHRONOUS throw from the
    // query builder — e.g. a mocked `db` in unit tests — is contained and never
    // escapes into the caller's request path.
    try {
        // RETURNING is what makes the GA4 mirror below idempotent for free: with
        // ON CONFLICT DO NOTHING, Postgres returns a row ONLY when the insert
        // actually happened. A re-emit (the hot `first_autoreply_sent` path fires
        // on every send) conflicts, returns zero rows, and sends nothing — so GA4
        // sees each milestone exactly once per user without a second dedup layer.
        const inserted = await db
            .insert(activationEvents)
            .values({ userId, event, metadata })
            .onConflictDoNothing()
            .returning({ id: activationEvents.id });

        if (inserted.length > 0) void mirrorActivationEventToGa4(userId, event);
    } catch (err) {
        captureError(err, 'Failed to record activation event', {
            tags: { context: 'activation' },
            extra: { userId, event },
        });
    }
}

/**
 * GA4 event names for the activation milestones.
 *
 * Only `signup` is renamed: `sign_up` is a GA4 RECOMMENDED event, so using it
 * unlocks GA4's built-in reporting instead of landing as an unrecognised custom
 * event. The rest are legitimate custom names (snake_case, under 40 chars, not
 * in GA4's reserved list) and are sent verbatim so the Ads/GA4 UI shows the same
 * vocabulary the codebase and the funnel panel use.
 */
const GA4_EVENT_NAMES: Record<ActivationEvent, string> = {
    signup: 'sign_up',
    page_connected: 'page_connected',
    kb_filled: 'kb_filled',
    autoreply_enabled: 'autoreply_enabled',
    first_autoreply_sent: 'first_autoreply_sent',
    no_fb_pages: 'no_fb_pages',
    ig_direct_interest: 'ig_direct_interest',
};

/**
 * Mirror a just-recorded milestone to GA4 so Google Ads can import it as a
 * conversion. Called ONLY on a genuine first insert (see above), so GA4 receives
 * each milestone exactly once per user.
 *
 * `sendGa4EventForUser` owns the credential guard and the attribution-id lookup,
 * and contains its own failures — but this function is invoked with `void`, so a
 * rejection escaping it would surface as an UNHANDLED REJECTION rather than as a
 * caught error. Containment is therefore repeated here on purpose: the caller's
 * request path (a signup, a page connect, a reply send) must not be able to fail
 * because an analytics beacon did, and "the callee promises not to throw" is not
 * something a fire-and-forget call site may rely on.
 */
async function mirrorActivationEventToGa4(userId: string, event: ActivationEvent): Promise<void> {
    try {
        await sendGa4EventForUser(userId, GA4_EVENT_NAMES[event]);
    } catch (err) {
        captureError(err, 'Failed to mirror activation event to GA4', {
            level: 'warning',
            tags: { context: 'activation' },
            extra: { userId, event },
            fingerprint: ['ga4-activation-mirror'],
        });
    }
}

/**
 * Record 'autoreply_enabled' only when the reply pipeline can actually fire:
 * a workspace master (comments OR messages) is ON and at least one connected
 * page has a channel-level toggle enabled (D-026).
 *
 * Before D-026 the event fired on the page-level toggle alone, counting
 * merchants as "activated" while the workspace master (OFF by default for new
 * signups since D-025) still gated every reply — the funnel over-stated
 * activation for exactly the cohort it was built to measure.
 *
 * Raw master flags only — business hours are deliberately excluded: the funnel
 * measures "configured on", not "currently within opening hours".
 *
 * Callers emit from BOTH transitions (page toggle and settings save);
 * double-emits are harmless via recordActivationEvent's idempotency. Same
 * fire-and-forget discipline: never blocks or throws into the caller's path.
 */
export async function recordAutoreplyEnabledIfEffective(
    userId: string,
    workspaceId: string,
    metadata: Record<string, unknown> = {},
): Promise<void> {
    try {
        const workspaceSettings = await workspaceSettingsService.getSettings(workspaceId);
        if (!workspaceSettings.commentsAutoReply && !workspaceSettings.messagesAutoReply) return;

        // Minimal direct query — pagesService.getPages aggregates per-page stats
        // we don't need on this fire-and-forget path.
        const workspacePages = await db
            .select({
                autoReplyEnabled: pages.autoReplyEnabled,
                instagramAutoReplyEnabled: pages.instagramAutoReplyEnabled,
                whatsappAutoReplyEnabled: pages.whatsappAutoReplyEnabled,
                accessToken: pages.accessToken,
            })
            .from(pages)
            .where(eq(pages.workspaceId, workspaceId));

        // "Connected" mirrors serializePage (controllers/pages.ts): a page can
        // reply when its FB/IG credential is present (accessToken non-empty).
        // A WhatsApp channel toggle can only be ON once its number is set up,
        // so whatsappAutoReplyEnabled alone counts for WhatsApp-only pages.
        const anyChannelEnabled = workspacePages.some(p =>
            ((!!p.accessToken && p.accessToken !== '')
                && (p.autoReplyEnabled || p.instagramAutoReplyEnabled))
            || p.whatsappAutoReplyEnabled);
        if (!anyChannelEnabled) return;

        await recordActivationEvent(userId, 'autoreply_enabled', metadata);
    } catch (err) {
        captureError(err, 'Failed to record effective autoreply_enabled', {
            tags: { context: 'activation' },
            extra: { userId, workspaceId },
        });
    }
}

interface FunnelRow {
    signup: number;
    page_connected: number;
    kb_filled: number;
    autoreply_enabled: number;
    first_autoreply_sent: number;
    median_hours_to_first_reply: string | null;
}

/**
 * Compute the activation funnel for users who signed up within the last `days`.
 *
 * Cohort = users with a 'signup' event in the window. For each later milestone
 * we count how many of those users reached it (pivoted in one pass), and we take
 * the median hours from signup to first auto-reply over those who got there.
 *
 * Attribution is per-USER (the page owner — page.userId, which equals the syncing
 * user and the signup user for solo merchants, the dominant case). This matches the
 * brief ("where new users drop off"). KNOWN LIMITATION: in a multi-member workspace,
 * if one teammate connects/edits a page owned (page.userId) by another, the steps
 * attribute to different user_ids and a cohort user can show a later step without an
 * earlier one. The panel renders that case honestly (gain badge, clamped bar). If
 * the metric must answer "where MERCHANTS drop off", re-key all five emits on the
 * workspace owner instead.
 *
 * Note: counts are "reached this step", not strictly monotonic — a user can send
 * a template auto-reply without ever filling a KB, so a later step may exceed an
 * earlier one. The panel reports drop-off honestly against the previous step.
 */
export async function getActivationFunnel(days: number): Promise<ActivationFunnel> {
    const rows = await db.execute(sql`
        WITH cohort AS (
            SELECT user_id, MIN(created_at) AS signup_at
            FROM ${activationEvents}
            WHERE ${activationEvents.event} = 'signup'
              AND ${activationEvents.createdAt} >= now() - make_interval(days => ${days})
            GROUP BY user_id
        ),
        per_user AS (
            SELECT
                c.user_id,
                c.signup_at,
                MAX(CASE WHEN e.event = 'page_connected'       THEN 1 ELSE 0 END) AS connected,
                MAX(CASE WHEN e.event = 'kb_filled'            THEN 1 ELSE 0 END) AS kb,
                MAX(CASE WHEN e.event = 'autoreply_enabled'    THEN 1 ELSE 0 END) AS enabled,
                MAX(CASE WHEN e.event = 'first_autoreply_sent' THEN 1 ELSE 0 END) AS replied,
                MIN(CASE WHEN e.event = 'first_autoreply_sent' THEN e.created_at END) AS first_reply_at
            FROM cohort c
            LEFT JOIN ${activationEvents} e ON e.user_id = c.user_id
            GROUP BY c.user_id, c.signup_at
        )
        SELECT
            COUNT(*)::int                              AS signup,
            COALESCE(SUM(connected), 0)::int           AS page_connected,
            COALESCE(SUM(kb), 0)::int                  AS kb_filled,
            COALESCE(SUM(enabled), 0)::int             AS autoreply_enabled,
            COALESCE(SUM(replied), 0)::int             AS first_autoreply_sent,
            ROUND(
                (percentile_cont(0.5) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (first_reply_at - signup_at)) / 3600.0
                ) FILTER (WHERE first_reply_at IS NOT NULL))::numeric,
                2
            )                                          AS median_hours_to_first_reply
        FROM per_user
    `);

    const row = rows[0] as unknown as FunnelRow | undefined;
    // Keyed by the FUNNEL steps only — demand signals (no_fb_pages,
    // ig_direct_interest) share the ActivationEvent union but are not part of
    // the funnel query or this pivot.
    const counts: Record<(typeof ACTIVATION_FUNNEL_STEPS)[number], number> = {
        signup: Number(row?.signup ?? 0),
        page_connected: Number(row?.page_connected ?? 0),
        kb_filled: Number(row?.kb_filled ?? 0),
        autoreply_enabled: Number(row?.autoreply_enabled ?? 0),
        first_autoreply_sent: Number(row?.first_autoreply_sent ?? 0),
    };

    const median = row?.median_hours_to_first_reply;
    return {
        days,
        steps: ACTIVATION_FUNNEL_STEPS.map((key) => ({ key, count: counts[key] })),
        medianHoursToFirstReply:
            median === null || median === undefined ? null : Number(median),
    };
}
