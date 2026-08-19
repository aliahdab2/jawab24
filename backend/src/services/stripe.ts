import Stripe from 'stripe';
import { config } from '../config';

// Initialize Stripe only if keys are provided (optional for preview)
export const stripe = config.stripe?.secretKey
    ? new Stripe(config.stripe.secretKey, {
        // Keep in lock-step with the SDK's bundled version (stripe/esm/apiVersion.js).
        // Webhook payload shapes are governed by the *endpoint* version in the
        // Dashboard, not this pin — utils/stripeCompat.ts absorbs that drift.
        apiVersion: '2026-06-24.dahlia',
        typescript: true,
    })
    : null;

function requireStripe(): Stripe {
    if (!stripe) {
        throw new Error('Stripe is not configured. Please add STRIPE_SECRET_KEY to environment variables.');
    }
    return stripe;
}

/**
 * Resolve a Stripe expandable reference (e.g. `payment_intent`, `customer`) to
 * its id. Stripe returns these as either the id string or the expanded object;
 * this collapses both to the id (or null). Avoids repeating the
 * `typeof x === 'string' ? x : x?.id` idiom at every call site.
 */
export function stripeRefId(ref: string | { id: string } | null | undefined): string | null {
    if (!ref) return null;
    return typeof ref === 'string' ? ref : ref.id;
}

export class DemoUserStripeError extends Error {
    code = 'DEMO_USER_STRIPE_BLOCKED';
    constructor() {
        super('Demo accounts cannot create Stripe customers or subscriptions');
        this.name = 'DemoUserStripeError';
    }
}

function assertNotDemoUser(email: string): void {
    if (email && email.toLowerCase() === config.demo.userEmail.toLowerCase()) {
        throw new DemoUserStripeError();
    }
}

export class StripeService {
    /**
     * Create a Stripe Checkout Session for subscription
     * @param trialDays - Number of trial days (0 = no trial, only for new users on eligible plans)
     */
    /**
     * Params shared by BOTH subscription-checkout modes (embedded + hosted),
     * extracted so the two can never drift apart. The subscription_data
     * metadata in here is load-bearing: it is what lets the webhook handlers
     * and the reconciliation sweep link the resulting Stripe subscription back
     * to the local user (see services/subscriptionLinking.ts).
     */
    private buildSubscriptionSessionParams(
        userId: string,
        userEmail: string,
        planId: string,
        priceId: string,
        trialDays: number
    ): Stripe.Checkout.SessionCreateParams {
        // Build subscription data - only include trial if trialDays > 0
        const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
            metadata: {
                userId,
                planId,
            },
        };

        // Only add trial period if explicitly requested (new users on eligible plans)
        if (trialDays > 0) {
            subscriptionData.trial_period_days = trialDays;
        }

