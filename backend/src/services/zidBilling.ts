import { db } from '../db';
import { subscriptions, ecommerceStores } from '../db/schema';
import { and, eq, desc, inArray, notInArray } from 'drizzle-orm';
import { subscriptionsService } from './subscriptions';
import { plansService } from './plans';
import { resolveZidCredentials, zidApiGet, type ZidCredentials } from './zid';
import { isZidNonEntitlingPlan, mapZidPlanToSlug } from '../config/zidBilling';
import { LIVE_SUBSCRIPTION_STATUSES } from '../config/shopifyBilling';
import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';
import { noopLinkLogger, type LinkLogger } from '../types/linkLogger';
import { isDemoStore } from './demoStore';
import { resolveBillingSubjectUserId } from './ecommerce';
import { pick, asString, parseDate } from '../utils/provisionalEnvelope';

/**
 * Zid App Market subscriptions → local subscription mirror.
 *
 * Zid owns the money: a merchant who installs from the App Market picks one of
 * our plans inside Zid and pays there. Unlike Shopify, Zid DOES expose a
 * subscription-read endpoint — `GET /v1/market/app/subscription` — so this rail
 * is **verify-first**: the API is the authority and `app.market.subscription.*`
 * webhooks are only TRIGGERS that ask this module to go and look. That closes
 * ZID_TEST_PLAN §H-9 (webhook-must-not-be-SPOF) by construction rather than by
 * hoping every delivery lands.
 *
 * Deliberately shaped like `shopifyBilling.ts` (D-054) — same choke point, same
 * adopt semantics, same refusal rulings, same orphan sweep — because the two
 * rails answer the same questions and any divergence between them is a bug
 * waiting to be found by a merchant. The cross-rail vocabulary
 * (`LIVE_SUBSCRIPTION_STATUSES`, the billing subject) is imported, never
 * re-declared.
 *
 * ⚠️ **One place the Shopify shape does NOT port, and it is the pause branch.**
 * `fetchShopifyActiveSubscription` reads a contract-verified GraphQL schema, so
 * `activeSubscriptions: []` is an unambiguous "nobody is paying" and pausing on
 * it is safe. Zid's envelope is INFERRED, so "we got nothing back" and "we
 * could not read what came back" are different facts here — and only the first
 * may pause. `fetchZidAppSubscription` therefore returns a three-way
 * `ZidSubscriptionRead`, never a bare null.
 *
 * ⚠️ **Nothing here has been round-tripped against a live store.** `EC3` — a
 * Rejected app cannot be installed — blocks every live validation until app
 * 7367 is resubmitted, so the response envelope is inferred from Zid's docs.
 * Every field is read tolerantly and marked [provisional], and every UNKNOWN —
 * the plan (`mapZidPlanToSlug`), the status (`mapZidStatus`), and the envelope
 * itself (`unwrapZidEnvelope`) — fails loud instead of guessing. This is the
 * posture D-020/D-053 imposed after the first Zid implementation was written
 * against an assumed contract and had to be rebuilt.
 */

/** The subset of Zid's subscription payload we consume [provisional]. */
export interface ZidAppSubscription {
    /** Zid's own subscription identifier, when the payload carries one. */
    id: string | null;
    /** Raw `subscription_status` — mapped by `mapZidStatus`, never trusted verbatim. */
    status: string;
    planId: string | null;
    planName: string | null;
    startDate: string | null;
    endDate: string | null;
    isUsageBased: boolean;
}

/**
 * Zid statuses that mean "this merchant is entitled right now".
 *
 * Zid documents the FIELD but not its value set, so these are the plausible
 * spellings — and an unrecognized value is deliberately NOT lumped in with
 * "inactive". See `mapZidStatus`.
 */
const ZID_ACTIVE_STATUSES = new Set(['active', 'subscribed', 'live']);
/** Zid statuses that mean "entitled, and still inside the free trial". */
const ZID_TRIAL_STATUSES = new Set(['trial', 'trialing', 'in_trial', 'trial_active']);
/** Zid statuses that mean "no longer entitled". */
const ZID_INACTIVE_STATUSES = new Set([
    'expired', 'cancelled', 'canceled', 'suspended', 'inactive', 'ended', 'stopped',
]);

