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
     * Create a billing portal session
     */
    async createBillingPortalSession(
        customerId: string,
        returnUrl: string
    ): Promise<Stripe.BillingPortal.Session> {
        return requireStripe().billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl,
        });
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
