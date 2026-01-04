import Stripe from 'stripe';
import { config } from '../config';

// Initialize Stripe only if keys are provided (optional for preview)
export const stripe = config.stripe?.secretKey
    ? new Stripe(config.stripe.secretKey, {
        apiVersion: '2023-10-16',
        typescript: true,
    })
    : null;

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
        successUrl: string,
        cancelUrl: string,
        trialDays: number = 0
    ): Promise<Stripe.Checkout.Session> {
        if (!stripe) {
            throw new Error('Stripe is not configured. Please add STRIPE_SECRET_KEY to environment variables.');
        }

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

        const session = await stripe.checkout.sessions.create({
            customer_email: userEmail,
            client_reference_id: userId,
            payment_method_types: ['card'],
            mode: 'subscription',
            payment_method_collection: 'if_required',
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            success_url: successUrl,
            cancel_url: cancelUrl,
            subscription_data: subscriptionData,
            metadata: {
                userId,
                planId,
            },
        });

        return session;
    }

    /**
     * Get Stripe Customer by ID
     */
    async getCustomer(customerId: string): Promise<Stripe.Customer> {
        if (!stripe) {
            throw new Error('Stripe is not configured.');
        }
        return await stripe.customers.retrieve(customerId) as Stripe.Customer;
    }

    /**
     * Get Stripe Subscription by ID
     */
    async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
        if (!stripe) {
            throw new Error('Stripe is not configured.');
        }
        return stripe.subscriptions.retrieve(subscriptionId);
    }

    /**
     * Cancel a subscription at period end (user-initiated cancellation)
     */
    async cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
        if (!stripe) {
            throw new Error('Stripe is not configured.');
        }
        return stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true,
        });
    }

    /**
     * Cancel a subscription immediately (for plan changes/upgrades)
     */
    async cancelSubscriptionImmediately(subscriptionId: string): Promise<Stripe.Subscription> {
        if (!stripe) {
            throw new Error('Stripe is not configured.');
        }
        return stripe.subscriptions.cancel(subscriptionId);
    }

    /**
     * Resume a canceled subscription
     */
    async resumeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
        if (!stripe) {
            throw new Error('Stripe is not configured.');
        }
        return stripe.subscriptions.update(subscriptionId, {
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
        if (!stripe) {
            throw new Error('Stripe is not configured.');
        }
        return stripe.billingPortal.sessions.create({
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
        if (!stripe) {
            throw new Error('Stripe is not configured.');
        }
        return stripe.webhooks.constructEvent(payload, signature, secret);
    }
}

export const stripeService = new StripeService();
