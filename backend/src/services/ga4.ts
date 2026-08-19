import { and, eq, isNull } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db';
import { users } from '../db/schema';
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
    reason?: 'not_configured' | 'no_client_id' | 'zero_amount' | 'http_error' | 'exception';
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
 * THE AMOUNT GUARD. A checkout that starts on a free trial completes with a
 * total of 0. That is a signup, not a purchase — the real charge arrives later
 * as `invoice.payment_succeeded`. Reporting it now would both inflate the
 * conversion COUNT and drag reported value-per-conversion toward zero, which is
 * precisely the input Smart Bidding optimises against.
 *
 * `transactionId` is GA4's purchase dedup key. Stripe retries a webhook whose
 * handler 5xx'd, so the same purchase can legitimately reach this function more
 * than once; the checkout session id makes the repeat a no-op inside GA4.
 */
export async function sendPurchaseConversion(params: {
    userId: string;
    /** Stripe checkout session id — GA4 dedups purchases on this. */
    transactionId: string;
    /** Stripe reports MINOR units (cents); GA4 wants a major-unit decimal. */
    amountMinorUnits: number | null | undefined;
    currency: string | null | undefined;
    planId: string;
}): Promise<Ga4SendResult> {
    const { userId, transactionId, amountMinorUnits, currency, planId } = params;

    if (!amountMinorUnits || amountMinorUnits <= 0) {
        return { sent: false, reason: 'zero_amount' };
    }

    return sendGa4EventForUser(userId, 'purchase', {
        transaction_id: transactionId,
        value: amountMinorUnits / 100,
        currency: (currency ?? 'usd').toUpperCase(),
        items: [{ item_id: planId, item_name: planId, quantity: 1 }],
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
 */
export async function storeGaClientIdFirstTouch(userId: string, clientId: string): Promise<void> {
    await db
        .update(users)
        .set({ gaClientId: clientId })
        .where(and(eq(users.id, userId), isNull(users.gaClientId)));
}

/**
 * Send an event on behalf of a user, resolving their stored attribution id.
 *
 * This is the entry point every server-side conversion should use — the
 * activation mirror and the Stripe purchase hook both need "look up
 * users.ga_client_id, then send", and that lookup must not be written twice.
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