export type ZidStatusVerdict =
    | { kind: 'active'; localStatus: 'active' | 'trialing' }
    | { kind: 'inactive' }
    | { kind: 'unknown' };

/**
 * Map Zid's `subscription_status` onto our local status.
 *
 * The three-way return is the whole point. An unrecognized status must NOT be
 * treated as inactive: pausing a merchant Zid is actively billing, because Zid
 * shipped a status string we had not seen, is a self-inflicted outage for a
 * paying customer. Unknown therefore means "write nothing, raise an alert" —
 * the same fail-loud posture `mapZidPlanToSlug` takes for plans, and the
 * conservative direction of the two (a stale entitlement costs us a little
 * money; a wrongly-revoked one costs a customer).
 */
export function mapZidStatus(raw: string): ZidStatusVerdict {
    const normalized = raw.trim().toLowerCase();
    if (ZID_TRIAL_STATUSES.has(normalized)) return { kind: 'active', localStatus: 'trialing' };
    if (ZID_ACTIVE_STATUSES.has(normalized)) return { kind: 'active', localStatus: 'active' };
    if (ZID_INACTIVE_STATUSES.has(normalized)) return { kind: 'inactive' };
    return { kind: 'unknown' };
}

/**
 * What a read of Zid's subscription endpoint told us. THREE-way for the same
 * reason `mapZidStatus` is three-way, and it is the load-bearing half of that
 * ruling: a response we could not READ must never be mistaken for a response
 * that said "nobody is paying".
 *
 * The first implementation collapsed both onto `null`, so an envelope shaped
 * differently from our guess flowed into the pause branch and revoked a
 * merchant Zid was actively billing — the exact self-inflicted outage D-070
 * forbids for an unrecognised status, reached through the envelope door
 * instead. Only `none` may pause; `unreadable` writes nothing and alerts.
 */
export type ZidSubscriptionRead =
    | { kind: 'subscription'; subscription: ZidAppSubscription }
    /** Zid POSITIVELY reported no subscription (an explicit null container). */
    | { kind: 'none' }
    /** A 200 we could not parse. Never treated as "no subscription". */
    | { kind: 'unreadable'; reason: string };

/**
 * Keys Zid might nest the subscription under.
 *
 * Unwrapped by PRESENCE (`in`), never by `??`: an explicit `{"data": null}` is
 * a positive "there is no subscription here", and skipping it to fall back on
 * the root is precisely how a transport-level `"status": "success"` gets read
 * as a subscription status.
 */
const ZID_ENVELOPE_WRAPPER_KEYS = ['subscription', 'data'] as const;

/**
 * Fields only a SUBSCRIPTION resource carries. Used to tell a flat subscription
 * payload (`{id, status, plan_name, …}` — where a bare `status` IS the
 * subscription's) apart from a bare transport wrapper (`{status:"success",
 * message:"…"}` — where it is not). Without this test every unsubscribed store
 * would book `unknown_status: "success"` at error level every six hours.
 */
const ZID_SUBSCRIPTION_MARKER_KEYS = [
    'plan', 'plan_id', 'plan_name', 'subscription_id',
    'start_date', 'started_at', 'end_date', 'expiry_date', 'ends_at', 'is_usage_based',
] as const;

type ZidEnvelope =
    | { kind: 'body'; body: Record<string, unknown>; nested: boolean }
    | { kind: 'empty' }
    | { kind: 'unreadable'; reason: string };

/**
 * Peel Zid's wrappers off the subscription body [provisional].
 *
 * Up to TWO levels, because `{data:{subscription:{…}}}` is as plausible as
 * either wrapper alone and composing them is what the first pass missed — it
 * probed the three nestings as alternatives, so the composed shape resolved to
 * the outer wrapper, found no status, and read as "no subscription".
 */
function unwrapZidEnvelope(raw: unknown): ZidEnvelope {
    let current: unknown = raw;
    let nested = false;

    for (let depth = 0; depth <= ZID_ENVELOPE_WRAPPER_KEYS.length; depth++) {
        if (current === null) return { kind: 'empty' };
        if (typeof current !== 'object' || Array.isArray(current)) {
            return {
                kind: 'unreadable',
                reason: Array.isArray(current)
                    ? 'subscription container is an array'
                    : `subscription container is a ${typeof current}`,
            };
        }
        const obj = current as Record<string, unknown>;
        const wrapper = ZID_ENVELOPE_WRAPPER_KEYS.find(key => key in obj);
        if (!wrapper) return { kind: 'body', body: obj, nested };
        current = obj[wrapper];
        nested = true;
    }

    return { kind: 'unreadable', reason: 'subscription nested deeper than two wrappers' };
}

