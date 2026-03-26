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
