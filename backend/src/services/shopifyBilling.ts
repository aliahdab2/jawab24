import { db } from '../db';
import { subscriptions, ecommerceStores, workspaces } from '../db/schema';
import { and, eq, desc, inArray, notInArray } from 'drizzle-orm';
import { subscriptionsService } from './subscriptions';
import { plansService } from './plans';
import { shopifyGraphQL } from './shopify';
import { decrypt } from './ecommerceCrypto';
import { mapShopifyPlanToSlug } from '../config/shopifyBilling';
import { captureError } from '../utils/sentryHelpers';
import type { LinkLogger } from './subscriptionLinking';

/**
 * Shopify App Pricing → local subscription mirror.
 *
 * Shopify owns the money: merchants who install from the App Store pick a plan
 * and pay inside Shopify (App Pricing), and Shopify delivers NO webhook for
 * enrollments created after 2026-04-28. Our side must therefore mirror, never
 * listen: the ONE idempotent choke point `syncShopifyBilling` asks the Admin
 * API what the shop's app subscription is and reconciles the local row to it.
 * Design rulings D-A…D-J recorded in DECISIONS.md; triggers are
 *   1. the billing return endpoint (GET /shopify/billing/return — untrusted
 *      redirect, params only *trigger* a verify, never carry state),
 *   2. the post-claim hook (pending install claimed at login),
 *   3. the 6-hourly reconciler (the authority of last resort).
 *
 * Mirrors subscriptionLinking.ts (the Stripe twin) deliberately — same adopt
 * semantics, same usage-period initialization, same orphan alerting.
 */

/** AppSubscription subset we consume. `id` is the GID
 * (gid://shopify/AppSubscription/…) stored as externalSubscriptionId (D-A). */
export interface ShopifyAppSubscription {
    id: string;
    name: string;
    status: string;
    test: boolean;
    trialDays: number | null;
    createdAt: string;
    currentPeriodEnd: string | null;
}

interface ActiveSubscriptionsQueryResult {
    data?: {
        currentAppInstallation?: {
            activeSubscriptions?: ShopifyAppSubscription[];
        };
    };
}

const ACTIVE_SUBSCRIPTIONS_QUERY = `
    query CurrentAppSubscriptions {
        currentAppInstallation {
            activeSubscriptions {
                id
                name
                status
                test
                trialDays
                createdAt
                currentPeriodEnd
            }
        }
    }
`;

/**
 * Ask the Admin API for the shop's active app subscription.
 *
 * V3 fork isolation (plan §Track 2): whether `currentAppInstallation.
 * activeSubscriptions` reflects App Pricing enrollments is unverified until the
 * dev-store dogfood. If it turns out not to, THIS function's internals swap to
 * the Partner API — every caller consumes the same return shape either way.
 *
 * Returns the first ACTIVE subscription (Shopify allows at most one per app
 * install in practice), or null when none exists.
 */
export async function fetchShopifyActiveSubscription(
    shopDomain: string,
    accessToken: string,
): Promise<ShopifyAppSubscription | null> {
    const result = await shopifyGraphQL<ActiveSubscriptionsQueryResult>(
        shopDomain,
        accessToken,
        ACTIVE_SUBSCRIPTIONS_QUERY,
    );
    const subs = result.data?.currentAppInstallation?.activeSubscriptions ?? [];
    return subs.find(s => s.status === 'ACTIVE') ?? null;
}

/** Local statuses that mean "this row is currently entitling somebody". */
const LIVE_STATUSES = ['active', 'trialing', 'past_due'] as const;

export type ShopifyBillingSyncOutcome =
    | 'adopted'          // local row now mirrors the Shopify subscription
    | 'refused'          // D-H: a paying stripe/manual row is in the way — human decides
    | 'unknown_plan'     // D-I: plan name resolves to no slug — fail loud, no activation
    | 'paused'           // Shopify shows no active subscription; live local mirror paused
    | 'no_subscription'  // nothing on either side — nothing to do
    | 'no_store';        // no active shopify store row for this domain

export interface ShopifyBillingSyncResult {
    outcome: ShopifyBillingSyncOutcome;
    /** true when a row was actually written (drives the reconciler's recovered count) */
    changed: boolean;
}

/**
 * Mirror one AppSubscription onto the subject user's local row.
 *
 * Same take-over-the-latest-row semantics as adoptStripeSubscription: signup
 * created a trial row and leaving it behind would let the resolver keep
 * serving it. Idempotent — a re-run against an already-mirrored row detects
 * no drift and writes nothing.
 */