/**
 * Ask Zid what this store's App Market subscription is.
 *
 * Dual-header auth like every other Merchant API call, plus `app_id`.
 *
 * The envelope is unconfirmed, so the payload is probed across the plausible
 * nestings (root / `data` / `subscription`, and the two composed) and each
 * field across its plausible names — the identical tactic `fetchStoreInfo`
 * uses, for the identical reason. What it does NOT do is guess: a shape that
 * does not resolve comes back `unreadable`, so the caller fails loud instead of
 * pausing a paying merchant.
 */
export async function fetchZidAppSubscription(
    creds: ZidCredentials,
): Promise<ZidSubscriptionRead> {
    const raw = await zidApiGet<Record<string, unknown>>(
        `https://api.zid.sa/v1/market/app/subscription?app_id=${encodeURIComponent(config.zid.appId)}`,
        creds,
    );

    const envelope = unwrapZidEnvelope(raw);
    if (envelope.kind === 'empty') return { kind: 'none' };
    if (envelope.kind === 'unreadable') return envelope;
    const { body, nested } = envelope;

    // A bare `status` is the SUBSCRIPTION's only inside a wrapper we descended
    // into, or beside a field only a subscription carries. At a bare root it is
    // just as likely to be the transport's own `"success"`.
    const bareStatusIsTrustworthy =
        nested || ZID_SUBSCRIPTION_MARKER_KEYS.some(key => key in body);
    const status = asString(
        bareStatusIsTrustworthy
            ? pick(body, 'subscription_status', 'status')
            : pick(body, 'subscription_status'),
    );
    if (!status) {
        return {
            kind: 'unreadable',
            reason: `no subscription_status in ${nested ? 'nested' : 'root'} body (keys: ${Object.keys(body).slice(0, 12).join(',') || 'none'})`,
        };
    }

    // A bare `id`/`name` is only a PLAN's when it sits inside a nested plan
    // object. Falling back to the body for those keys would read the
    // SUBSCRIPTION's own id as the plan id — which cannot activate a wrong tier
    // (an unmapped id fails loud) but would discard a perfectly good
    // `plan_name` sitting beside it, turning a working install into a
    // support ticket. The flat spellings are read from the body; the bare
    // ones ONLY from the nested object.
    const nestedPlan = pick(body, 'plan') as Record<string, unknown> | undefined;
    const fromPlan = (...keys: string[]) =>
        nestedPlan && typeof nestedPlan === 'object' ? pick(nestedPlan, ...keys) : undefined;

    return {
        kind: 'subscription',
        subscription: {
            id: asString(pick(body, 'id', 'subscription_id')),
            status,
            planId: asString(pick(body, 'plan_id') ?? fromPlan('id', 'plan_id')),
            planName: asString(pick(body, 'plan_name') ?? fromPlan('name', 'plan_name')),
            startDate: asString(pick(body, 'start_date', 'started_at')),
            endDate: asString(pick(body, 'end_date', 'expiry_date', 'ends_at')),
            isUsageBased: pick(body, 'is_usage_based') === true,
        },
    };
}

export type ZidBillingSyncOutcome =
    | 'adopted'          // local row now mirrors the Zid subscription
    | 'refused'          // a paying stripe/manual row is in the way — human decides
    | 'unknown_plan'     // plan resolves to no slug — fail loud, no activation
    | 'non_entitling_plan' // a KNOWN free/test plan («اختبار») — grants nothing, skipped silently
    | 'unknown_status'   // status string we do not recognise — fail loud, no write
    | 'unreadable'       // a 200 we could not parse — fail loud, NEVER read as "no subscription"
    | 'paused'           // Zid shows no live subscription; live local mirror paused
    | 'no_subscription'  // nothing on either side — nothing to do
    | 'no_store';        // no active zid store row

export interface ZidBillingSyncResult {
    outcome: ZidBillingSyncOutcome;
    /** true when a row was actually written (drives the reconciler's healed count) */
    changed: boolean;
}

