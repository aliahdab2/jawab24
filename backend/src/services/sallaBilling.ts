import { db } from '../db';
import { subscriptions, ecommerceStores } from '../db/schema';
import { and, eq, desc, inArray, notInArray } from 'drizzle-orm';
import { subscriptionsService } from './subscriptions';
import { plansService } from './plans';
import { sallaApiGet, resolveStoreCredentials } from './salla';
import { EcommerceApiHttpError } from '../utils/httpRetry';
import { mapSallaPlanToSlug, parseSallaPrice } from '../config/sallaBilling';
import { LIVE_SUBSCRIPTION_STATUSES } from '../config/shopifyBilling';
import { collidesWithLiveRail } from '../config/billingRails';
import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';
import { noopLinkLogger, type LinkLogger } from '../types/linkLogger';
import { isDemoStore } from './demoStore';
import { resolveBillingSubjectUserId } from './ecommerce';
import { updateLiveMirrorsForStore } from './marketplaceMirror';
import { pick, asString, parseDate } from '../utils/provisionalEnvelope';

/**
 * Salla App Store subscriptions → local subscription mirror (Article 5 / D-103).
 *
 * Salla owns the money: a merchant who installs from the App Store picks one of
 * our plans inside Salla and pays there. Like Zid (D-070), Salla exposes a
 * subscription-read endpoint — `GET /admin/v2/apps/{app_id}/subscriptions`
 * (docs.salla.dev 5401098e0) — so this rail is **verify-first**: the API is the
 * authority and the `app.subscription.*` / `app.trial.*` webhooks are only
 * TRIGGERS that ask this module to go and look. A delivery that never arrives
 * is healed by the 6h reconciler instead of being lost.
 *
 * Deliberately shaped like `zidBilling.ts` — same choke point, same adopt
 * semantics, same refusal rulings, same orphan sweep — because the rails answer
 * the same questions and any divergence between them is a bug waiting to be
 * found by a merchant. Cross-rail vocabulary (`LIVE_SUBSCRIPTION_STATUSES`,
 * the billing subject) is imported, never re-declared.
 *
 * ⚠️ **Where Salla differs from Zid, and both differences are load-bearing:**
 *
 * 1. **The read carries NO `status` field.** Zid answers `subscription_status`;
 *    Salla's payload is `{plan_name, plan_type, start_date, end_date, price, …}`
 *    with no state enum at all. Entitlement is therefore DERIVED: an `end_date`
 *    in the future is entitled, one in the past is not, and a missing or
 *    unparseable one is `unknown` — which fails loud and writes nothing,
 *    because guessing either way is how you strand or over-grant a paying
 *    merchant (the same conservative posture as Zid's `unknown_status`).
 *
 * 2. **Base plans carry no plan id and a nullable `plan_name`.** Mapping is
 *    name-first with the D-103 ex-VAT price (146/296, distinct by construction)
 *    as the fallback identity — see `config/sallaBilling.ts`.
 *
 * ⚠️ **Nothing here has been round-tripped against a live PAID subscription** —
 * the app is unpublished, so paid checkout does not exist yet. The envelope is
 * inferred from docs.salla.dev, read tolerantly, and marked [provisional];
 * every UNKNOWN fails loud instead of guessing. Same posture the Zid rail took
 * before its first live envelope.
 */

/** The subset of Salla's app-subscription payload we consume [provisional]. */
export interface SallaAppSubscription {
    /** Salla's subscription identifier when the payload carries one. ⚠️ Salla's
     *  docs note `subscription_id` changes on each renewal cycle — informative,
     *  never an identity key. */
    id: string | null;
    planName: string | null;
    /** `free` | `once` | `recurring` | `on_demand` [provisional]. */
    planType: string | null;
    planPeriod: string | null;
    /** Ex-VAT price as delivered ("20.00" | 20 | null). */
    price: unknown;
    startDate: string | null;
    endDate: string | null;
}

export type SallaStateVerdict =
    | { kind: 'entitled'; localStatus: 'active' | 'trialing' }
    | { kind: 'inactive' }
    /** A known plan shape that grants nothing (`plan_type: 'free'`). */
    | { kind: 'non_entitling' }
    | { kind: 'unknown'; reason: string };

