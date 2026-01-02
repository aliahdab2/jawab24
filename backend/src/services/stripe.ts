import Stripe from 'stripe';
import { config } from '../config';

// Initialize Stripe only if keys are provided (optional for preview)
export const stripe = config.stripe?.secretKey 
    ? new Stripe(config.stripe.secretKey, {
        apiVersion: '2024-12-18.acacia',
        typescript: true,
    })
    : null;

export class StripeService {
    /**
     * Create a Stripe Checkout Session for subscription
     */
    async createCheckoutSession(
        userId: string,
        userEmail: string,
        planId: string,
        priceId: string,
        successUrl: string,
        cancelUrl: string
    ): Promise<Stripe.Checkout.Session> {
        if (!stripe) {
            throw new Error('Stripe is not configured. Please add STRIPE_SECRET_KEY to environment variables.');
        }
        
        const session = await stripe.checkout.sessions.create({
            customer_email: userEmail,
            client_reference_id: userId,
            payment_method_types: ['card'],
            mode: 'subscription',
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            success_url: successUrl,
            cancel_url: cancelUrl,
            subscription_data: {
                metadata: {
                    userId,
                    planId,
                },
                trial_period_days: 7, // 7-day free trial
            },
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
        return await stripe.customers.retrieve(customerId) as Stripe.Customer;
    }

    /**
     * Get Stripe Subscription by ID
     */
    async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
        return await stripe.subscriptions.retrieve(subscriptionId);
    }

    /**
     * Cancel a subscription at period end
     */
    async cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
        return await stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true,
        });
    }

    /**
     * Resume a canceled subscription
     */
    async resumeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
        return await stripe.subscriptions.update(subscriptionId, {
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
        return await stripe.billingPortal.sessions.create({
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
        return stripe.webhooks.constructEvent(payload, signature, secret);
    }
}

export const stripeService = new StripeService();