/**
 * Mirror one Zid App Market subscription onto the subject user's local row.
 *
 * Same take-over-the-latest-row semantics as `adoptShopifySubscription`: signup
 * created a trial row, and leaving it behind would let the resolver keep
 * serving it. Idempotent — a re-run against an already-mirrored row detects no
 * drift and writes nothing.
 */
export async function adoptZidSubscription(
    userId: string,
    zidSub: ZidAppSubscription,
    storeId: string,
    log: LinkLogger,
): Promise<ZidBillingSyncResult> {
    const failLoud = (
        outcome: 'unknown_plan' | 'unknown_status',
        error: string,
        summary: string,
        extra: Record<string, unknown>,
    ): ZidBillingSyncResult => {
        captureError(new Error(error), summary, {
            level: 'error',
            tags: { service: 'zid_billing', flow: outcome },
            extra: { storeId, userId, ...extra },
        });
        return { outcome, changed: false };
    };
    const refuse = (
        error: string,
        summary: string,
        extra: Record<string, unknown>,
        fingerprint?: string[],
    ): ZidBillingSyncResult => {
        captureError(new Error(error), summary, {
            level: 'warning',
            tags: { service: 'zid_billing', flow: 'adopt_refused' },
            fingerprint,
            extra: { storeId, userId, zidSubscriptionId: zidSub.id, ...extra },
        });
        return { outcome: 'refused', changed: false };
    };

    const verdict = mapZidStatus(zidSub.status);
    if (verdict.kind === 'unknown') {
        return failLoud(
            'unknown_status',
            `Zid subscription_status "${zidSub.status}" is not recognised`,
            'Zid billing: unrecognised subscription status — refusing to write',
            { subscriptionStatus: zidSub.status },
        );
    }
    if (verdict.kind === 'inactive') {
        // Not this function's job — syncZidBilling pauses. Reaching here means a
        // caller skipped the choke point.
        return { outcome: 'no_subscription', changed: false };
    }

    const slug = mapZidPlanToSlug({ id: zidSub.planId, name: zidSub.planName });
    if (!slug) {
        // A known no-entitlement plan is not an unrecognised identifier — skip it
        // without paging anyone. Still no activation: it grants nothing.
        if (isZidNonEntitlingPlan({ id: zidSub.planId, name: zidSub.planName })) {
            log.info(
                { storeId, userId, planId: zidSub.planId, planName: zidSub.planName },
                'Zid billing: known non-entitling plan — no activation, no alert',
            );
            return { outcome: 'non_entitling_plan', changed: false };
        }
        return failLoud(
            'unknown_plan',
            `Zid plan (id=${zidSub.planId ?? 'none'}, name=${zidSub.planName ?? 'none'}) maps to no local plan slug`,
            'Zid billing: unknown plan — refusing to activate',
            { planId: zidSub.planId, planName: zidSub.planName },
        );
    }

    const [current] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);
    const currentIsLive =
        !!current && (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(current.status ?? '');

    // Two active Zid stores resolving to one subject user must NOT ping-pong the
    // mirror between them: each flip would rewrite the plan and re-run
    // initializeUsagePeriod, silently resetting the quota window every sync.
    // Same posture as Shopify's cross-shop refusal — Sentry, human decides.
    if (
        currentIsLive
        && current.paymentMethod === 'zid'
        && current.zidStoreId
        && current.zidStoreId !== storeId
    ) {
        return refuse(
            `Zid subscription for store ${storeId} collides with a live mirror for store ${current.zidStoreId}`,
            'Zid billing: refusing cross-store adoption over a live zid mirror',
            { localSubscriptionId: current.id, localZidStoreId: current.zidStoreId },
            ['zid-billing-cross-store-refused'],
        );
    }

    // Never silently take over a live paid relationship on another rail (the
    // D-H rule). A canceled/paused row is fair game — the merchant left and came
    // back through Zid; a live one is a double-billing risk a human must
    // untangle. 'paypal' is a documented legacy value for this column.
    if (
        currentIsLive
        && ['stripe', 'manual', 'paypal', 'shopify'].includes(current.paymentMethod ?? '')
    ) {
        return refuse(
            `Zid subscription for store ${storeId} collides with a live ${current.paymentMethod} subscription`,
            'Zid billing: refusing to adopt over a paying stripe/manual/shopify row',
            {
                localSubscriptionId: current.id,
                localPaymentMethod: current.paymentMethod,
                localStatus: current.status,
            },
        );
    }

    // Plan row fetched AFTER the refusal gates — a refused adoption must not pay
    // for a plans read it never uses.
    const plan = await plansService.getPlanBySlug(slug);
    if (!plan) {
        return failLoud(
            'unknown_plan',
            `Plan slug "${slug}" has no row in plans — Zid billing cannot activate`,
            'Zid billing: mapped slug missing from plans table',
            { slug },
        );
    }

    const now = new Date();
    const periodEnd = parseDate(zidSub.endDate);
    const status = verdict.localStatus;
    // Zid reports the trial through the STATUS, not a trial-days count, so the
    // trial clock is the subscription's own end date. No local trial ledger.
    const trialEndsAt = status === 'trialing' ? periodEnd : null;

    // Keep the local start where the mirror is already tracking this store
    // (idempotent re-run), advance it to the previous end on renewal (contiguous
    // periods), otherwise anchor at Zid's start date or now.
    const previousEnd = current?.currentPeriodEnd ? new Date(current.currentPeriodEnd) : null;
    const isSameMirror = current?.paymentMethod === 'zid' && current.zidStoreId === storeId;
    let periodStart: Date;
    if (isSameMirror && previousEnd && periodEnd && periodEnd > previousEnd) {
        periodStart = previousEnd;
    } else if (isSameMirror && current?.currentPeriodStart) {
        periodStart = new Date(current.currentPeriodStart);
    } else {
        periodStart = parseDate(zidSub.startDate) ?? now;
    }

    const noDrift =
        isSameMirror
        && current?.planId === plan.id
        && current?.status === status
        && (previousEnd?.getTime() ?? null) === (periodEnd?.getTime() ?? null)
        && current?.externalSubscriptionId === zidSub.id;
    if (noDrift) {
        return { outcome: 'adopted', changed: false };
    }

    const values = {
        userId,
        planId: plan.id,
        status,
        externalSubscriptionId: zidSub.id,
        paymentMethod: 'zid' as const,
        zidStoreId: storeId,
        // Stale Stripe identity must not survive onto the mirror: a lingering
        // stripeCustomerId would read hasStripeCustomer=true, get reused by
        // top-up intents, and point the billing portal at a dead customer.
        stripeCustomerId: null,
        stripeCheckoutSessionId: null,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        trialEndsAt,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        cancelReason: null,
        updatedAt: now,
    };

    // Select-then-write without a transaction: a concurrent webhook + reconciler
    // pair can race to insert. The partial unique index on zid_store_id IS the
    // serialization mechanism — the loser throws, the caller's error isolation
    // absorbs it, and the next sync no-ops.
    if (current) {
        await db.update(subscriptions).set(values).where(eq(subscriptions.id, current.id));
    } else {
        await db.insert(subscriptions).values(values);
    }

    // Without this the merchant keeps the usage window their signup trial
    // created — wrong boundaries, trial-era accounting for someone Zid says is
    // paying. Idempotent on replay.
    if (periodEnd) {
        await subscriptionsService.initializeUsagePeriod(userId, periodStart, periodEnd);
    } else {
        log.warn(
            { zidSubscriptionId: zidSub.id, userId, storeId },
            'Adopted Zid subscription without an end date — quota window not initialized',
        );
    }

    await subscriptionsService.invalidateStatusCache(userId);
    log.info(
        {
            zidSubscriptionId: zidSub.id,
            userId,
            storeId,
            planSlug: slug,
            status,
            usageBased: zidSub.isUsageBased,
            adopted: current ? 'updated' : 'inserted',
        },
        'Adopted Zid App Market subscription onto the local row',
    );
    return { outcome: 'adopted', changed: true };
}