export async function adoptShopifySubscription(
    userId: string,
    appSub: ShopifyAppSubscription,
    shopDomain: string,
    log: LinkLogger,
): Promise<ShopifyBillingSyncResult> {
    const slug = mapShopifyPlanToSlug(appSub.name);
    if (!slug) {
        captureError(
            new Error(`Shopify plan "${appSub.name}" maps to no local plan slug`),
            'Shopify billing: unknown plan — refusing to activate (D-I)',
            {
                level: 'error',
                tags: { service: 'shopify_billing', flow: 'plan_mapping' },
                extra: { shopDomain, appSubscriptionId: appSub.id, planName: appSub.name },
            },
        );
        return { outcome: 'unknown_plan', changed: false };
    }

    const plan = await plansService.getPlanBySlug(slug);
    if (!plan) {
        captureError(
            new Error(`Plan slug "${slug}" has no row in plans — Shopify billing cannot activate`),
            'Shopify billing: mapped slug missing from plans table (D-I)',
            {
                level: 'error',
                tags: { service: 'shopify_billing', flow: 'plan_mapping' },
                extra: { shopDomain, slug },
            },
        );
        return { outcome: 'unknown_plan', changed: false };
    }

    const [current] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);

    // Two active Shopify stores resolving to one subject user must NOT
    // ping-pong the mirror between them: each flip would rewrite GID/domain/
    // plan and re-run initializeUsagePeriod — silently resetting the quota
    // window every sync. Same D-H posture: Sentry, human decides which shop
    // bills this workspace. Same-domain new-GID adoption (plan upgrades)
    // stays allowed.
    if (
        current &&
        current.paymentMethod === 'shopify' &&
        current.shopifyShopDomain &&
        current.shopifyShopDomain !== shopDomain &&
        (LIVE_STATUSES as readonly string[]).includes(current.status ?? '')
    ) {
        captureError(
            new Error(`Shopify subscription for ${shopDomain} collides with a live mirror for ${current.shopifyShopDomain}`),
            'Shopify billing: refusing cross-shop adoption over a live shopify mirror (D-H)',
            {
                level: 'warning',
                tags: { service: 'shopify_billing', flow: 'adopt_refused' },
                fingerprint: ['shopify-billing-cross-shop-refused'],
                extra: {
                    shopDomain,
                    userId,
                    appSubscriptionId: appSub.id,
                    localSubscriptionId: current.id,
                    localShopDomain: current.shopifyShopDomain,
                },
            },
        );
        return { outcome: 'refused', changed: false };
    }

    // D-H: never silently take over a live paid relationship on another rail.
    // A canceled/paused stripe row is fair game (the merchant left and came
    // back through Shopify); a live one is a double-billing risk a human must
    // untangle — Sentry and stand down. 'paypal' is a documented legacy value
    // for this column — treated like stripe/manual rather than silently eaten.
    if (
        current &&
        (current.paymentMethod === 'stripe' || current.paymentMethod === 'manual' || current.paymentMethod === 'paypal') &&
        (LIVE_STATUSES as readonly string[]).includes(current.status ?? '')
    ) {
        captureError(
            new Error(`Shopify subscription for ${shopDomain} collides with a live ${current.paymentMethod} subscription`),
            'Shopify billing: refusing to adopt over a paying stripe/manual row (D-H)',
            {
                level: 'warning',
                tags: { service: 'shopify_billing', flow: 'adopt_refused' },
                extra: {
                    shopDomain,
                    userId,
                    appSubscriptionId: appSub.id,
                    localSubscriptionId: current.id,
                    localPaymentMethod: current.paymentMethod,
                    localStatus: current.status,
                },
            },
        );
        return { outcome: 'refused', changed: false };
    }

    // D-J: trials mirror Shopify — the trial clock is createdAt + trialDays,
    // Shopify's own accounting. No local trial ledger involvement.
    const now = new Date();
    const trialEndsAt = appSub.trialDays && appSub.trialDays > 0
        ? new Date(new Date(appSub.createdAt).getTime() + appSub.trialDays * 24 * 60 * 60 * 1000)
        : null;
    const status = trialEndsAt && trialEndsAt > now ? 'trialing' : 'active';
    const periodEnd = appSub.currentPeriodEnd ? new Date(appSub.currentPeriodEnd) : null;

    // AppSubscription exposes only currentPeriodEnd. Keep the local start where
    // the mirror is already tracking this GID (idempotent re-run), advance it to
    // the previous end on renewal (contiguous periods), otherwise anchor at now.
    const previousEnd = current?.currentPeriodEnd ? new Date(current.currentPeriodEnd) : null;
    const isSameMirror = current?.paymentMethod === 'shopify' && current.externalSubscriptionId === appSub.id;
    let periodStart: Date;
    if (isSameMirror && previousEnd && periodEnd && periodEnd > previousEnd) {
        periodStart = previousEnd;
    } else if (isSameMirror && current?.currentPeriodStart) {
        periodStart = new Date(current.currentPeriodStart);
    } else {
        periodStart = now;
    }

    const noDrift =
        isSameMirror &&
        current?.planId === plan.id &&
        current?.status === status &&
        (previousEnd?.getTime() ?? null) === (periodEnd?.getTime() ?? null) &&
        current?.shopifyShopDomain === shopDomain;
    if (noDrift) {
        return { outcome: 'adopted', changed: false };
    }

    const values = {
        userId,
        planId: plan.id,
        status,
        externalSubscriptionId: appSub.id,
        paymentMethod: 'shopify' as const,
        shopifyShopDomain: shopDomain,
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

    // Select-then-write without a transaction: a concurrent billingReturn +
    // reconciler pair can race to insert. The partial unique index on
    // shopify_shop_domain IS the serialization mechanism — the loser throws,
    // the caller's error isolation absorbs it, and the next sync no-ops.
    if (current) {
        await db.update(subscriptions).set(values).where(eq(subscriptions.id, current.id));
    } else {
        await db.insert(subscriptions).values(values);
    }

    // Same reasoning as adoptStripeSubscription: without this the merchant keeps
    // the usage window their signup trial created — wrong boundaries, trial-era
    // accounting for someone Shopify says is paying. Idempotent on replay.
    if (periodEnd) {
        await subscriptionsService.initializeUsagePeriod(userId, periodStart, periodEnd);
    } else {
        log.warn(
            { appSubscriptionId: appSub.id, userId, shopDomain },
            'Adopted Shopify subscription without currentPeriodEnd — quota window not initialized'
        );
    }

    await subscriptionsService.invalidateStatusCache(userId);
    log.info(
        {
            appSubscriptionId: appSub.id,
            userId,
            planSlug: slug,
            status,
            shopDomain,
            test: appSub.test,
            adopted: current ? 'updated' : 'inserted',
        },
        'Adopted Shopify app subscription onto the local row'
    );
    return { outcome: 'adopted', changed: true };
}