        return {
            customer_email: userEmail,
            client_reference_id: userId,
            mode: 'subscription',
            locale: 'auto',
            payment_method_collection: 'if_required',
            // Collect VAT IDs and billing address so Stripe can issue VAT-compliant
            // invoices (legally required for KSA/UAE/EU B2B customers). Stripe also
            // emails these invoices automatically when "Email finalized invoices"
            // is enabled in Dashboard → Invoicing settings. customer_update is not
            // valid here because we pass customer_email (Stripe creates a new
            // customer and applies collected fields automatically).
            tax_id_collection: { enabled: true },
            billing_address_collection: 'auto',
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            subscription_data: subscriptionData,
            metadata: {
                userId,
                planId,
            },
        };
    }

    async createCheckoutSession(
        userId: string,
        userEmail: string,
        planId: string,
        priceId: string,
        returnUrl: string,
        trialDays: number = 0
    ): Promise<Stripe.Checkout.Session> {
        assertNotDemoUser(userEmail);
        const s = requireStripe();
        // Per-minute bucket: a double-clicked Subscribe dedupes to one session;
        // a deliberate retry next minute creates a fresh one.
        const bucket = Math.floor(Date.now() / 60_000);
        const idempotencyKey = `checkout:${userId}:${planId}:${priceId}:${trialDays}:${bucket}`;

        const session = await s.checkout.sessions.create(
            {
                ...this.buildSubscriptionSessionParams(userId, userEmail, planId, priceId, trialDays),
                // 'embedded' was renamed 'embedded_page' in newer API versions;
                // it is the same Stripe.js embedded-checkout integration.
                ui_mode: 'embedded_page',
                return_url: returnUrl,
            },
            { idempotencyKey }
        );

        return session;
    }

    /**
     * HOSTED subscription checkout — the customer pays on checkout.stripe.com.
     *
     * WHY THIS EXISTS (2026-07-25, D-040). The embedded PaymentElement embeds
     * Stripe as a THIRD party: a cross-origin iframe that tokenises the card
     * against api.stripe.com. Privacy browsers are built to interfere with
     * exactly that pattern — a merchant on Brave (his phone's default browser,
     * where our Android app bounces all payments) filled the form, pressed pay,
     * and the card never left his device: no PaymentMethod in Stripe, no error
     * anywhere, three attempts. The same card paid instantly on a Stripe-hosted
     * invoice page, where Stripe is first-party and there is nothing to block.
     *
     * Hosted checkout makes that failure impossible rather than detected.
     * Completion arrives via `checkout.session.completed` (handleCheckoutComplete),
     * with adoption + the reconciliation sweep as backstops.
     *
     * Returns the session with a non-null `url` to redirect the customer to.
     * `ui_mode` is intentionally omitted — hosted is Stripe's default.
     */
    async createHostedCheckoutSession(
        userId: string,
        userEmail: string,
        planId: string,
        priceId: string,
        successUrl: string,
        cancelUrl: string,
        trialDays: number = 0
    ): Promise<{ sessionId: string; url: string }> {
        assertNotDemoUser(userEmail);
        const s = requireStripe();
        // 'hosted' in the key so a same-minute retry after switching modes can't
        // replay the embedded session's params (Stripe rejects an idempotent
        // replay whose params differ — the customer would see a hard error).
        const bucket = Math.floor(Date.now() / 60_000);
        const idempotencyKey = `checkout:hosted:${userId}:${planId}:${priceId}:${trialDays}:${bucket}`;

        const session = await s.checkout.sessions.create(
            {
                ...this.buildSubscriptionSessionParams(userId, userEmail, planId, priceId, trialDays),
                success_url: successUrl,
                cancel_url: cancelUrl,
            },
            { idempotencyKey }
        );

        if (!session.url) {
            throw new Error(`Hosted checkout session ${session.id} has no redirect URL`);
        }
        return { sessionId: session.id, url: session.url };
    }

    /**
     * Create a HOSTED Stripe Checkout Session for a one-time CUSTOM amount —
     * the "collect payment" link an admin generates and sends to a customer to
     * pay for replies already credited by hand. Returns the hosted `url`.
     *
     * `mode: 'payment'` (one-time, not a subscription) so the completion event
     * is `checkout.session.completed` — already subscribed on the webhook
     * endpoint — with no dependency on `payment_intent.succeeded`. The amount is
     * inline `price_data` (no Stripe Product/Price needed). Metadata carries
     * `type: 'manual_payment'` + `paymentRequestId` so the webhook routes it to
     * the collect-only handler and NEVER credits reply balance.
     *
     * Sanctions: enforced by Stripe at payment time on the hosted page. The
     * usual `request.geo` check doesn't apply here — this is admin-initiated, so
     * the requester geo is the admin's, not the paying customer's.
     */
    async createManualPaymentSession(params: {
        userId: string;
        userEmail: string;
        amountCents: number;
        currency: string;
        description: string;
        paymentRequestId: string;
        successUrl: string;
        cancelUrl: string;
    }): Promise<Stripe.Checkout.Session> {
        assertNotDemoUser(params.userEmail);
        const s = requireStripe();
        const metadata = {
            type: 'manual_payment',
            userId: params.userId,
            paymentRequestId: params.paymentRequestId,
        };
        return s.checkout.sessions.create(
            {
                customer_email: params.userEmail,
                client_reference_id: params.userId,
                mode: 'payment',
                locale: 'auto',
                billing_address_collection: 'auto',
                line_items: [
                    {
                        quantity: 1,
                        price_data: {
                            currency: params.currency,
                            unit_amount: params.amountCents,
                            product_data: {
                                name: params.description || 'Smart Reply credit',
                            },
                        },
                    },
                ],
                success_url: params.successUrl,
                cancel_url: params.cancelUrl,
                // Mirror metadata onto the PaymentIntent so refund/audit tooling
                // that inspects the charge can also see this is a manual payment.
                payment_intent_data: { metadata },
                metadata,
            },
            // One session per payment-request row — re-issuing the same request
            // returns the same session instead of spawning duplicates.
            { idempotencyKey: `manual_payment:${params.paymentRequestId}` }
        );
    }

    /**
     * Find or create a Stripe Customer for a user.
     */
    async findOrCreateCustomer(email: string, userId: string): Promise<string> {
        assertNotDemoUser(email);
        const s = requireStripe();
        const existing = await s.customers.list({ email, limit: 1 });
        if (existing.data.length > 0) {
            return existing.data[0].id;
        }
        // Per (userId, email) so concurrent creates dedupe but a later email change
        // doesn't reuse the cached key with mismatched params (Stripe would 400).
        const customer = await s.customers.create(
            { email, metadata: { userId } },
            { idempotencyKey: `customer:${userId}:${email.toLowerCase()}` }
        );
        return customer.id;
    }

    /**
     * Create an incomplete subscription and return the client_secret
     * from either a PaymentIntent (no trial) or SetupIntent (trial).
     */
    async createSubscriptionIntent(params: {
        customerId: string;
        priceId: string;
        userId: string;
        planId: string;
        trialDays: number;
    }): Promise<{
        subscriptionId: string;
        clientSecret: string;
        type: 'payment' | 'setup';
    }> {
        const s = requireStripe();

        const subscriptionParams: Stripe.SubscriptionCreateParams = {
            customer: params.customerId,
            items: [{ price: params.priceId }],
            metadata: { userId: params.userId, planId: params.planId },
            payment_settings: {
                save_default_payment_method: 'on_subscription',
            },
            // confirmation_secret replaces the pre-basil latest_invoice.payment_intent
            // expansion as the way to obtain the client_secret for the first charge.
            expand: ['latest_invoice.confirmation_secret', 'pending_setup_intent'],
        };

        if (params.trialDays > 0) {
            subscriptionParams.trial_period_days = params.trialDays;
        } else {
            subscriptionParams.payment_behavior = 'default_incomplete';
        }

        // Per-minute bucket: protects against double-create on quick retry without
        // permanently locking the user out of legitimate later attempts (cancel + resub).
        const bucket = Math.floor(Date.now() / 60_000);
        const idempotencyKey = `sub:${params.userId}:${params.priceId}:${params.trialDays}:${bucket}`;
        const subscription = await s.subscriptions.create(
            subscriptionParams,
            { idempotencyKey }
        );

        if (params.trialDays > 0) {
            const setupIntent = subscription.pending_setup_intent as Stripe.SetupIntent | null;
            if (!setupIntent?.client_secret) {
                throw new Error(`Stripe setup intent missing client_secret for subscription ${subscription.id}`);
            }
            return {
                subscriptionId: subscription.id,
                clientSecret: setupIntent.client_secret,
                type: 'setup',
            };
        }

        const invoice = subscription.latest_invoice as Stripe.Invoice | null;
        const clientSecret = invoice?.confirmation_secret?.client_secret;
        if (!clientSecret) {
            throw new Error(`Stripe confirmation secret missing client_secret for subscription ${subscription.id}`);
        }
        return {
            subscriptionId: subscription.id,
            clientSecret,
            type: 'payment',
        };
    }

    /**
     * Create a one-time PaymentIntent for a Credit top-up pack.
     *
     * Unlike subscriptions, this is a single charge — no recurring item. The
     * `metadata.type = 'topup'` tag is load-bearing: the webhook handler keys
     * off it to tell a top-up PaymentIntent apart from the PaymentIntents
     * Stripe also emits for subscription invoices (both fire
     * `payment_intent.succeeded`). Without the tag the webhook ignores the
     * event, so subscription PIs are never mistaken for top-ups.
     *
     * `payment_method_types: ['card']` keeps Link off (matching the
     * subscription PaymentElement) and the per-minute idempotency bucket
     * dedupes a double-clicked "Pay with card" to a single PaymentIntent while
     * still allowing a deliberate retry next minute.
     */
    async createTopupPaymentIntent(params: {
        customerId: string;
        amountCents: number;
        currency: string;
        userId: string;
        pack: string;
    }): Promise<Stripe.PaymentIntent> {
        const s = requireStripe();
        const bucket = Math.floor(Date.now() / 60_000);
        const idempotencyKey = `topup:${params.userId}:${params.pack}:${bucket}`;
        return s.paymentIntents.create(
            {
                amount: params.amountCents,
                currency: params.currency,
                customer: params.customerId,
                payment_method_types: ['card'],
                metadata: { type: 'topup', userId: params.userId, pack: params.pack },
            },
            { idempotencyKey }
        );
    }

    /**
     * Retrieve a Checkout Session by ID (for checking completion status)
     */
    async getCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
        return requireStripe().checkout.sessions.retrieve(sessionId);
    }

    /**
     * Retrieve a PaymentIntent by ID — used by the top-up reconciliation sweep
     * to check the authoritative payment status when a webhook may have been
     * missed (money captured but reply credit not yet applied).
     *
     * `latest_charge` is expanded because PaymentIntent.status alone is NOT
     * sufficient to decide whether to credit: a refund or dispute attaches to
     * the Charge and does NOT flip pi.status away from 'succeeded'. The sweep
     * must inspect the charge's refunded/amount_refunded/disputed flags before
     * crediting, or it would grant reply credits for money that was returned.
     */
    async retrievePaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
        return requireStripe().paymentIntents.retrieve(paymentIntentId, {
            expand: ['latest_charge'],
        });
    }

    /**
     * Cancel a PaymentIntent — used to retire an abandoned top-up checkout so it
     * can never later capture money (which would double-credit a customer the
     * admin has already credited by hand).
     *
     * Stripe only allows cancellation while the PI is in a non-terminal,
     * uncaptured state (requires_payment_method / requires_capture /
     * requires_confirmation / requires_action / processing). If it has raced to
     * `succeeded` (the customer paid in the meantime), this throws — callers MUST
     * treat that throw as "money is in flight, do NOT clear the pending row".
     */
    async cancelPaymentIntent(
        paymentIntentId: string,
        cancellationReason?: Stripe.PaymentIntentCancelParams.CancellationReason,
    ): Promise<Stripe.PaymentIntent> {
        return requireStripe().paymentIntents.cancel(
            paymentIntentId,
            cancellationReason ? { cancellation_reason: cancellationReason } : undefined,
        );
    }

    /**
     * Get Stripe Customer by ID
     */
    async getCustomer(customerId: string): Promise<Stripe.Customer> {
        return await requireStripe().customers.retrieve(customerId) as Stripe.Customer;
    }

    /**
     * Get Stripe Subscription by ID
     */
    async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
        return requireStripe().subscriptions.retrieve(subscriptionId);
    }

    /**
     * Get a subscription with its latest invoice expanded — the dunning sweep's
     * catch-up path (services/dunningNotices.ts) needs the invoice's hosted
     * payment URL and amount for rows whose original webhook payload is long
     * gone. Expand precedent: createSubscriptionIntent's `latest_invoice.…`.
     */
    async getSubscriptionWithLatestInvoice(subscriptionId: string): Promise<Stripe.Subscription> {
        return requireStripe().subscriptions.retrieve(subscriptionId, {
            expand: ['latest_invoice'],
        });
    }

    /**
     * List subscriptions in a given state, following pagination.
     *
     * Used by the reconciliation sweep, which treats Stripe as the authority on
     * who is actually paying. `limit` caps the total pulled per call so a large
     * account can't turn one sweep into an unbounded crawl.
     *
     * `latest_invoice` is EXPANDED because the sweep's period healer needs each
     * invoice's `status` to tell a paid renewal from one Stripe has merely
     * invoiced (services/subscriptionLinking.ts). List-level expansion verified
     * against the live API on 2026-08-19 — it returns the full invoice object,
     * so the healer costs zero extra API calls no matter how many rows it
     * examines. Without it every examined row would need its own retrieve.
     */
    async listSubscriptions(params: {
        status: Stripe.SubscriptionListParams.Status;
        limit?: number;
    }): Promise<Stripe.Subscription[]> {
        const s = requireStripe();
        const max = params.limit ?? 100;
        const out: Stripe.Subscription[] = [];
        let startingAfter: string | undefined;

        while (out.length < max) {
            const page = await s.subscriptions.list({
                status: params.status,
                limit: Math.min(100, max - out.length),
                expand: ['data.latest_invoice'],
                ...(startingAfter ? { starting_after: startingAfter } : {}),
            });
            out.push(...page.data);
            if (!page.has_more || page.data.length === 0) break;
            startingAfter = page.data[page.data.length - 1].id;
        }

        return out;
    }

    /**
     * Cancel a subscription at period end (user-initiated cancellation)
     */
    async cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
        return requireStripe().subscriptions.update(subscriptionId, {
            cancel_at_period_end: true,
        });
    }

    /**
     * Cancel a subscription immediately (for plan changes/upgrades)
     */
    async cancelSubscriptionImmediately(subscriptionId: string): Promise<Stripe.Subscription> {
        return requireStripe().subscriptions.cancel(subscriptionId);
    }

    /**
     * Resume a canceled subscription
     */
    async resumeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
        return requireStripe().subscriptions.update(subscriptionId, {
            cancel_at_period_end: false,
        });
    }

    /**
     * Switch the price on an existing subscription with proration. Stripe
     * issues a credit for the unused portion of the old plan and a prorated
     * charge for the new plan; net amount is reflected on the next invoice
     * (or charged immediately if proration_behavior is 'always_invoice').
     */
    async updateSubscriptionPrice(
        subscriptionId: string,
        newPriceId: string
    ): Promise<Stripe.Subscription> {
        const s = requireStripe();
        const current = await s.subscriptions.retrieve(subscriptionId);
        const itemId = current.items.data[0]?.id;
        if (!itemId) {
            throw new Error(`Subscription ${subscriptionId} has no items to update`);
        }
        // Per-minute bucket prevents duplicate prorations on retry while letting a
        // genuine later plan-change with the same target price succeed (item id may
        // change between calls, so a stable key would 400 with "params mismatch").
        const bucket = Math.floor(Date.now() / 60_000);
        const idempotencyKey = `subupd:${subscriptionId}:${newPriceId}:${bucket}`;
        return s.subscriptions.update(
            subscriptionId,
            {
                items: [{ id: itemId, price: newPriceId }],
                proration_behavior: 'create_prorations',
                metadata: current.metadata,
            },
            { idempotencyKey }
        );
    }

    /**
     * Issue a refund against a charge or payment intent.
     */
    async refund(params: { chargeId?: string; paymentIntentId?: string; reason?: string; metadata?: Record<string, string>; idempotencyKey?: string }): Promise<Stripe.Refund> {
        const s = requireStripe();
        // A retried refund without an idempotency key issues a second refund — real money loss.
        return s.refunds.create(
            {
                charge: params.chargeId,
                payment_intent: params.paymentIntentId,
                metadata: params.metadata,
            },
            params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined
        );
    }

    /**
     * Create a billing portal session. When STRIPE_BILLING_PORTAL_CONFIG_ID is
     * set, the portal is locked to invoice history + payment method updates
     * only — plan changes and cancellations go through the app.
     */
    async createBillingPortalSession(
        customerId: string,
        returnUrl: string
    ): Promise<Stripe.BillingPortal.Session> {
        const params: Stripe.BillingPortal.SessionCreateParams = {
            customer: customerId,
            return_url: returnUrl,
        };
        if (config.stripe.billingPortalConfigId) {
            params.configuration = config.stripe.billingPortalConfigId;
        }
        return requireStripe().billingPortal.sessions.create(params);
    }

    /**
     * Verify webhook signature
     */
    verifyWebhookSignature(
        payload: string | Buffer,
        signature: string,
        secret: string
    ): Stripe.Event {
        return requireStripe().webhooks.constructEvent(payload, signature, secret);
    }
}

export const stripeService = new StripeService();