/**
 * Transition every LIVE mirror row for a store. The WHERE triple is THE
 * row-targeting invariant of this module — the same shape as the partial unique
 * index in migration 0161 — so cancel (uninstall) and pause (Zid shows no
 * subscription) share one copy of it instead of drifting apart.
 */
async function updateLiveMirrorsForStore(
    storeId: string,
    set: Partial<typeof subscriptions.$inferInsert>,
): Promise<Array<{ id: string; userId: string }>> {
    const rows = await db
        .update(subscriptions)
        .set(set)
        .where(and(
            eq(subscriptions.paymentMethod, 'zid'),
            eq(subscriptions.zidStoreId, storeId),
            inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]),
        ))
        .returning({ id: subscriptions.id, userId: subscriptions.userId });

    for (const row of rows) {
        await subscriptionsService.invalidateStatusCache(row.userId);
    }
    return rows;
}

/**
 * Cancel the local mirror for a store — the app was uninstalled from the App
 * Market. Keyed on `zid_store_id`, so it works even after `deactivateStore` has
 * already run. Returns true when a live row was actually canceled.
 */
export async function cancelZidSubscriptionLocal(
    storeId: string,
    reason: string,
    log: LinkLogger,
): Promise<boolean> {
    const rows = await updateLiveMirrorsForStore(storeId, {
        status: 'canceled',
        canceledAt: new Date(),
        cancelReason: reason,
        updatedAt: new Date(),
    });
    if (rows.length > 0) {
        log.info({ storeId, reason, canceled: rows.length }, 'Canceled local Zid-billed subscription');
    }
    return rows.length > 0;
}

