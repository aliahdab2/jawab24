import { and, eq, isNull } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db';
import { subscriptions, users } from '../db/schema';
import { captureError } from '../utils/sentryHelpers';

/**
 * GA4 Measurement Protocol — server-side conversion reporting.
 *
 * WHY SERVER-SIDE. The browser tag (`gtag('config', …)` in `_app.tsx`) records
 * page views and nothing else. Google Ads cannot bid on page views, so every
 * conversion action in the Ads account sits at tracking status "Inactive" and
 * Smart Bidding has no signal. The milestones that actually mean "this became a
 * customer" — a page connected, a first auto-reply sent, a subscription paid —
 * are all known on the SERVER, hours or days after the click. Mirroring them
 * from here means:
 *   - the amount on a purchase is authoritative (Stripe's, not the browser's),
 *   - no ad blocker, CSP rule, or closed tab can drop the event,
 *   - it cannot double-fire on a page refresh.
 *
 * ⛔ THE MP CONTRACT THAT SURPRISES PEOPLE: this endpoint returns **204 for a
 * malformed event just as readily as for a good one**. There is no success
 * signal in the response body and no error for a bad event name, a bad
 * parameter, or an unknown measurement id. A 2xx here means "the bytes were
 * accepted", NOT "the event was recorded". The only way to validate a payload
 * is the debug endpoint — `sendGa4Event(…, { debug: true })` returns GA4's
 * `validationMessages` array. Use it from a script when changing this file;
 * never infer correctness from a green production log line.
 *
 * ATTRIBUTION. `client_id` is the `_ga` cookie's client component. It is what
 * ties this server event back to the browser session that carried the `gclid`,
 * which is what lets Google Ads credit a keyword. An event sent WITHOUT it is
 * rejected outright by MP; an event sent with a client_id GA4 has never seen
 * lands but attributes to nothing. Hence users.ga_client_id (first-touch) and
 * the hard skip below.
 */

const MP_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const MP_DEBUG_ENDPOINT = 'https://www.google-analytics.com/debug/mp/collect';

/** GA4 rejects a request that takes too long to build; keep the hop short and
 *  never let analytics hold a request handler or a webhook open. */
const MP_TIMEOUT_MS = 3000;

export interface Ga4SendResult {
    /** False when the send was skipped (no credentials, no client id) or failed. */
    sent: boolean;
    /** Why it was skipped/failed — for tests and the verification script. */
    reason?: 'not_configured' | 'no_client_id' | 'zero_amount' | 'already_reported' | 'http_error' | 'exception';
    /** Populated only for `{ debug: true }` — GA4's own validation verdict. */
    validationMessages?: unknown[];
}

/**
 * Send one event to GA4. Fire-and-forget by contract: it never throws, and every
 * failure path resolves to a result object rather than rejecting. Callers
 * intentionally do not await it in production.
 */
