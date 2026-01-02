import { FastifyReply, FastifyRequest } from 'fastify';
import { stripeService } from '../services/stripe';
import { db } from '../db';
import { subscriptions, users, plans } from '../db/schema';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import type { CreateCheckoutSessionRequest, SubscriptionStatus } from '../types/payment';

export class PaymentController {
    /**
     * Create Stripe Checkout Session
     * POST /api/payment/create-checkout-session
     */
    async createCheckoutSession(
        request: FastifyRequest<{ Body: CreateCheckoutSessionRequest }>,
        reply: FastifyReply
    ) {
        try {
            const userId = (request.user as any)?.id;
            if (!userId) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            const { planId, successUrl, cancelUrl } = request.body;

            if (!planId) {
                return reply.status(400).send({ error: 'Plan ID is required' });
            }

            // Get user
            const [user] = await db.select().from(users).where(eq(users.id, userId));
            if (!user || !user.email) {
                return reply.status(404).send({ error: 'User not found or email missing' });
            }

            // Get plan
            const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
            if (!plan) {
                return reply.status(404).send({ error: 'Plan not found' });
            }

            if (!plan.stripePriceId) {
                return reply.status(400).send({ error: 'Plan does not have a Stripe Price ID configured' });
            }

            // Create checkout session
            const session = await stripeService.createCheckoutSession(
                userId,
                user.email,
                planId,
                plan.stripePriceId,
                successUrl || `${config.frontendUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
                cancelUrl || `${config.frontendUrl}/payment/cancel`
            );

            return reply.send({
                sessionId: session.id,
                url: session.url,
            });
        } catch (error) {
            request.log.error('Create checkout session error:', error);
            return reply.status(500).send({ error: 'Failed to create checkout session' });
        }
    }

    /**
     * Get current subscription status
     * GET /api/payment/subscription-status
     */
    async getSubscriptionStatus(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = (request.user as any)?.id;
            if (!userId) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            // Get active subscription
            const [subscription] = await db
                .select({
                    id: subscriptions.id,
                    status: subscriptions.status,
                    planId: subscriptions.planId,
                    planName: plans.name,
                    currentPeriodStart: subscriptions.currentPeriodStart,
                    currentPeriodEnd: subscriptions.currentPeriodEnd,
                    cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
                    trialEndsAt: subscriptions.trialEndsAt,
                })
                .from(subscriptions)
                .innerJoin(plans, eq(subscriptions.planId, plans.id))
                .where(eq(subscriptions.userId, userId))
                .orderBy(subscriptions.createdAt)
                .limit(1);

            if (!subscription) {
                return reply.status(404).send({ error: 'No subscription found' });
            }

            const response: SubscriptionStatus = {
                id: subscription.id,
                status: subscription.status as any,
                planId: subscription.planId,
                planName: subscription.planName,
                currentPeriodStart: subscription.currentPeriodStart!,
                currentPeriodEnd: subscription.currentPeriodEnd!,
                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || false,
                trialEndsAt: subscription.trialEndsAt || undefined,
            };

            return reply.send(response);
        } catch (error) {
            request.log.error('Get subscription status error:', error);
            return reply.status(500).send({ error: 'Failed to get subscription status' });
        }
    }

    /**
     * Cancel subscription
     * POST /api/payment/cancel-subscription
     */
    async cancelSubscription(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = (request.user as any)?.id;
            if (!userId) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            // Get subscription
            const [subscription] = await db
                .select()
                .from(subscriptions)
                .where(eq(subscriptions.userId, userId))
                .limit(1);

            if (!subscription || !subscription.externalSubscriptionId) {
                return reply.status(404).send({ error: 'No active subscription found' });
            }

            // Cancel in Stripe
            await stripeService.cancelSubscription(subscription.externalSubscriptionId);

            // Update in database
            await db
                .update(subscriptions)
                .set({
                    cancelAtPeriodEnd: true,
                    updatedAt: new Date(),
                })
                .where(eq(subscriptions.id, subscription.id));

            return reply.send({ message: 'Subscription will be canceled at the end of the billing period' });
        } catch (error) {
            request.log.error('Cancel subscription error:', error);
            return reply.status(500).send({ error: 'Failed to cancel subscription' });
        }
    }

    /**
     * Create billing portal session
     * POST /api/payment/billing-portal
     */
    async createBillingPortalSession(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = (request.user as any)?.id;
            if (!userId) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            // Get subscription with Stripe customer ID
            const [subscription] = await db
                .select()
                .from(subscriptions)
                .where(eq(subscriptions.userId, userId))
                .limit(1);

            if (!subscription || !subscription.stripeCustomerId) {
                return reply.status(404).send({ error: 'No Stripe customer found' });
            }

            // Create billing portal session
            const session = await stripeService.createBillingPortalSession(
                subscription.stripeCustomerId,
                `${config.frontendUrl}/dashboard`
            );

            return reply.send({ url: session.url });
        } catch (error) {
            request.log.error('Create billing portal session error:', error);
            return reply.status(500).send({ error: 'Failed to create billing portal session' });
        }
    }

    /**
     * Handle Stripe Webhooks
     * POST /api/payment/webhook
     */
    async handleWebhook(request: FastifyRequest, reply: FastifyReply) {
        try {
            const signature = request.headers['stripe-signature'];
            if (!signature || typeof signature !== 'string') {
                return reply.status(400).send({ error: 'Missing stripe-signature header' });
            }

            // Verify webhook signature
            const event = stripeService.verifyWebhookSignature(
                request.rawBody as Buffer,
                signature,
                config.stripe.webhookSecret
            );

            request.log.info(`Webhook received: ${event.type}`);

            // Handle different event types
            switch (event.type) {
                case 'checkout.session.completed':
                    await this.handleCheckoutComplete(event.data.object as any);
                    break;

                case 'customer.subscription.updated':
                    await this.handleSubscriptionUpdated(event.data.object as any);
                    break;

                case 'customer.subscription.deleted':
                    await this.handleSubscriptionDeleted(event.data.object as any);
                    break;

                case 'invoice.payment_succeeded':
                    await this.handlePaymentSucceeded(event.data.object as any);
                    break;

                case 'invoice.payment_failed':
                    await this.handlePaymentFailed(event.data.object as any);
                    break;

                default:
                    request.log.info(`Unhandled event type: ${event.type}`);
            }

            return reply.send({ received: true });
        } catch (error) {
            request.log.error('Webhook error:', error);
            return reply.status(400).send({ error: 'Webhook verification failed' });
        }
    }

    /**
     * Handle successful checkout session
     */
    private async handleCheckoutComplete(session: any) {
        const userId = session.client_reference_id || session.metadata?.userId;
        const planId = session.metadata?.planId;
        const stripeSubscriptionId = session.subscription;

        if (!userId || !planId) {
            console.error('Missing userId or planId in checkout session');
            return;
        }

        // Get subscription details from Stripe
        const stripeSubscription = await stripeService.getSubscription(stripeSubscriptionId);

        // Create or update subscription in database
        await db.insert(subscriptions).values({
            userId,
            planId,
            status: stripeSubscription.status as any,
            externalSubscriptionId: stripeSubscription.id,
            paymentMethod: 'stripe',
            stripeCustomerId: stripeSubscription.customer as string,
            stripeCheckoutSessionId: session.id,
            currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
            currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
            trialEndsAt: stripeSubscription.trial_end
                ? new Date(stripeSubscription.trial_end * 1000)
                : null,
        });

        console.log(`Subscription created for user ${userId}`);
    }

    /**
     * Handle subscription updated
     */
    private async handleSubscriptionUpdated(stripeSubscription: any) {
        await db
            .update(subscriptions)
            .set({
                status: stripeSubscription.status,
                currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
                currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
                cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.externalSubscriptionId, stripeSubscription.id));

        console.log(`Subscription updated: ${stripeSubscription.id}`);
    }

    /**
     * Handle subscription deleted
     */
    private async handleSubscriptionDeleted(stripeSubscription: any) {
        await db
            .update(subscriptions)
            .set({
                status: 'canceled',
                canceledAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.externalSubscriptionId, stripeSubscription.id));

        console.log(`Subscription canceled: ${stripeSubscription.id}`);
    }

    /**
     * Handle successful payment
     */
    private async handlePaymentSucceeded(invoice: any) {
        const stripeSubscriptionId = invoice.subscription;

        if (!stripeSubscriptionId) {
            return;
        }

        // Update subscription status
        await db
            .update(subscriptions)
            .set({
                status: 'active',
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.externalSubscriptionId, stripeSubscriptionId));

        console.log(`Payment succeeded for subscription: ${stripeSubscriptionId}`);
    }

    /**
     * Handle failed payment
     */
    private async handlePaymentFailed(invoice: any) {
        const stripeSubscriptionId = invoice.subscription;

        if (!stripeSubscriptionId) {
            return;
        }

        // Update subscription status
        await db
            .update(subscriptions)
            .set({
                status: 'past_due',
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.externalSubscriptionId, stripeSubscriptionId));

        console.log(`Payment failed for subscription: ${stripeSubscriptionId}`);
    }
}

export const paymentController = new PaymentController();