/**
 * THE choke point: verify a store's billing state against Zid and reconcile the
 * local row. Webhook payloads never reach this function — callers pass only the
 * store id, everything else is fetched server-side. That is what makes the
 * webhook a trigger rather than a source of truth (§H-9).
 */
export async function syncZidBilling(
    storeId: string,
    log: LinkLogger,
): Promise<ZidBillingSyncResult> {
    const [store] = await db
        .select()
        .from(ecommerceStores)
        .where(and(
            eq(ecommerceStores.id, storeId),
            eq(ecommerceStores.platform, 'zid'),
            eq(ecommerceStores.isActive, true),
        ))
        .limit(1);

    if (!store) {
        return { outcome: 'no_store', changed: false };
    }

    const creds = await resolveZidCredentials(storeId);
    if (!creds) {
        return { outcome: 'no_store', changed: false };
    }

    const read = await fetchZidAppSubscription(creds);

    // A response we could not READ is not a response that said "nobody is
    // paying". Falling through to the pause below would revoke a merchant Zid
    // is actively billing because Zid shaped the envelope differently from our
    // guess — the same self-inflicted outage D-070 refuses for an unrecognised
    // status, and a far likelier one while the envelope stays uncaptured.
    // Fingerprinted because the FIRST unreadable shape is the whole story: it
    // is the capture `docs/integrations/zid.md` says to narrow the parser with.
    if (read.kind === 'unreadable') {
        captureError(
            new Error(`Zid subscription response could not be read: ${read.reason}`),
            'Zid billing: unreadable subscription response — refusing to write',
            {
                level: 'error',
                tags: { service: 'zid_billing', flow: 'unreadable' },
                fingerprint: ['zid-billing-unreadable-response'],
                extra: { storeId, reason: read.reason },
            },
        );
        return { outcome: 'unreadable', changed: false };
    }

    // Anything that is not a RECOGNISED "no longer entitled" goes to adopt —
    // which owns both the activation and the fail-loud path for a status we do
    // not recognise. Only a status we positively understand as inactive may
    // reach the pause below, so an unfamiliar status string can never revoke a
    // paying merchant's entitlement.
    if (read.kind === 'subscription' && mapZidStatus(read.subscription.status).kind !== 'inactive') {
        const subjectUserId = await resolveBillingSubjectUserId(store);
        return adoptZidSubscription(subjectUserId, read.subscription, storeId, log);
    }

    // Zid POSITIVELY says nobody is paying for this store — either an explicit
    // empty container or a status we recognise as inactive. Pause a live local
    // mirror — 'paused', not 'canceled': the app is still installed and
    // re-subscribing inside Zid reactivates through this same sync.
    const paused = await updateLiveMirrorsForStore(storeId, { status: 'paused', updatedAt: new Date() });
    if (paused.length > 0) {
        log.info({ storeId }, 'Zid shows no live subscription — paused local mirror');
        return { outcome: 'paused', changed: true };
    }
    return { outcome: 'no_subscription', changed: false };
}