/**
 * Derive the entitlement state of a Salla subscription entry.
 *
 * There is no status enum to map (difference 1 above), so the clock decides:
 * `end_date >= now` is entitled, `end_date < now` is not, anything else is
 * `unknown` — write nothing, raise an alert. An unknown must NOT be lumped in
 * with "inactive": pausing a merchant Salla is actively billing because the
 * envelope shaped a date differently is a self-inflicted outage.
 *
 * `trialing` vs `active` [provisional]: the docs' trial read example carries
 * null pricing fields, so a null price on an entitled recurring entry is read
 * as the trial window. Both statuses entitle identically
 * (LIVE_SUBSCRIPTION_STATUSES) — a wrong guess here mislabels, never revokes.
 */
export function mapSallaSubscriptionState(
    sub: SallaAppSubscription,
    now: Date = new Date(),
): SallaStateVerdict {
    if ((sub.planType ?? '').trim().toLowerCase() === 'free') {
        return { kind: 'non_entitling' };
    }
    const end = parseDate(sub.endDate);
    if (!end) {
        return { kind: 'unknown', reason: `unparseable end_date: ${JSON.stringify(sub.endDate)}` };
    }
    if (end.getTime() < now.getTime()) return { kind: 'inactive' };
    const looksLikeTrial = parseSallaPrice(sub.price) === null;
    return { kind: 'entitled', localStatus: looksLikeTrial ? 'trialing' : 'active' };
}

/**
 * What a read of Salla's subscription endpoint told us. THREE-way for the same
 * reason Zid's is: a response we could not READ must never be mistaken for a
 * response that said "nobody is paying" — only `none` may pause; `unreadable`
 * writes nothing and alerts.
 */
export type SallaSubscriptionRead =
    | { kind: 'subscription'; subscription: SallaAppSubscription }
    /** Salla POSITIVELY reported no base-plan subscription. */
    | { kind: 'none' }
    /** A 200 we could not parse. Never treated as "no subscription". */
    | { kind: 'unreadable'; reason: string }
    /**
     * Salla's subscription endpoint answered 404. AMBIGUOUS by design: it means
     * EITHER no subscription resource exists for this store, OR the endpoint is
     * unavailable while the app is unpublished (Development) — and the two cannot
     * be distinguished until a paid subscription is observable post-publish
     * (SALLA_TEST_PLAN.md 3.11.1). So this is NOT `none`: reading it as "nobody is
     * paying" would pause a live mirror if the truth is "endpoint absent". Write
     * nothing, stay quiet (it is the expected state for every unsubscribed store),
     * and revisit the classification once publish makes the 404 meaning knowable.
     */
    | { kind: 'endpoint_unavailable'; status: number };

/**
 * Fields only a subscription entry carries — used to keep a defensive foothold
 * if `item_type` is ever absent [provisional].
 */
const SALLA_PLAN_MARKER_KEYS = ['plan_type', 'plan_name', 'plan_period', 'start_date', 'end_date'] as const;

/** Is this array entry our app's BASE PLAN (never an add-on)? [provisional] */
function isBasePlanEntry(entry: Record<string, unknown>): boolean {
    const itemType = asString(entry.item_type);
    if (itemType !== null) return itemType.trim().toLowerCase() === 'plan';
    // Docs mandate checking item_type ("an add-on event can get processed as a
    // base plan event") — an entry WITHOUT the field is only accepted when it
    // positively looks like a plan, so an unexpected shape degrades to `none`
    // + the orphan/pause guards rather than adopting an add-on as a plan.
    return SALLA_PLAN_MARKER_KEYS.some(key => key in entry);
}

function parseSubscriptionEntry(entry: Record<string, unknown>): SallaAppSubscription {
    return {
        id: asString(pick(entry, 'subscription_id', 'id')),
        planName: asString(pick(entry, 'plan_name')),
        planType: asString(pick(entry, 'plan_type')),
        planPeriod: asString(pick(entry, 'plan_period')),
        price: pick(entry, 'price', 'price_before_discount'),
        startDate: asString(pick(entry, 'start_date', 'started_at')),
        endDate: asString(pick(entry, 'end_date', 'ends_at', 'expiry_date')),
    };
}