/**
 * Cancel the local mirror for a shop — the app was uninstalled (D-D).
 * Keyed on shopify_shop_domain, so it works even after deactivateStore has
 * already run. Returns true when a live row was actually canceled.
 */
export async function cancelShopifySubscriptionLocal(
    shopDomain: string,
    reason: string,
    log: LinkLogger,
): Promise<boolean> {
    const rows = await db
        .update(subscriptions)
        .set({
            status: 'canceled',
            canceledAt: new Date(),
            cancelReason: reason,
            updatedAt: new Date(),
        })
        .where(and(
            eq(subscriptions.paymentMethod, 'shopify'),
            eq(subscriptions.shopifyShopDomain, shopDomain),
            inArray(subscriptions.status, [...LIVE_STATUSES]),
        ))
        .returning({ id: subscriptions.id, userId: subscriptions.userId });

    for (const row of rows) {
        await subscriptionsService.invalidateStatusCache(row.userId);
    }
    if (rows.length > 0) {
        log.info(
            { shopDomain, reason, canceled: rows.length },
            'Canceled local Shopify-billed subscription'
        );
    }
    return rows.length > 0;
}

/**
 * THE choke point (D-C): verify a shop's billing state against Shopify and
 * reconcile the local row. Redirect params never reach this function — callers
 * pass only the shop domain, everything else is fetched server-side.
 */
export async function syncShopifyBilling(
    shopDomain: string,
    log: LinkLogger,
): Promise<ShopifyBillingSyncResult> {
    const [store] = await db
        .select()
        .from(ecommerceStores)
        .where(and(
            eq(ecommerceStores.platform, 'shopify'),
            eq(ecommerceStores.storeDomain, shopDomain),
            eq(ecommerceStores.isActive, true),
        ))
        .limit(1);

    if (!store) {
        return { outcome: 'no_store', changed: false };
    }

    // D-E: the entitlement subject is the WORKSPACE OWNER (the
    // hasWhatsAppPlanAccess pattern) — plan limits are resolved against the
    // owner's subscription, so the mirror must land on the owner's row even
    // when a non-owner member connected the store.
    let subjectUserId = store.userId;
    if (store.workspaceId) {
        const [ws] = await db
            .select({ ownerId: workspaces.ownerId })
            .from(workspaces)
            .where(eq(workspaces.id, store.workspaceId))
            .limit(1);
        if (ws) subjectUserId = ws.ownerId;
    }

    const accessToken = decrypt(store.accessToken, store.accessTokenIv);
    const appSub = await fetchShopifyActiveSubscription(shopDomain, accessToken);

    if (appSub) {
        return adoptShopifySubscription(subjectUserId, appSub, shopDomain, log);
    }

    // Shopify says nobody is paying for this shop. Pause a live local mirror
    // (D-B: reconcile-driven expiry — cancellation inside Shopify has no
    // webhook either). 'paused', not 'canceled': the app is still installed
    // and re-picking a plan reactivates through the same sync.
    const paused = await db
        .update(subscriptions)
        .set({ status: 'paused', updatedAt: new Date() })
        .where(and(
            eq(subscriptions.paymentMethod, 'shopify'),
            eq(subscriptions.shopifyShopDomain, shopDomain),
            inArray(subscriptions.status, [...LIVE_STATUSES]),
        ))
        .returning({ userId: subscriptions.userId });

    for (const row of paused) {
        await subscriptionsService.invalidateStatusCache(row.userId);
    }
    if (paused.length > 0) {
        log.info({ shopDomain }, 'Shopify shows no active subscription — paused local mirror');
        return { outcome: 'paused', changed: true };
    }
    return { outcome: 'no_subscription', changed: false };
}