export async function sendGa4Event(
    clientId: string | null | undefined,
    eventName: string,
    params: Record<string, unknown> = {},
    options: { debug?: boolean } = {},
): Promise<Ga4SendResult> {
    const { measurementId, apiSecret } = config.ga4;
    if (!measurementId || !apiSecret) return { sent: false, reason: 'not_configured' };
    // No attribution id ⇒ MP would reject the payload anyway. Skip silently: this
    // is the normal state for every user who signed up before this shipped and
    // for anyone running an analytics blocker.
    if (!clientId) return { sent: false, reason: 'no_client_id' };

    const endpoint = options.debug ? MP_DEBUG_ENDPOINT : MP_ENDPOINT;
    const url = `${endpoint}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: clientId,
                // Google Ads cannot use an event flagged as non-personalized, and
                // the whole point of these events is bidding. Google signals is on
                // for the property, so this is consistent with the browser tag.
                non_personalized_ads: false,
                events: [{ name: eventName, params }],
            }),
            signal: AbortSignal.timeout(MP_TIMEOUT_MS),
        });

        if (options.debug) {
            const body = await response.json().catch(() => ({}));
            return {
                sent: response.ok,
                validationMessages: (body as { validationMessages?: unknown[] }).validationMessages ?? [],
            };
        }

        if (!response.ok) {
            // A non-2xx here is a transport/credential problem, not a bad event —
            // MP answers 204 for bad events. Worth a Sentry warning, not an error:
            // losing an analytics beacon must never page anyone.
            captureError(
                new Error(`GA4 Measurement Protocol returned ${response.status}`),
                'GA4 Measurement Protocol send failed',
                {
                    level: 'warning',
                    tags: { context: 'ga4' },
                    extra: { eventName, status: response.status },
                    fingerprint: ['ga4-mp-http-error'],
                },
            );
            return { sent: false, reason: 'http_error' };
        }

        return { sent: true };
    } catch (err) {
        captureError(err, 'GA4 Measurement Protocol request threw', {
            level: 'warning',
            tags: { context: 'ga4' },
            extra: { eventName },
            fingerprint: ['ga4-mp-exception'],
        });
        return { sent: false, reason: 'exception' };
    }
}

/**
 * Whether the integration is wired at all. Used to skip the `users` lookup that
 * would otherwise run on every activation emit in an environment with no GA4
 * credentials — which is every developer machine and the whole test suite.
 */
export function isGa4Configured(): boolean {
    return Boolean(config.ga4.measurementId && config.ga4.apiSecret);
}

/**
 * Report a completed purchase — the money event Google Ads bids on.
 *
 * VALUE IS THE POINT. With Basic at $8 next to Pro at $79, reporting every sale
 * as one identical conversion teaches Smart Bidding to chase the cheapest
 * signup. `value` + `currency` is what makes bidding revenue-aware, so this must
 * never degrade to a valueless event.
 *
 * ⭐ WHY THIS IS CALLED FROM TWO PLACES. Money reaches us by two different
 * Stripe events, and for most of our merchants it is the SECOND one:
 *
 *   - `checkout.session.completed` — a plan with no trial, charged at checkout.
 *   - `invoice.payment_succeeded` — a TRIALED plan's first real charge, ~30 days
 *     after signup, and then every renewal after that.
 *
 * Starter is the only plan carrying `trialDays: 30` and it is `isDefault: true`,
 * and `payment.ts` grants the trial to anyone with no prior subscription — i.e.
 * every new signup. So the trial path is the normal path (measured 2026-08-20:
 * 79 of 85 subscriptions carry a `trial_ends_at`). Hooking only the checkout
 * meant the money event could never fire for an acquired merchant at all.
 *
 * THE AMOUNT GUARD. A checkout that starts on a free trial completes with a
 * total of 0. That is a signup, not a purchase — the real charge arrives later
 * as `invoice.payment_succeeded`. Reporting it now would both inflate the
 * conversion COUNT and drag reported value-per-conversion toward zero, which is
 * precisely the input Smart Bidding optimises against.
 *
 * ⛔ THE ORDERING IS LOAD-BEARING: the amount guard runs BEFORE the claim. A $0
 * trial checkout must not consume the stamp, or the real payment 30 days later
 * finds it already set and is suppressed forever — turning the fix into the very
 * bug it removes.
 *
 * EXACTLY-ONCE, AND WHY NOT VIA GA4. `subscriptions.ga4_purchase_reported_at` is
 * claimed with `WHERE … IS NULL RETURNING`, so the first caller to see money
 * wins and every later one — the `subscription_create` invoice that follows a
 * paid checkout, and all 12 renewals a year — sends nothing. A renewal is not an
 * acquisition and must never be reported as one.
 *
 * `transaction_id` remains GA4's own dedup key, but it is now the SECOND line of
 * defence, not the first. It was never enough on its own: it absorbs a webhook
 * retried minutes later, and nothing documents GA4 de-duplicating against a
 * transaction it last saw a month ago. The database claim is what makes the
 * guarantee ours rather than a vendor's undocumented retention window.
 *
 * ⚠️ CLAIM-THEN-SEND, stated rather than papered over: if the MP call fails
 * after the claim, that conversion is lost — the stamp is not released. Chosen
 * deliberately. A double-reported purchase corrupts bidding (it teaches Google a
 * merchant is worth twice what they are); a dropped analytics beacon costs one
 * signal, and this whole module is fire-and-forget by contract. Releasing the
 * stamp on failure would reopen the double-send window that Stripe's own retries
 * make real.
 */
export async function sendPurchaseConversion(params: {
    /** Stripe subscription id — identifies the row that carries the claim. */
    stripeSubscriptionId: string;
    /** GA4's purchase dedup key: the checkout session id, or the invoice id. */
    transactionId: string;
    /** Stripe reports MINOR units (cents); GA4 wants a major-unit decimal. */
    amountMinorUnits: number | null | undefined;
    currency: string | null | undefined;
    planId: string | null | undefined;
}): Promise<Ga4SendResult> {
    const { stripeSubscriptionId, transactionId, amountMinorUnits, currency, planId } = params;

    // BEFORE the claim — see the ordering note above.
    if (!amountMinorUnits || amountMinorUnits <= 0) {
        return { sent: false, reason: 'zero_amount' };
    }

    // Cheap guard before writing anything: with no credentials the send could
    // never happen, so stamping the row would silently burn the one claim this
    // subscription gets and suppress the purchase forever once GA4 IS wired.
    if (!isGa4Configured()) return { sent: false, reason: 'not_configured' };

    let claimedUserId: string;
    try {
        // Atomic claim. The `IS NULL` predicate is the whole guarantee, so it
        // lives here and nowhere else — a restated copy drifts the moment this
        // one changes. Returning userId in the same statement also spares a
        // second round trip to resolve the attribution id's owner.
        // Deliberately NOT setting `updatedAt`, and deliberately NOT invalidating
        // the subscription status cache — unlike every neighbouring mutation in
        // paymentWebhookHandlers, which do both. This write touches no
        // entitlement, no status and no period, so there is nothing for a reader
        // to see stale; and `updatedAt` is the only proxy this table has for
        // "when did the subscription last really change", which an analytics
        // stamp must not overwrite on every merchant that pays.
        const claimed = await db
            .update(subscriptions)
            .set({ ga4PurchaseReportedAt: new Date() })
            .where(and(
                eq(subscriptions.externalSubscriptionId, stripeSubscriptionId),
                isNull(subscriptions.ga4PurchaseReportedAt),
            ))
            .returning({ userId: subscriptions.userId });

        // No row: either already reported (the renewal case, by far the most
        // common) or the subscription is not linked to Stripe yet. Neither is an
        // error and neither should send.
        if (claimed.length === 0) return { sent: false, reason: 'already_reported' };
        claimedUserId = claimed[0].userId;
    } catch (err) {
        captureError(err, 'Failed to claim the GA4 purchase report', {
            level: 'warning',
            tags: { context: 'ga4' },
            extra: { stripeSubscriptionId, transactionId },
            fingerprint: ['ga4-purchase-claim'],
        });
        return { sent: false, reason: 'exception' };
    }

    return sendGa4EventForUser(claimedUserId, 'purchase', {
        transaction_id: transactionId,
        value: amountMinorUnits / 100,
        currency: (currency ?? 'usd').toUpperCase(),
        // planId is absent only if Stripe lost the subscription metadata; report
        // the sale rather than dropping it, since value is what bidding needs.
        items: [{ item_id: planId ?? 'unknown', item_name: planId ?? 'unknown', quantity: 1 }],
    });
}

/**
 * Record a user's GA4 client id, FIRST-TOUCH: the write is conditional on the
 * column still being NULL, so the earliest id we ever see wins and no later
 * login can repoint the user's conversions away from the click that paid for
 * them. The `_ga` cookie is per-browser, so "later" routinely means "a different
 * device", not "a corrected value".
 *
 * The guarantee IS this WHERE clause, which is why this lives in one place and
 * both the controller and its integration test call it rather than restating the
 * SQL — a restated predicate drifts silently the moment this one changes.
 *
 * Returns whether THIS call stored the id — true exactly once per user, ever.
 * That single `true` is what triggers the replay of the milestones recorded
 * before the id existed (`replayPendingActivationEventsToGa4`): the `sign_up`
 * row is inserted inside the auth request, while the browser can only post the
 * id after it holds the token from that same response, so at mirror time the
 * column is always still NULL. Keying the replay on the first-touch write also
 * means a user whose id is already stored can never be replayed again.
 */
export async function storeGaClientIdFirstTouch(userId: string, clientId: string): Promise<boolean> {
    const written = await db
        .update(users)
        .set({ gaClientId: clientId })
        .where(and(eq(users.id, userId), isNull(users.gaClientId)))
        .returning({ id: users.id });
    return written.length > 0;
}

/**
 * Send an event on behalf of a user, resolving their stored attribution id.
 *
 * Used by the Stripe purchase hook, which claims its stamp on `subscriptions`
 * and then needs "look up users.ga_client_id, then send". The activation mirror
 * does NOT come through here: its claim joins `users` and returns the client id
 * in the same statement (services/activation.ts), so a row can never be claimed
 * while the id is still missing.
 *
 * Fire-and-forget: contained failures only, never throws into the caller.
 */
export async function sendGa4EventForUser(
    userId: string,
    eventName: string,
    params: Record<string, unknown> = {},
): Promise<Ga4SendResult> {
    // Cheap guard first: with no credentials this would otherwise add a `users`
    // SELECT to every emit on every dev machine and in the whole test suite, for
    // a call that could never be made.
    if (!isGa4Configured()) return { sent: false, reason: 'not_configured' };

    try {
        const [user] = await db
            .select({ gaClientId: users.gaClientId })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        return await sendGa4Event(user?.gaClientId, eventName, params);
    } catch (err) {
        captureError(err, 'Failed to resolve GA4 client id for user', {
            level: 'warning',
            tags: { context: 'ga4' },
            extra: { userId, eventName },
            fingerprint: ['ga4-client-id-lookup'],
        });
        return { sent: false, reason: 'exception' };
    }
}