/**
 * Ask Salla what this store's app subscription is.
 *
 * `GET /admin/v2/apps/{app_id}/subscriptions` with the merchant token —
 * documented response `{status, success, data: [entries]}` where entries mix
 * the base plan with add-ons (`item_type`). We take base-plan entries only and,
 * should several exist [provisional], the one whose `end_date` reaches
 * furthest — the row that decides entitlement NOW.
 *
 * What it does NOT do is guess: a shape that does not resolve comes back
 * `unreadable`, so the caller fails loud instead of pausing a paying merchant.
 */
export async function fetchSallaAppSubscription(
    accessToken: string,
): Promise<SallaSubscriptionRead> {
    let raw: Record<string, unknown>;
    try {
        raw = await sallaApiGet<Record<string, unknown>>(
            `https://api.salla.dev/admin/v2/apps/${encodeURIComponent(config.salla.appId)}/subscriptions`,
            accessToken,
        );
    } catch (err) {
        // A 404 is a KNOWN, quiet state (see the `endpoint_unavailable` doc), not a
        // failure — classify it so the caller writes nothing without logging an
        // error. Every OTHER status (401 dead token, 5xx, network) is a genuine
        // failure the caller's catch must still see, so rethrow it unchanged.
        if (err instanceof EcommerceApiHttpError && err.status === 404) {
            return { kind: 'endpoint_unavailable', status: err.status };
        }
        throw err;
    }

    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        // A bare array body is tolerated below; anything else is unreadable.
        if (!Array.isArray(raw)) {
            return { kind: 'unreadable', reason: `response body is a ${raw === null ? 'null' : typeof raw}` };
        }
    }

    // `{"data": null}` is a positive "nothing here"; a MISSING data key on an
    // object body is not a shape we know — unreadable, never "none".
    let entries: unknown;
    if (Array.isArray(raw)) {
        entries = raw;
    } else if ('data' in raw) {
        if (raw.data === null) return { kind: 'none' };
        entries = raw.data;
    } else {
        return {
            kind: 'unreadable',
            reason: `no data array in response (keys: ${Object.keys(raw).slice(0, 12).join(',') || 'none'})`,
        };
    }
    if (!Array.isArray(entries)) {
        return { kind: 'unreadable', reason: `data is a ${typeof entries}, not an array` };
    }

    const plans = entries
        .filter((entry): entry is Record<string, unknown> =>
            !!entry && typeof entry === 'object' && !Array.isArray(entry))
        .filter(isBasePlanEntry)
        .map(parseSubscriptionEntry);

    if (plans.length === 0) return { kind: 'none' };

    const latest = plans.reduce((best, candidate) => {
        const bestEnd = parseDate(best.endDate)?.getTime() ?? -Infinity;
        const candidateEnd = parseDate(candidate.endDate)?.getTime() ?? -Infinity;
        return candidateEnd > bestEnd ? candidate : best;
    });
    return { kind: 'subscription', subscription: latest };
}

export type SallaBillingSyncOutcome =
    | 'adopted'            // local row now mirrors the Salla subscription
    | 'refused'            // a paying stripe/manual/other-rail row is in the way — human decides
    | 'unknown_plan'       // plan resolves to no slug — fail loud, no activation
    | 'non_entitling_plan' // a known free plan shape — grants nothing, skipped silently
    | 'unknown_state'      // entitlement underivable (no usable end_date) — fail loud, no write
    | 'unreadable'         // a 200 we could not parse — fail loud, NEVER read as "no subscription"
    | 'endpoint_unavailable' // Salla answered 404 — write nothing, stay quiet (NEVER pause); see the read type
    | 'paused'             // Salla shows no live subscription; live local mirror paused
    | 'no_subscription'    // nothing on either side — nothing to do
    | 'no_store';          // no active salla store row / no usable credentials / rail dormant

export interface SallaBillingSyncResult {
    outcome: SallaBillingSyncOutcome;
    /** true when a row was actually written (drives the reconciler's healed count) */
    changed: boolean;
}

