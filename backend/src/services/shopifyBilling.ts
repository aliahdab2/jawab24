import { db } from '../db';
import { subscriptions, ecommerceStores } from '../db/schema';
import { and, eq, desc, inArray, notInArray } from 'drizzle-orm';
import { subscriptionsService } from './subscriptions';
import { plansService } from './plans';
import { shopifyGraphQL } from './shopify';
import { decrypt } from './ecommerceCrypto';
import { mapShopifyPlanToSlug, LIVE_SUBSCRIPTION_STATUSES } from '../config/shopifyBilling';
import { captureError } from '../utils/sentryHelpers';
import { noopLinkLogger, type LinkLogger } from '../types/linkLogger';
import { isDemoStore } from './demoStore';
import { resolveBillingSubjectUserId } from './ecommerce';

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

const DAY_MS = 24 * 60 * 60 * 1000;

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
    // Both fail-loud shapes, defined once. `unknownPlan` = D-I (config drift,
    // level error); `refuse` = D-H (a live relationship is in the way, level
    // warning, human decides). Fingerprints are explicit per call so their
    // presence/absence is a visible decision, not an accident.
    const unknownPlan = (error: string, summary: string, extra: Record<string, unknown>): ShopifyBillingSyncResult => {
        captureError(new Error(error), summary, {
            level: 'error',
            tags: { service: 'shopify_billing', flow: 'plan_mapping' },
            extra: { shopDomain, ...extra },
        });
        return { outcome: 'unknown_plan', changed: false };
    };
    const refuse = (error: string, summary: string, extra: Record<string, unknown>, fingerprint?: string[]): ShopifyBillingSyncResult => {
        captureError(new Error(error), summary, {
            level: 'warning',
            tags: { service: 'shopify_billing', flow: 'adopt_refused' },
            fingerprint,
            extra: { shopDomain, userId, appSubscriptionId: appSub.id, ...extra },
        });
        return { outcome: 'refused', changed: false };
    };

    const slug = mapShopifyPlanToSlug(appSub.name);
    if (!slug) {
        return unknownPlan(
            `Shopify plan "${appSub.name}" maps to no local plan slug`,
            'Shopify billing: unknown plan — refusing to activate (D-I)',
            { appSubscriptionId: appSub.id, planName: appSub.name },
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

    // Two active Shopify stores resolving to one subject user must NOT
    // ping-pong the mirror between them: each flip would rewrite GID/domain/
    // plan and re-run initializeUsagePeriod — silently resetting the quota
    // window every sync. Same D-H posture: Sentry, human decides which shop
    // bills this workspace. Same-domain new-GID adoption (plan upgrades)
    // stays allowed.
    if (
        currentIsLive &&
        current.paymentMethod === 'shopify' &&
        current.shopifyShopDomain &&
        current.shopifyShopDomain !== shopDomain
    ) {
        return refuse(
            `Shopify subscription for ${shopDomain} collides with a live mirror for ${current.shopifyShopDomain}`,
            'Shopify billing: refusing cross-shop adoption over a live shopify mirror (D-H)',
            { localSubscriptionId: current.id, localShopDomain: current.shopifyShopDomain },
            ['shopify-billing-cross-shop-refused'],
        );
    }

    // D-H: never silently take over a live paid relationship on another rail.
    // A canceled/paused stripe row is fair game (the merchant left and came
    // back through Shopify); a live one is a double-billing risk a human must
    // untangle — Sentry and stand down. 'paypal' is a documented legacy value
    // for this column — treated like stripe/manual rather than silently eaten.
    // 'zid'/'salla' were absent while those rails did not exist; their adopts
    // have always refused over a live shopify row, and the refusal must be
    // symmetric or the outcome depends on which rail's sync ran last.
    if (
        currentIsLive &&
        ['stripe', 'manual', 'paypal', 'zid', 'salla'].includes(current.paymentMethod ?? '')
    ) {
        return refuse(
            `Shopify subscription for ${shopDomain} collides with a live ${current.paymentMethod} subscription`,
            'Shopify billing: refusing to adopt over a paying row on another rail (D-H)',
            { localSubscriptionId: current.id, localPaymentMethod: current.paymentMethod, localStatus: current.status },
        );
    }

    // Plan row fetched AFTER the refusal gates — a refused adoption must not
    // pay for a plans read it never uses.
    const plan = await plansService.getPlanBySlug(slug);
    if (!plan) {
        return unknownPlan(
            `Plan slug "${slug}" has no row in plans — Shopify billing cannot activate`,
            'Shopify billing: mapped slug missing from plans table (D-I)',
            { slug },
        );
    }

    // D-J: trials mirror Shopify — the trial clock is createdAt + trialDays,
    // Shopify's own accounting. No local trial ledger involvement.
    const now = new Date();
    const trialEndsAt = appSub.trialDays && appSub.trialDays > 0
        ? new Date(new Date(appSub.createdAt).getTime() + appSub.trialDays * DAY_MS)
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
 * Transition every LIVE mirror row for a shop and invalidate the affected
 * owners' status caches. The WHERE triple here is THE row-targeting invariant
 * of this module — the same shape as the partial unique index in migration
 * 0147 — so cancel (uninstall / gdpr redact) and pause (Shopify shows no
 * subscription) share one copy of it instead of drifting apart.
 */
async function updateLiveMirrorsForShop(
    shopDomain: string,
    set: Partial<typeof subscriptions.$inferInsert>,
): Promise<Array<{ id: string; userId: string }>> {
    const rows = await db
        .update(subscriptions)
        .set(set)
        .where(and(
            eq(subscriptions.paymentMethod, 'shopify'),
            eq(subscriptions.shopifyShopDomain, shopDomain),
            inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]),
        ))
        .returning({ id: subscriptions.id, userId: subscriptions.userId });

    for (const row of rows) {
        await subscriptionsService.invalidateStatusCache(row.userId);
    }
    return rows;
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
    const rows = await updateLiveMirrorsForShop(shopDomain, {
        status: 'canceled',
        canceledAt: new Date(),
        cancelReason: reason,
        updatedAt: new Date(),
    });
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

    const accessToken = decrypt(store.accessToken, store.accessTokenIv);
    const appSub = await fetchShopifyActiveSubscription(shopDomain, accessToken);

    if (appSub) {
        // D-E: the entitlement subject is the WORKSPACE OWNER (the
        // hasWhatsAppPlanAccess pattern) — plan limits are resolved against the
        // owner's subscription, so the mirror must land on the owner's row even
        // when a non-owner member connected the store. Resolved only here: the
        // pause/no-op branches below never need it, and the 6h sweep's steady
        // state should not pay a query per store for nothing.
        const subjectUserId = await resolveBillingSubjectUserId(store);
        return adoptShopifySubscription(subjectUserId, appSub, shopDomain, log);
    }

    // Shopify says nobody is paying for this shop. Pause a live local mirror
    // (D-B: reconcile-driven expiry — cancellation inside Shopify has no
    // webhook either). 'paused', not 'canceled': the app is still installed
    // and re-picking a plan reactivates through the same sync.
    const paused = await updateLiveMirrorsForShop(shopDomain, { status: 'paused', updatedAt: new Date() });
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
    const log = options?.log ?? noopLinkLogger;
    const result: ShopifyBillingSweepResult = {
        scanned: 0, healed: 0, flagged: 0, orphaned: 0, errors: 0,
    };

    const storeRows = await db
        .select({
            storeDomain: ecommerceStores.storeDomain,
            platformData: ecommerceStores.platformData,
        })
        .from(ecommerceStores)
        .where(and(
            eq(ecommerceStores.platform, 'shopify'),
            eq(ecommerceStores.isActive, true),
        ));

    // Demo-seeded stores hold placeholder tokens that decrypt() rejects — every
    // real-API path must skip them (see services/demoStore.ts; the filter is a
    // JS predicate because jsonb rows can be stored as string scalars, so a SQL
    // `platformData->>'demo'` condition silently matches nothing).
    const stores = storeRows.filter(store => !isDemoStore(store));

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
    // Orphan detection keys on "does an active store row exist", so demo rows
    // stay in the domain list — a demo subscription mirrored to a demo store
    // must not be flagged as orphaned.
    const activeDomains = storeRows.map(s => s.storeDomain);
    const orphanWhere = and(
        eq(subscriptions.paymentMethod, 'shopify'),
        inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]),
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