export interface ShopifyBillingSweepResult {
    /** active shopify stores examined */
    scanned: number;
    /** rows written to mirror a Shopify-side change (adopt or pause) */
    healed: number;
    /** D-H refusals + unknown plans — states a human must resolve */
    flagged: number;
    /** live local 'shopify' rows whose store row is gone/inactive */
    orphaned: number;
    /** per-store failures, isolated so one bad shop can't stall the sweep */
    errors: number;
}

/**
 * The 6-hourly authority of last resort (D-B/D-C): sweep every active Shopify
 * store through syncShopifyBilling, then flag live local mirrors whose store
 * disappeared without the uninstall webhook cancelling them.
 *
 * Idempotent and safe beside the live triggers — a no-drift sync writes
 * nothing, so steady state is read-only.
 */
export async function reconcileShopifyBilling(options?: {
    log?: LinkLogger;
}): Promise<ShopifyBillingSweepResult> {
    const log = options?.log ?? { info: () => {}, warn: () => {} };
    const result: ShopifyBillingSweepResult = {
        scanned: 0, healed: 0, flagged: 0, orphaned: 0, errors: 0,
    };

    const stores = await db
        .select({ storeDomain: ecommerceStores.storeDomain })
        .from(ecommerceStores)
        .where(and(
            eq(ecommerceStores.platform, 'shopify'),
            eq(ecommerceStores.isActive, true),
        ));

    for (const store of stores) {
        result.scanned++;
        try {
            const sync = await syncShopifyBilling(store.storeDomain, log);
            if (sync.changed) result.healed++;
            if (sync.outcome === 'refused' || sync.outcome === 'unknown_plan') result.flagged++;
        } catch (err) {
            result.errors++;
            log.warn(
                { shopDomain: store.storeDomain, err: err instanceof Error ? err.message : String(err) },
                'Shopify billing reconciliation failed for one store'
            );
        }
    }

    // A live local mirror with no active store behind it means the uninstall
    // webhook was missed — the merchant may still be billed by Shopify or may
    // have left entirely; either way Shopify is unreachable without the store
    // token, so a human decides (same posture as the Stripe sweep's orphans).
    const activeDomains = stores.map(s => s.storeDomain);
    const orphanWhere = and(
        eq(subscriptions.paymentMethod, 'shopify'),
        inArray(subscriptions.status, [...LIVE_STATUSES]),
        ...(activeDomains.length > 0
            ? [notInArray(subscriptions.shopifyShopDomain, activeDomains)]
            : []),
    );
    const orphans = await db
        .select({ id: subscriptions.id, shopifyShopDomain: subscriptions.shopifyShopDomain })
        .from(subscriptions)
        .where(orphanWhere);

    result.orphaned = orphans.length;
    if (orphans.length > 0) {
        captureError(
            new Error(`${orphans.length} live shopify-billed subscription(s) have no active store row`),
            'Shopify billing reconciliation found orphaned local mirrors',
            {
                level: 'warning',
                tags: { cron: 'shopify_billing_reconcile' },
                fingerprint: ['shopify-billing-orphaned-mirrors'],
                extra: { ...result, domains: orphans.map(o => o.shopifyShopDomain) },
            },
        );
    }

    // This sweep is the authority of last resort (D-B) — if it fails across
    // the board (dead token class, code regression), NOTHING else will ever
    // activate a paying merchant. Per-store warns don't reach Sentry, so a
    // systemic failure must raise one aggregated, fingerprinted event.
    if (result.errors > 0) {
        captureError(
            new Error(`Shopify billing reconciliation failed for ${result.errors}/${result.scanned} store(s)`),
            'Shopify billing reconciliation sweep errors',
            {
                level: 'warning',
                tags: { cron: 'shopify_billing_reconcile' },
                fingerprint: ['shopify-billing-sweep-errors'],
                extra: { ...result },
            },
        );
    }

    return result;
}