export interface ZidBillingSweepResult {
    /** active zid stores examined */
    scanned: number;
    /** rows written to mirror a Zid-side change (adopt or pause) */
    healed: number;
    /** refusals + unknown plans/statuses + unreadable responses — states a human must resolve */
    flagged: number;
    /** live local 'zid' rows whose store row is gone/inactive */
    orphaned: number;
    /** per-store failures, isolated so one bad store can't stall the sweep */
    errors: number;
}

/**
 * The 6-hourly authority of last resort: sweep every active Zid store through
 * `syncZidBilling`, then flag live local mirrors whose store disappeared
 * without the uninstall webhook cancelling them.
 *
 * Idempotent and safe beside the live triggers — a no-drift sync writes nothing,
 * so steady state is read-only. This sweep is what makes a missed
 * `app.market.subscription.*` delivery a delay rather than a lost subscription.
 */
export async function reconcileZidBilling(options?: {
    log?: LinkLogger;
}): Promise<ZidBillingSweepResult> {
    const log = options?.log ?? noopLinkLogger;
    const result: ZidBillingSweepResult = {
        scanned: 0, healed: 0, flagged: 0, orphaned: 0, errors: 0,
    };

    const storeRows = await db
        .select({
            id: ecommerceStores.id,
            platformData: ecommerceStores.platformData,
        })
        .from(ecommerceStores)
        .where(and(
            eq(ecommerceStores.platform, 'zid'),
            eq(ecommerceStores.isActive, true),
        ));

    // Demo-seeded stores hold placeholder tokens that decrypt() rejects — every
    // real-API path must skip them (services/demoStore.ts; the filter is a JS
    // predicate because jsonb rows can be stored as string scalars, so a SQL
    // `platformData->>'demo'` condition silently matches nothing).
    const stores = storeRows.filter(store => !isDemoStore(store));

    for (const store of stores) {
        result.scanned++;
        try {
            const sync = await syncZidBilling(store.id, log);
            if (sync.changed) result.healed++;
            if (
                sync.outcome === 'refused'
                || sync.outcome === 'unknown_plan'
                || sync.outcome === 'unknown_status'
                || sync.outcome === 'unreadable'
            ) {
                result.flagged++;
            }
        } catch (err) {
            result.errors++;
            log.warn(
                { storeId: store.id, err: err instanceof Error ? err.message : String(err) },
                'Zid billing reconciliation failed for one store',
            );
        }
    }

    // A live local mirror with no active store behind it means the uninstall
    // webhook was missed — the merchant may still be billed by Zid or may have
    // left entirely; either way Zid is unreachable without the store token, so a
    // human decides. Orphan detection keys on "does an active store row exist",
    // so demo rows stay in the id list — a demo subscription mirrored to a demo
    // store must not be flagged as orphaned.
    const activeStoreIds = storeRows.map(s => s.id);
    const orphans = await db
        .select({ id: subscriptions.id, zidStoreId: subscriptions.zidStoreId })
        .from(subscriptions)
        .where(and(
            eq(subscriptions.paymentMethod, 'zid'),
            inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]),
            ...(activeStoreIds.length > 0
                ? [notInArray(subscriptions.zidStoreId, activeStoreIds)]
                : []),
        ));

    result.orphaned = orphans.length;
    if (orphans.length > 0) {
        captureError(
            new Error(`${orphans.length} live zid-billed subscription(s) have no active store row`),
            'Zid billing reconciliation found orphaned local mirrors',
            {
                level: 'warning',
                tags: { cron: 'zid_billing_reconcile' },
                fingerprint: ['zid-billing-orphaned-mirrors'],
                extra: { ...result, storeIds: orphans.map(o => o.zidStoreId) },
            },
        );
    }

    // This sweep is the authority of last resort — if it fails across the board
    // (dead token class, code regression), a missed webhook becomes permanent.
    // Per-store warns don't reach Sentry, so a systemic failure must raise one
    // aggregated, fingerprinted event.
    if (result.errors > 0) {
        captureError(
            new Error(`Zid billing reconciliation failed for ${result.errors}/${result.scanned} store(s)`),
            'Zid billing reconciliation sweep errors',
            {
                level: 'warning',
                tags: { cron: 'zid_billing_reconcile' },
                fingerprint: ['zid-billing-sweep-errors'],
                extra: { ...result },
            },
        );
    }

    return result;
}
