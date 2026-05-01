import Stripe from 'stripe';
import { config } from '../config';

// Initialize Stripe only if keys are provided (optional for preview)
export const stripe = config.stripe?.secretKey
    ? new Stripe(config.stripe.secretKey, {
        apiVersion: '2023-10-16',
        typescript: true,
    })
    : null;

function requireStripe(): Stripe {
    if (!stripe) {
        throw new Error('Stripe is not configured. Please add STRIPE_SECRET_KEY to environment variables.');
    }
    return stripe;
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

        const session = await s.checkout.sessions.create({
            customer_email: userEmail,
            client_reference_id: userId,
            mode: 'subscription',
            ui_mode: 'embedded',
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
            return_url: returnUrl,
            subscription_data: subscriptionData,
            metadata: {
                userId,
                planId,
            },
        });

        return session;
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
        const customer = await s.customers.create({
            email,
            metadata: { userId },
        });
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
            expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
        };

        if (params.trialDays > 0) {
            subscriptionParams.trial_period_days = params.trialDays;
        } else {
            subscriptionParams.payment_behavior = 'default_incomplete';
        }

        const subscription = await s.subscriptions.create(subscriptionParams);

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
        const paymentIntent = (invoice?.payment_intent as Stripe.PaymentIntent | null);
        if (!paymentIntent?.client_secret) {
            throw new Error(`Stripe payment intent missing client_secret for subscription ${subscription.id}`);
        }
        return {
            subscriptionId: subscription.id,
            clientSecret: paymentIntent.client_secret,
            type: 'payment',
        };
    }

    /**
     * Retrieve a Checkout Session by ID (for checking completion status)
     */
    async getCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
        return requireStripe().checkout.sessions.retrieve(sessionId);
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
        return s.subscriptions.update(subscriptionId, {
            items: [{ id: itemId, price: newPriceId }],
            proration_behavior: 'create_prorations',
            metadata: current.metadata,
        });
    }

    /**
     * Issue a refund against a charge or payment intent.
     */
    async refund(params: { chargeId?: string; paymentIntentId?: string; reason?: string; metadata?: Record<string, string> }): Promise<Stripe.Refund> {
        const s = requireStripe();
        return s.refunds.create({
            charge: params.chargeId,
            payment_intent: params.paymentIntentId,
            metadata: params.metadata,
        });
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