/**
 * Mirror one Salla app subscription onto the subject user's local row.
 *
 * Same take-over-the-latest-row semantics as the Shopify/Zid adopts: signup
 * created a trial row, and leaving it behind would let the resolver keep
 * serving it. Idempotent — a re-run against an already-mirrored row detects no
 * drift and writes nothing.
 */
export async function adoptSallaSubscription(
    userId: string,
    sallaSub: SallaAppSubscription,
    storeId: string,
    log: LinkLogger,
): Promise<SallaBillingSyncResult> {
    const failLoud = (
        outcome: 'unknown_plan' | 'unknown_state',
        error: string,
        summary: string,
        extra: Record<string, unknown>,
    ): SallaBillingSyncResult => {
        captureError(new Error(error), summary, {
            level: 'error',
            tags: { service: 'salla_billing', flow: outcome },
            extra: { storeId, userId, ...extra },
        });
        return { outcome, changed: false };
    };
    const refuse = (
        error: string,
        summary: string,
        extra: Record<string, unknown>,
        fingerprint?: string[],
    ): SallaBillingSyncResult => {
        captureError(new Error(error), summary, {
            level: 'warning',
            tags: { service: 'salla_billing', flow: 'adopt_refused' },
            fingerprint,
            extra: { storeId, userId, sallaSubscriptionId: sallaSub.id, ...extra },
        });
        return { outcome: 'refused', changed: false };
    };

    const verdict = mapSallaSubscriptionState(sallaSub);
    if (verdict.kind === 'unknown') {
        return failLoud(
            'unknown_state',
            `Salla subscription entitlement is underivable: ${verdict.reason}`,
            'Salla billing: underivable subscription state — refusing to write',
            { planName: sallaSub.planName, planType: sallaSub.planType, endDate: sallaSub.endDate },
        );
    }
    if (verdict.kind === 'non_entitling') {
        // A known free-plan shape is not an unrecognised identifier — skip it
        // without paging anyone. Still no activation: it grants nothing.
        log.info(
            { storeId, userId, planName: sallaSub.planName, planType: sallaSub.planType },
            'Salla billing: known non-entitling plan — no activation, no alert',
        );
        return { outcome: 'non_entitling_plan', changed: false };
    }
    if (verdict.kind === 'inactive') {
        // Not this function's job — syncSallaBilling pauses. Reaching here means
        // a caller skipped the choke point.
        return { outcome: 'no_subscription', changed: false };
    }

    const slug = mapSallaPlanToSlug({ name: sallaSub.planName, price: sallaSub.price });
    if (!slug) {
        return failLoud(
            'unknown_plan',
            `Salla plan (name=${sallaSub.planName ?? 'none'}, price=${asString(sallaSub.price) ?? 'none'}) maps to no local plan slug`,
            'Salla billing: unknown plan — refusing to activate',
            { planName: sallaSub.planName, price: asString(sallaSub.price), planPeriod: sallaSub.planPeriod },
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

    // Two active Salla stores resolving to one subject user must NOT ping-pong
    // the mirror between them: each flip would rewrite the plan and re-run
    // initializeUsagePeriod, silently resetting the quota window every sync.
    // Same posture as Shopify's cross-shop refusal — Sentry, human decides.
    if (
        currentIsLive
        && current.paymentMethod === 'salla'
        && current.sallaStoreId
        && current.sallaStoreId !== storeId
    ) {
        return refuse(
            `Salla subscription for store ${storeId} collides with a live mirror for store ${current.sallaStoreId}`,
            'Salla billing: refusing cross-store adoption over a live salla mirror',
            { localSubscriptionId: current.id, localSallaStoreId: current.sallaStoreId },
            ['salla-billing-cross-store-refused'],
        );
    }

    // Never silently take over a live paid relationship on another rail (the
    // D-H rule). A canceled/paused row is fair game — the merchant left and came
    // back through Salla; a live one is a double-billing risk a human must
    // untangle. 'paypal' is a documented legacy value for this column.
    if (
        currentIsLive
        && collidesWithLiveRail(current?.paymentMethod, 'salla')
    ) {
        return refuse(
            `Salla subscription for store ${storeId} collides with a live ${current.paymentMethod} subscription`,
            'Salla billing: refusing to adopt over a paying row on another rail',
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
            `Plan slug "${slug}" has no row in plans — Salla billing cannot activate`,
            'Salla billing: mapped slug missing from plans table',
            { slug },
        );
    }

    const now = new Date();
    const periodEnd = parseDate(sallaSub.endDate);
    const status = verdict.localStatus;
    // Salla reports the trial through the dates + null pricing, not a
    // trial-days count, so the trial clock is the subscription's own end date.
    const trialEndsAt = status === 'trialing' ? periodEnd : null;

    // Keep the local start where the mirror is already tracking this store
    // (idempotent re-run), advance it to the previous end on renewal (contiguous
    // periods), otherwise anchor at Salla's start date or now.
    const previousEnd = current?.currentPeriodEnd ? new Date(current.currentPeriodEnd) : null;
    const isSameMirror = current?.paymentMethod === 'salla' && current.sallaStoreId === storeId;
    let periodStart: Date;
    if (isSameMirror && previousEnd && periodEnd && periodEnd > previousEnd) {
        periodStart = previousEnd;
    } else if (isSameMirror && current?.currentPeriodStart) {
        periodStart = new Date(current.currentPeriodStart);
    } else {
        periodStart = parseDate(sallaSub.startDate) ?? now;
    }

    const noDrift =
        isSameMirror
        && current?.planId === plan.id
        && current?.status === status
        && (previousEnd?.getTime() ?? null) === (periodEnd?.getTime() ?? null)
        && current?.externalSubscriptionId === sallaSub.id;
    if (noDrift) {
        return { outcome: 'adopted', changed: false };
    }

    const values = {
        userId,
        planId: plan.id,
        status,
        externalSubscriptionId: sallaSub.id,
        paymentMethod: 'salla' as const,
        sallaStoreId: storeId,
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
    // pair can race to insert. The partial unique index on salla_store_id IS the
    // serialization mechanism — the loser throws, the caller's error isolation
    // absorbs it, and the next sync no-ops.
    if (current) {
        await db.update(subscriptions).set(values).where(eq(subscriptions.id, current.id));
    } else {
        await db.insert(subscriptions).values(values);
    }

    // Without this the merchant keeps the usage window their signup trial
    // created — wrong boundaries, trial-era accounting for someone Salla says is
    // paying. Idempotent on replay.
    if (periodEnd) {
        await subscriptionsService.initializeUsagePeriod(userId, periodStart, periodEnd);
    } else {
        log.warn(
            { sallaSubscriptionId: sallaSub.id, userId, storeId },
            'Adopted Salla subscription without an end date — quota window not initialized',
        );
    }

    await subscriptionsService.invalidateStatusCache(userId);
    log.info(
        {
            sallaSubscriptionId: sallaSub.id,
            userId,
            storeId,
            planSlug: slug,
            status,
            adopted: current ? 'updated' : 'inserted',
        },
        'Adopted Salla App Store subscription onto the local row',
    );
    return { outcome: 'adopted', changed: true };
}

/** This rail's identity on the mirror — see services/marketplaceMirror.ts. */
const SALLA_MIRROR_RAIL = {
    paymentMethod: 'salla',
    storeIdColumn: subscriptions.sallaStoreId,
} as const;

const updateLiveMirrors = (
    storeId: string,
    set: Partial<typeof subscriptions.$inferInsert>,
) => updateLiveMirrorsForStore(SALLA_MIRROR_RAIL, storeId, set);

/**
 * Cancel the local mirror for a store — the app was uninstalled from the App
 * Store. Keyed on `salla_store_id`, so it works even after `deactivateStore`
 * has already run. Returns true when a live row was actually canceled.
 */
export async function cancelSallaSubscriptionLocal(
    storeId: string,
    reason: string,
    log: LinkLogger,
): Promise<boolean> {
    const rows = await updateLiveMirrors(storeId, {
        status: 'canceled',
        canceledAt: new Date(),
        cancelReason: reason,
        updatedAt: new Date(),
    });
    if (rows.length > 0) {
        log.info({ storeId, reason, canceled: rows.length }, 'Canceled local Salla-billed subscription');
    }
    return rows.length > 0;
}

/**
 * THE choke point: verify a store's billing state against Salla and reconcile
 * the local row. Webhook payloads never reach this function — callers pass only
 * the store id, everything else is fetched server-side. That is what makes the
 * webhook a trigger rather than a source of truth.
 */
export async function syncSallaBilling(
    storeId: string,
    log: LinkLogger,
): Promise<SallaBillingSyncResult> {
    // No app id = the read URL cannot be built. Dormant, never a guess.
    if (!config.salla.appId) {
        return { outcome: 'no_store', changed: false };
    }

    const [store] = await db
        .select()
        .from(ecommerceStores)
        .where(and(
            eq(ecommerceStores.id, storeId),
            eq(ecommerceStores.platform, 'salla'),
            eq(ecommerceStores.isActive, true),
        ))
        .limit(1);

    if (!store) {
        return { outcome: 'no_store', changed: false };
    }

    const accessToken = await resolveStoreCredentials(storeId);
    if (!accessToken) {
        return { outcome: 'no_store', changed: false };
    }

    const read = await fetchSallaAppSubscription(accessToken);

    // A response we could not READ is not a response that said "nobody is
    // paying". Falling through to the pause below would revoke a merchant Salla
    // is actively billing because Salla shaped the envelope differently from
    // our guess. Fingerprinted because the FIRST unreadable shape is the whole
    // story: it is the capture that narrows the [provisional] parser.
    if (read.kind === 'unreadable') {
        captureError(
            new Error(`Salla subscription response could not be read: ${read.reason}`),
            'Salla billing: unreadable subscription response — refusing to write',
            {
                level: 'error',
                tags: { service: 'salla_billing', flow: 'unreadable' },
                fingerprint: ['salla-billing-unreadable-response'],
                extra: { storeId, reason: read.reason },
            },
        );
        return { outcome: 'unreadable', changed: false };
    }

    // A 404 from the subscriptions endpoint is the expected state for every
    // unsubscribed store (and for the whole app while it is unpublished), so it
    // must NOT reach the pause fallthrough below and must NOT be logged as an
    // error — that was the pre-fix behaviour (the fire-and-forget callers logged
    // the thrown 404 at error level on every install, and the reconciler counted
    // it as a sweep error). Write nothing, log at info, move on. Placed here — with
    // the `unreadable` guard, before the pause path — so it can never revoke a
    // paying merchant's entitlement.
    if (read.kind === 'endpoint_unavailable') {
        log.info(
            { storeId, status: read.status },
            'Salla subscriptions endpoint returned 404 — no subscription readable; writing nothing',
        );
        return { outcome: 'endpoint_unavailable', changed: false };
    }

    // Anything that is not a POSITIVELY-derived "no longer entitled" goes to
    // adopt — which owns the activation, the non-entitling skip, and the
    // fail-loud paths. Only a state we positively understand as inactive may
    // reach the pause below, so an underivable date can never revoke a paying
    // merchant's entitlement.
    if (
        read.kind === 'subscription'
        && mapSallaSubscriptionState(read.subscription).kind !== 'inactive'
    ) {
        const subjectUserId = await resolveBillingSubjectUserId(store);
        return adoptSallaSubscription(subjectUserId, read.subscription, storeId, log);
    }

    // Salla POSITIVELY says nobody is paying for this store — an explicit empty
    // container or an end_date in the past. Pause a live local mirror —
    // 'paused', not 'canceled': the app is still installed and re-subscribing
    // inside Salla reactivates through this same sync.
    const paused = await updateLiveMirrors(storeId, { status: 'paused', updatedAt: new Date() });
    if (paused.length > 0) {
        log.info({ storeId }, 'Salla shows no live subscription — paused local mirror');
        return { outcome: 'paused', changed: true };
    }
    return { outcome: 'no_subscription', changed: false };
}

export interface SallaBillingSweepResult {
    /** active salla stores examined */
    scanned: number;
    /** rows written to mirror a Salla-side change (adopt or pause) */
    healed: number;
    /** refusals + unknown plans/states + unreadable responses — states a human must resolve */
    flagged: number;
    /** live local 'salla' rows whose store row is gone/inactive */
    orphaned: number;
    /** per-store failures, isolated so one bad store can't stall the sweep */
    errors: number;
}

/**
 * The 6-hourly authority of last resort: sweep every active Salla store through
 * `syncSallaBilling`, then flag live local mirrors whose store disappeared
 * without the uninstall webhook cancelling them.
 *
 * Idempotent and safe beside the live triggers — a no-drift sync writes
 * nothing, so steady state is read-only. This sweep is what makes a missed
 * `app.subscription.*` delivery a delay rather than a lost subscription.
 */
export async function reconcileSallaBilling(options?: {
    log?: LinkLogger;
}): Promise<SallaBillingSweepResult> {
    const log = options?.log ?? noopLinkLogger;
    const result: SallaBillingSweepResult = {
        scanned: 0, healed: 0, flagged: 0, orphaned: 0, errors: 0,
    };

    const storeRows = await db
        .select({
            id: ecommerceStores.id,
            platformData: ecommerceStores.platformData,
        })
        .from(ecommerceStores)
        .where(and(
            eq(ecommerceStores.platform, 'salla'),
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
            const sync = await syncSallaBilling(store.id, log);
            if (sync.changed) result.healed++;
            // `endpoint_unavailable` (404) is deliberately NOT flagged: it is the
            // expected state for every unsubscribed store, so flagging it would
            // re-create the very noise this classification removed. Before the fix
            // the 404 threw and landed in the catch below as an `errors++`.
            if (
                sync.outcome === 'refused'
                || sync.outcome === 'unknown_plan'
                || sync.outcome === 'unknown_state'
                || sync.outcome === 'unreadable'
            ) {
                result.flagged++;
            }
        } catch (err) {
            result.errors++;
            log.warn(
                { storeId: store.id, err: err instanceof Error ? err.message : String(err) },
                'Salla billing reconciliation failed for one store',
            );
        }
    }

    // A live local mirror with no active store behind it means the uninstall
    // webhook was missed — the merchant may still be billed by Salla or may
    // have left entirely; either way Salla is unreachable without the store
    // token, so a human decides. Orphan detection keys on "does an active store
    // row exist", so demo rows stay in the id list — a demo subscription
    // mirrored to a demo store must not be flagged as orphaned.
    const activeStoreIds = storeRows.map(s => s.id);
    const orphans = await db
        .select({ id: subscriptions.id, sallaStoreId: subscriptions.sallaStoreId })
        .from(subscriptions)
        .where(and(
            eq(subscriptions.paymentMethod, 'salla'),
            inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]),
            ...(activeStoreIds.length > 0
                ? [notInArray(subscriptions.sallaStoreId, activeStoreIds)]
                : []),
        ));

    result.orphaned = orphans.length;
    if (orphans.length > 0) {
        captureError(
            new Error(`${orphans.length} live salla-billed subscription(s) have no active store row`),
            'Salla billing reconciliation found orphaned local mirrors',
            {
                level: 'warning',
                tags: { cron: 'salla_billing_reconcile' },
                fingerprint: ['salla-billing-orphaned-mirrors'],
                extra: { ...result, storeIds: orphans.map(o => o.sallaStoreId) },
            },
        );
    }

    // This sweep is the authority of last resort — if it fails across the board
    // (dead token class, code regression), a missed webhook becomes permanent.
    // Per-store warns don't reach Sentry, so a systemic failure must raise one
    // aggregated, fingerprinted event.
    if (result.errors > 0) {
        captureError(
            new Error(`Salla billing reconciliation failed for ${result.errors}/${result.scanned} store(s)`),
            'Salla billing reconciliation sweep errors',
            {
                level: 'warning',
                tags: { cron: 'salla_billing_reconcile' },
                fingerprint: ['salla-billing-sweep-errors'],
                extra: { ...result },
            },
        );
    }

    return result;
}
