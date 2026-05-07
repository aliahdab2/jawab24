import { FastifyReply, FastifyRequest } from 'fastify';
import { stripeService, DemoUserStripeError } from '../services/stripe';
import { subscriptionsService } from '../services/subscriptions';
import { db } from '../db';
import { subscriptions, users, plans, settings, stripeWebhookEvents } from '../db/schema';
import { eq, desc, or } from 'drizzle-orm';
import { config } from '../config';
import { notificationService } from '../services/notifications';
import { emailService } from '../services/email';
import { subscriptionWelcomeEmailTemplate } from '../utils/emailTemplates';
import { captureError } from '../utils/sentryHelpers';
import type { CreateCheckoutSessionRequest, SubscriptionStatus } from '../types/payment';
import type Stripe from 'stripe';

// Type for authenticated requests
interface AuthenticatedRequest extends FastifyRequest {
    user?: { userId: string; isAdmin?: boolean };
}

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
            const userId = (request as AuthenticatedRequest).user?.userId;
            if (!userId) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            // SANCTIONS CHECK: Block payment processing for sanctioned jurisdictions
            const { isSanctionedGeo } = await import('../utils/sanctions');
            const { shouldBlockUnknownGeo } = await import('../middleware/geo');

            // Check if geo is sanctioned
            if (request.geo && isSanctionedGeo(request.geo)) {
                request.log.warn({
                    userId,
                    geo: request.geo,
                    route: '/payment/create-checkout-session',
                }, 'Payment blocked: sanctioned jurisdiction');

                return reply.status(403).send({
                    error: 'Payments are not available in your region',
                    code: 'SANCTIONED_GEO_BLOCK',
                });
            }

            // Safe-by-default: Block if geo is unknown/unreliable
            if (shouldBlockUnknownGeo(request.geo)) {
                request.log.warn({
                    userId,
                    geo: request.geo,
                    route: '/payment/create-checkout-session',
                }, 'Payment blocked: unknown geo (safe-by-default)');

                return reply.status(403).send({
                    error: 'Unable to process payment at this time',
                    code: 'GEO_VERIFICATION_REQUIRED',
                });
            }

            const { planId } = request.body;

            if (!planId) {
                return reply.status(400).send({ error: 'Plan ID is required' });
            }


            // Get user
            const [user] = await db.select().from(users).where(eq(users.id, userId));
            if (!user) {
                return reply.status(404).send({ error: 'User not found' });
            }

            if (!user.email) {
                return reply.status(400).send({
                    error: 'Email required',
                    message: 'Please add your email address to complete the purchase',
                    code: 'EMAIL_REQUIRED'
                });
            }

            // Get plan
            const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
            if (!plan) {
                return reply.status(404).send({ error: 'Plan not found' });
            }

            // Pick monthly or yearly Stripe price (validate input)
            const rawInterval = request.body.billingInterval;
            const billingInterval = rawInterval === 'year' ? 'year' : 'month';
            const stripePriceId = billingInterval === 'year' && plan.stripeYearlyPriceId
                ? plan.stripeYearlyPriceId
                : plan.stripePriceId;

            if (!stripePriceId) {
                return reply.status(400).send({ error: 'Plan does not have a Stripe Price ID configured' });
            }

            // Check if user already has an active/trialing subscription
            const existingSubscriptions = await db
                .select({
                    id: subscriptions.id,
                    status: subscriptions.status,
                    planId: subscriptions.planId,
                    externalSubscriptionId: subscriptions.externalSubscriptionId,
                })
                .from(subscriptions)
                .where(eq(subscriptions.userId, userId));

            const activeSubscription = existingSubscriptions.find(
                s => s.status === 'active' || s.status === 'trialing'
            );

            // Determine trial days:
            // - No trial if user already has ANY paid subscription (upgrading/downgrading)
            // - Use plan's trial_days only for completely new users
            let trialDays = 0;
            if (!activeSubscription && plan.trialDays && plan.trialDays > 0) {
                // New user on a plan with trial - give them the trial
                trialDays = plan.trialDays;
                request.log.info({ userId, planId, trialDays }, 'New user eligible for trial');
            } else if (activeSubscription) {
                // Existing subscriber - no trial (upgrade/downgrade)
                request.log.info(
                    { userId, planId, existingPlanId: activeSubscription.planId },
                    'Existing subscriber - no trial on plan change'
                );
            }

            // Build return URL server-side (no client-supplied URLs = no open-redirect risk)
            const returnUrl = `${config.frontendUrl}/payment/return?session_id={CHECKOUT_SESSION_ID}`;

            // Create embedded checkout session with appropriate trial.
            // Idempotency key for retry-safety is derived inside stripeService.
            const session = await stripeService.createCheckoutSession(
                userId,
                user.email,
                planId,
                stripePriceId,
                returnUrl,
                trialDays
            );

            return reply.send({
                sessionId: session.id,
                clientSecret: session.client_secret,
            });
        } catch (error) {
            if (error instanceof DemoUserStripeError) {
                return reply.status(403).send({ error: error.message, code: error.code });
            }
            request.log.error({ err: error }, 'Create checkout session error');
            return reply.status(500).send({ error: 'Failed to create checkout session' });
        }
    }

    /**
     * Create Subscription with PaymentElement support
     * POST /api/payment/create-subscription-intent
     * Returns clientSecret for PaymentIntent (no trial) or SetupIntent (trial)
     */
    async createSubscriptionIntent(
        request: FastifyRequest<{ Body: CreateCheckoutSessionRequest }>,
        reply: FastifyReply
    ) {
        try {
            const userId = (request as AuthenticatedRequest).user?.userId;
            if (!userId) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            // SANCTIONS CHECK
            const { isSanctionedGeo } = await import('../utils/sanctions');
            const { shouldBlockUnknownGeo } = await import('../middleware/geo');

            if (request.geo && isSanctionedGeo(request.geo)) {
                request.log.warn({ userId, geo: request.geo }, 'Payment blocked: sanctioned jurisdiction');
                return reply.status(403).send({ error: 'Payments are not available in your region', code: 'SANCTIONED_GEO_BLOCK' });
            }
            if (shouldBlockUnknownGeo(request.geo)) {
                request.log.warn({ userId, geo: request.geo }, 'Payment blocked: unknown geo');
                return reply.status(403).send({ error: 'Unable to process payment at this time', code: 'GEO_VERIFICATION_REQUIRED' });
            }

            const { planId } = request.body;
            if (!planId) {
                return reply.status(400).send({ error: 'Plan ID is required' });
            }

            // Get user
            const [user] = await db.select().from(users).where(eq(users.id, userId));
            if (!user) return reply.status(404).send({ error: 'User not found' });
            if (!user.email) {
                return reply.status(400).send({ error: 'Email required', message: 'Please add your email address to complete the purchase', code: 'EMAIL_REQUIRED' });
            }

            // Get plan
            const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
            if (!plan) return reply.status(404).send({ error: 'Plan not found' });

            const rawInterval = request.body.billingInterval;
            const billingInterval = rawInterval === 'year' ? 'year' : 'month';
            const stripePriceId = billingInterval === 'year' && plan.stripeYearlyPriceId
                ? plan.stripeYearlyPriceId
                : plan.stripePriceId;

            if (!stripePriceId) {
                return reply.status(400).send({ error: 'Plan does not have a Stripe Price ID configured' });
            }

            // Check existing subscriptions for trial eligibility
            const existingSubscriptions = await db
                .select({ id: subscriptions.id, status: subscriptions.status, planId: subscriptions.planId, stripeCustomerId: subscriptions.stripeCustomerId })
                .from(subscriptions)
                .where(eq(subscriptions.userId, userId));

            const activeSubscription = existingSubscriptions.find(s => s.status === 'active' || s.status === 'trialing');

            let trialDays = 0;
            if (!activeSubscription && plan.trialDays && plan.trialDays > 0) {
                trialDays = plan.trialDays;
                request.log.info({ userId, planId, trialDays }, 'New user eligible for trial');
            } else if (activeSubscription) {
                request.log.info({ userId, planId, existingPlanId: activeSubscription.planId }, 'Existing subscriber - no trial on plan change');
            }

            // Find or create Stripe Customer (check existing subscriptions first)
            let stripeCustomerId = existingSubscriptions.find(s => s.stripeCustomerId)?.stripeCustomerId;
            if (!stripeCustomerId) {
                stripeCustomerId = await stripeService.findOrCreateCustomer(user.email, userId);
            }

            // Create subscription with PaymentIntent or SetupIntent.
            // Idempotency key for retry-safety is derived inside stripeService.
            const result = await stripeService.createSubscriptionIntent({
                customerId: stripeCustomerId,
                priceId: stripePriceId,
                userId,
                planId,
                trialDays,
            });

            return reply.send({
                clientSecret: result.clientSecret,
                type: result.type,
                subscriptionId: result.subscriptionId,
            });
        } catch (error) {
            if (error instanceof DemoUserStripeError) {
                return reply.status(403).send({ error: error.message, code: error.code });
            }
            request.log.error({ err: error }, 'Create subscription intent error');
            return reply.status(500).send({ error: 'Failed to create subscription' });
        }
    }

    /**
     * Get checkout session status (for embedded checkout return page)
     * GET /api/payment/checkout-session-status?session_id=...
     */
    async getCheckoutSessionStatus(
        request: FastifyRequest<{ Querystring: { session_id: string } }>,
        reply: FastifyReply
    ) {
        try {
            const userId = (request as AuthenticatedRequest).user?.userId;
            if (!userId) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            const sessionId = request.query.session_id;
            if (!sessionId) {
                return reply.status(400).send({ error: 'session_id is required' });
            }

            const session = await stripeService.getCheckoutSession(sessionId);

            // Verify the session belongs to this user
            if (session.client_reference_id !== userId) {
                return reply.status(403).send({ error: 'Forbidden' });
            }

            return reply.send({
                status: session.status,
                paymentStatus: session.payment_status,
            });
        } catch (error) {
            request.log.error({ err: error }, 'Get checkout session status error');
            return reply.status(500).send({ error: 'Failed to retrieve session status' });
        }
    }

    /**
     * Get current subscription status
     * GET /api/payment/subscription-status
     */
    async getSubscriptionStatus(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = (request as AuthenticatedRequest).user?.userId;
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
                .orderBy(
                    subscriptionsService.PRIORITY_SQL,
                    desc(subscriptions.createdAt)
                )
                .limit(1);

            if (!subscription) {
                return reply.status(404).send({ error: 'No subscription found' });
            }

            if (!subscription.currentPeriodStart || !subscription.currentPeriodEnd) {
                return reply.status(500).send({ error: 'Invalid subscription period data' });
            }

            const response: SubscriptionStatus = {
                id: subscription.id,
                status: subscription.status as SubscriptionStatus['status'],
                planId: subscription.planId,
                planName: subscription.planName,
                currentPeriodStart: subscription.currentPeriodStart,
                currentPeriodEnd: subscription.currentPeriodEnd,
                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || false,
                trialEndsAt: subscription.trialEndsAt || undefined,
            };

            return reply.send(response);
        } catch (error) {
            request.log.error({ err: error }, 'Get subscription status error');
            return reply.status(500).send({ error: 'Failed to get subscription status' });
        }
    }

    /**
     * Change plan on an existing Stripe-backed subscription with proration.
     * POST /api/payment/change-plan
     *
     * Used for upgrade/downgrade when the user already has an active Stripe
     * subscription. Calls stripe.subscriptions.update with proration so the
     * customer is credited for unused time on the old plan and charged a
     * prorated amount for the new plan on the next invoice — instead of
     * paying full price for a brand-new subscription period.
     *
     * Users without a Stripe-backed subscription (no externalSubscriptionId)
     * must use the checkout flow instead and get a 400 here.
     */
    async changePlan(
        request: FastifyRequest<{ Body: { planId: string; billingInterval?: 'month' | 'year' } }>,
        reply: FastifyReply
    ) {
        try {
            const userId = (request as AuthenticatedRequest).user?.userId;
            if (!userId) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            const { planId } = request.body;
            const billingInterval = request.body.billingInterval === 'year' ? 'year' : 'month';
            if (!planId) {
                return reply.status(400).send({ error: 'Plan ID is required' });
            }

            const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
            if (!plan) {
                return reply.status(404).send({ error: 'Plan not found' });
            }

            const newPriceId = billingInterval === 'year' && plan.stripeYearlyPriceId
                ? plan.stripeYearlyPriceId
                : plan.stripePriceId;
            if (!newPriceId) {
                return reply.status(400).send({ error: 'Plan does not have a Stripe Price ID configured' });
            }

            // Pick the user's active Stripe-backed subscription. The resolver
            // already prioritizes active/trialing rows, but we need the row
            // with an externalSubscriptionId — manual rows can't be updated.
            const userSubs = await db
                .select()
                .from(subscriptions)
                .where(eq(subscriptions.userId, userId))
                .orderBy(desc(subscriptions.createdAt));

            const activeStripeSub = userSubs.find(
                (s): s is typeof s & { externalSubscriptionId: string } =>
                    (s.status === 'active' || s.status === 'trialing') && Boolean(s.externalSubscriptionId)
            );

            if (!activeStripeSub) {
                return reply.status(400).send({
                    error: 'No active Stripe subscription to update',
                    code: 'NO_STRIPE_SUBSCRIPTION',
                    message: 'Use the checkout flow to start a new subscription.',
                });
            }

            if (activeStripeSub.planId === planId) {
                return reply.status(400).send({ error: 'Already on this plan', code: 'SAME_PLAN' });
            }

            const updated = await stripeService.updateSubscriptionPrice(
                activeStripeSub.externalSubscriptionId,
                newPriceId
            );

            // Best-effort local mirror — the subscription.updated webhook is
            // authoritative and will re-write these fields, but updating now
            // means the UI reflects the change without waiting for the event.
            await db
                .update(subscriptions)
                .set({
                    planId,
                    status: updated.status,
                    currentPeriodStart: new Date(updated.current_period_start * 1000),
                    currentPeriodEnd: new Date(updated.current_period_end * 1000),
                    cancelAtPeriodEnd: updated.cancel_at_period_end,
                    updatedAt: new Date(),
                })
                .where(eq(subscriptions.id, activeStripeSub.id));

            await subscriptionsService.invalidateStatusCache(userId);

            request.log.info(
                { userId, oldPlanId: activeStripeSub.planId, newPlanId: planId, subId: updated.id },
                'Plan changed via stripe.subscriptions.update'
            );

            return reply.send({
                success: true,
                message: 'Plan updated. Charges and credits are prorated automatically.',
            });
        } catch (error) {
            request.log.error({ err: error }, 'Change plan error');
            return reply.status(500).send({ error: 'Failed to change plan' });
        }
    }

    /**
     * Cancel subscription
     * POST /api/payment/cancel-subscription
     */
    async cancelSubscription(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = (request as AuthenticatedRequest).user?.userId;
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

            await subscriptionsService.invalidateStatusCache(userId);
            return reply.send({ message: 'Subscription will be canceled at the end of the billing period' });
        } catch (error) {
            request.log.error({ err: error }, 'Cancel subscription error');
            return reply.status(500).send({ error: 'Failed to cancel subscription' });
        }
    }

    /**
     * Create billing portal session
     * POST /api/payment/billing-portal
     */
    async createBillingPortalSession(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = (request as AuthenticatedRequest).user?.userId;
            if (!userId) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            // SANCTIONS CHECK: Block billing portal access for sanctioned jurisdictions
            const { isSanctionedGeo } = await import('../utils/sanctions');
            const { shouldBlockUnknownGeo } = await import('../middleware/geo');

            if (request.geo && isSanctionedGeo(request.geo)) {
                request.log.warn({
                    userId,
                    geo: request.geo,
                    route: '/payment/billing-portal',
                }, 'Billing portal blocked: sanctioned jurisdiction');

                return reply.status(403).send({
                    error: 'Payments are not available in your region',
                    code: 'SANCTIONED_GEO_BLOCK',
                });
            }

            if (shouldBlockUnknownGeo(request.geo)) {
                request.log.warn({
                    userId,
                    geo: request.geo,
                    route: '/payment/billing-portal',
                }, 'Billing portal blocked: unknown geo');

                return reply.status(403).send({
                    error: 'Unable to process payment at this time',
                    code: 'GEO_VERIFICATION_REQUIRED',
                });
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
            request.log.error({ err: error }, 'Create billing portal session error');
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

            // Get raw body - Fastify stores it in rawBody when configured
            const rawBody = request.rawBody;
            if (!rawBody) {
                return reply.status(400).send({ error: 'Missing raw body' });
            }

            // Verify webhook signature
            const event = stripeService.verifyWebhookSignature(
                rawBody,
                signature,
                config.stripe.webhookSecret
            );

            request.log.info(`Webhook received: ${event.type}`);

            // Idempotency: skip already-processed events (Stripe retries on network timeout)
            const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
            const inserted = await db
                .insert(stripeWebhookEvents)
                .values({ eventId: event.id, eventType: event.type, status: 'processing' })
                .onConflictDoNothing()
                .returning({ eventId: stripeWebhookEvents.eventId });

            if (inserted.length === 0) {
                // Event exists — check if completed or stale processing
                const [existing] = await db
                    .select({ status: stripeWebhookEvents.status, processedAt: stripeWebhookEvents.processedAt })
                    .from(stripeWebhookEvents)
                    .where(eq(stripeWebhookEvents.eventId, event.id));

                if (existing?.status === 'completed') {
                    request.log.info({ eventId: event.id }, 'Duplicate webhook event (completed), skipping');
                    return reply.send({ received: true });
                }

                // Still processing — allow retry only if stale (handler likely crashed)
                const isStale = existing && (Date.now() - existing.processedAt.getTime()) > STALE_THRESHOLD_MS;
                if (!isStale) {
                    request.log.info({ eventId: event.id }, 'Webhook event currently processing, skipping');
                    return reply.send({ received: true });
                }

                request.log.warn({ eventId: event.id }, 'Retrying stale webhook event');
                await db.update(stripeWebhookEvents)
                    .set({ status: 'processing', processedAt: new Date() })
                    .where(eq(stripeWebhookEvents.eventId, event.id));
            }

            // Handle different event types
            try {
                switch (event.type) {
                    case 'checkout.session.completed':
                        await this.handleCheckoutComplete(
                            event.data.object as Stripe.Checkout.Session,
                            request
                        );
                        break;

                    case 'customer.subscription.created':
                        await this.handleSubscriptionCreated(
                            event.data.object as Stripe.Subscription,
                            request
                        );
                        break;

                    case 'customer.subscription.updated':
                        await this.handleSubscriptionUpdated(
                            event.data.object as Stripe.Subscription,
                            request
                        );
                        break;

                    case 'customer.subscription.deleted':
                        await this.handleSubscriptionDeleted(
                            event.data.object as Stripe.Subscription,
                            request
                        );
                        break;

                    case 'invoice.payment_succeeded':
                        await this.handlePaymentSucceeded(
                            event.data.object as Stripe.Invoice,
                            request
                        );
                        break;

                    case 'invoice.payment_failed':
                        await this.handlePaymentFailed(
                            event.data.object as Stripe.Invoice,
                            request
                        );
                        break;

                    case 'charge.refunded':
                        await this.handleChargeRefunded(
                            event.data.object as Stripe.Charge,
                            request
                        );
                        break;

                    default:
                        request.log.info({ eventType: event.type }, 'Unhandled webhook event type');
                }

                // Mark event as completed after successful processing
                await db.update(stripeWebhookEvents)
                    .set({ status: 'completed', processedAt: new Date() })
                    .where(eq(stripeWebhookEvents.eventId, event.id));
            } catch (handlerError) {
                // Leave status as 'processing' so Stripe retry can re-attempt.
                // Return 5xx so Stripe schedules a retry — 4xx is treated as permanent and the event would be silently dropped.
                captureError(handlerError, 'Stripe webhook handler failed', {
                    tags: { eventType: event.type },
                    extra: { eventId: event.id },
                });
                request.log.error({ err: handlerError, eventId: event.id, eventType: event.type }, 'Webhook handler failed, event left as processing for retry');
                return reply.status(500).send({ error: 'Webhook handler failed' });
            }

            return reply.send({ received: true });
        } catch (error) {
            // Reaches here only for signature verification / raw-body / idempotency-lookup errors.
            // 400 is correct for signature failures (Stripe should not retry an invalid signature).
            request.log.error({ err: error }, 'Webhook signature verification failed');
            return reply.status(400).send({ error: 'Webhook verification failed' });
        }
    }

    /**
     * Handle successful checkout session
     */
    private async handleCheckoutComplete(
        session: Stripe.Checkout.Session,
        request: FastifyRequest
    ) {
        const userId = session.client_reference_id || session.metadata?.userId;
        const planId = session.metadata?.planId;
        const stripeSubscriptionId = session.subscription as string;

        if (!userId || !planId) {
            request.log.error({ session: session.id }, 'Missing userId or planId in checkout session');
            return;
        }

        // Get subscription details from Stripe
        const stripeSubscription = await stripeService.getSubscription(stripeSubscriptionId);

        // Cancel any existing active/trialing subscriptions for this user
        // This ensures only one subscription per user (upgrade/downgrade replaces old one)
        const existingSubscriptions = await db
            .select({
                id: subscriptions.id,
                status: subscriptions.status,
                externalSubscriptionId: subscriptions.externalSubscriptionId,
            })
            .from(subscriptions)
            .where(eq(subscriptions.userId, userId));

        for (const oldSub of existingSubscriptions) {
            if (oldSub.status === 'active' || oldSub.status === 'trialing') {
                // Cancel in Stripe if it has an external ID (and it's not the new subscription)
                if (oldSub.externalSubscriptionId && oldSub.externalSubscriptionId !== stripeSubscription.id) {
                    try {
                        await stripeService.cancelSubscriptionImmediately(oldSub.externalSubscriptionId);
                        request.log.info(
                            { oldSubscriptionId: oldSub.externalSubscriptionId },
                            'Canceled old Stripe subscription'
                        );
                    } catch (err) {
                        request.log.warn(
                            { err, oldSubscriptionId: oldSub.externalSubscriptionId },
                            'Failed to cancel old Stripe subscription (may already be canceled)'
                        );
                    }
                }

                // Mark as canceled in database
                await db
                    .update(subscriptions)
                    .set({
                        status: 'canceled',
                        canceledAt: new Date(),
                        cancelReason: 'Replaced by new subscription',
                        updatedAt: new Date(),
                    })
                    .where(eq(subscriptions.id, oldSub.id));

                request.log.info({ oldSubscriptionId: oldSub.id }, 'Marked old subscription as canceled');
            }
        }

        // Create new subscription in database. .returning() lets us scope the
        // welcome email to genuinely-new rows (replayed webhooks won't double-send
        // because Stripe deduplicates events upstream and we only reach this
        // branch when no row with this externalSubscriptionId exists yet).
        const [insertedSub] = await db.insert(subscriptions).values({
            userId,
            planId,
            status: stripeSubscription.status,
            externalSubscriptionId: stripeSubscription.id,
            paymentMethod: 'stripe',
            stripeCustomerId: stripeSubscription.customer as string,
            stripeCheckoutSessionId: session.id,
            currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
            currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
            trialEndsAt: stripeSubscription.trial_end
                ? new Date(stripeSubscription.trial_end * 1000)
                : null,
        }).returning({ id: subscriptions.id });

        request.log.info({ userId, subscriptionId: stripeSubscription.id, planId }, 'New subscription created');

        // Drop cached status so the new sub is visible immediately to the
        // reply pipeline (and so the previous orphan-canceled state isn't
        // returned for up to 60s after the new row lands).
        await subscriptionsService.invalidateStatusCache(userId);

        // Send branded welcome email. Stripe sends the VAT-compliant invoice
        // separately. Email failure must NOT break the webhook (subscription
        // is already persisted); log to Sentry and move on.
        if (insertedSub) {
            await this.sendSubscriptionWelcomeEmail(userId, planId, stripeSubscription, request);
        }
    }

    /**
     * Best-effort welcome email after a new subscription is created. Resolves
     * the user's preferred language from `settings.dashboardLanguage` (the same
     * source the dashboard uses), with 'ar' as the fallback. Never throws.
     */
    private async sendSubscriptionWelcomeEmail(
        userId: string,
        planId: string,
        stripeSubscription: Stripe.Subscription,
        request: FastifyRequest
    ): Promise<void> {
        try {
            const [user] = await db.select().from(users).where(eq(users.id, userId));
            if (!user?.email) {
                request.log.info({ userId }, 'Skipping welcome email — user has no email on file');
                return;
            }

            const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
            const [userSettings] = await db.select({ dashboardLanguage: settings.dashboardLanguage })
                .from(settings)
                .where(eq(settings.userId, userId));

            const lang: 'ar' | 'en' = userSettings?.dashboardLanguage === 'en' ? 'en' : 'ar';
            const planName = plan?.name || 'Jawab24';
            const trialEndsAt = stripeSubscription.trial_end
                ? new Date(stripeSubscription.trial_end * 1000)
                : null;

            const { subject, html } = subscriptionWelcomeEmailTemplate({
                lang,
                name: user.name || user.email.split('@')[0],
                planName,
                dashboardUrl: `${config.frontendUrl}/dashboard`,
                trialEndsAt,
            });

            const result = await emailService.send({
                to: user.email,
                subject,
                html,
                type: 'subscription_welcome',
                userId,
            });

            if (!result.success) {
                request.log.warn({ userId, error: result.error }, 'Welcome email send returned failure');
            } else {
                request.log.info({ userId, emailSendId: result.emailSendId }, 'Subscription welcome email sent');
            }
        } catch (err) {
            captureError(err, 'Subscription welcome email failed', {
                tags: { service: 'payment', flow: 'welcome_email' },
                extra: { userId, planId },
            });
        }
    }

    /**
     * Handle subscription created - backup handler in case checkout event missed it
     */
    private async handleSubscriptionCreated(
        stripeSubscription: Stripe.Subscription,
        request: FastifyRequest
    ) {
        // Check if subscription already exists
        const existing = await db
            .select({ id: subscriptions.id, status: subscriptions.status })
            .from(subscriptions)
            .where(eq(subscriptions.externalSubscriptionId, stripeSubscription.id))
            .limit(1);

        if (existing.length > 0) {
            // Subscription exists, update status if needed
            const currentStatus = existing[0].status;
            const newStatus = stripeSubscription.status;

            // If subscription is active in Stripe but not in DB, update it
            if (newStatus === 'active' && currentStatus !== 'active') {
                await db
                    .update(subscriptions)
                    .set({
                        status: 'active',
                        updatedAt: new Date(),
                    })
                    .where(eq(subscriptions.id, existing[0].id));

                request.log.info(
                    { subscriptionId: stripeSubscription.id, oldStatus: currentStatus },
                    'Subscription status corrected to active'
                );
            } else {
                request.log.info(
                    { subscriptionId: stripeSubscription.id, status: currentStatus },
                    'Subscription already exists'
                );
            }
        } else {
            request.log.warn(
                { subscriptionId: stripeSubscription.id },
                'Subscription created event received but no matching DB record found'
            );
        }
    }

    /**
     * Handle subscription updated
     */
    private async handleSubscriptionUpdated(
        stripeSubscription: Stripe.Subscription,
        request: FastifyRequest
    ) {
        // If the subscription's price changed (plan switch via stripe.subscriptions.update),
        // resolve the new planId from our `plans` table by stripePriceId so the DB
        // mirrors what the customer is now paying for.
        const priceId = stripeSubscription.items?.data?.[0]?.price?.id;
        let resolvedPlanId: string | null = null;
        if (priceId) {
            const [planRow] = await db
                .select({ id: plans.id })
                .from(plans)
                .where(or(eq(plans.stripePriceId, priceId), eq(plans.stripeYearlyPriceId, priceId)))
                .limit(1);
            if (planRow) {
                resolvedPlanId = planRow.id;
            } else {
                request.log.warn({ subscriptionId: stripeSubscription.id, priceId }, 'No matching plan for Stripe price');
            }
        }

        const updateValues: Partial<typeof subscriptions.$inferInsert> = {
            status: stripeSubscription.status,
            currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
            currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
            cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
            updatedAt: new Date(),
        };
        if (resolvedPlanId) {
            updateValues.planId = resolvedPlanId;
        }

        const result = await db
            .update(subscriptions)
            .set(updateValues)
            .where(eq(subscriptions.externalSubscriptionId, stripeSubscription.id))
            .returning({ id: subscriptions.id, userId: subscriptions.userId });

        if (result.length > 0) {
            await subscriptionsService.invalidateStatusCache(result[0].userId);
            request.log.info(
                { subscriptionId: stripeSubscription.id, status: stripeSubscription.status, planId: resolvedPlanId },
                'Subscription updated'
            );
        } else {
            request.log.warn({ subscriptionId: stripeSubscription.id }, 'Subscription update - no matching record found');
        }
    }

    /**
     * Handle subscription deleted
     */
    private async handleSubscriptionDeleted(
        stripeSubscription: Stripe.Subscription,
        request: FastifyRequest
    ) {
        const result = await db
            .update(subscriptions)
            .set({
                status: 'canceled',
                canceledAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.externalSubscriptionId, stripeSubscription.id))
            .returning({ userId: subscriptions.userId });

        if (result.length > 0) {
            await subscriptionsService.invalidateStatusCache(result[0].userId);
        }
        request.log.info({ subscriptionId: stripeSubscription.id }, 'Subscription canceled');
    }

    /**
     * Handle successful payment
     */
    private async handlePaymentSucceeded(invoice: Stripe.Invoice, request: FastifyRequest) {
        const stripeSubscriptionId = invoice.subscription as string;

        if (!stripeSubscriptionId) {
            request.log.warn({ invoiceId: invoice.id }, 'Invoice has no subscription ID');
            return;
        }

        // Pull the latest period boundaries from Stripe so DB matches Stripe's truth.
        // On renewal Stripe advances current_period_start/end; we must mirror that
        // and reset quota — otherwise the previous period's usage row keeps blocking.
        const stripeSubscription = await stripeService.getSubscription(stripeSubscriptionId);
        const periodStart = new Date(stripeSubscription.current_period_start * 1000);
        const periodEnd = new Date(stripeSubscription.current_period_end * 1000);

        // Update subscription status with retry logic for race conditions
        let retries = 3;
        let updatedRow: { id: string; userId: string } | null = null;

        while (retries > 0 && !updatedRow) {
            const result = await db
                .update(subscriptions)
                .set({
                    status: 'active',
                    currentPeriodStart: periodStart,
                    currentPeriodEnd: periodEnd,
                    updatedAt: new Date(),
                })
                .where(eq(subscriptions.externalSubscriptionId, stripeSubscriptionId))
                .returning({ id: subscriptions.id, userId: subscriptions.userId });

            if (result.length > 0) {
                updatedRow = result[0];
                request.log.info(
                    { subscriptionId: stripeSubscriptionId, dbId: updatedRow.id },
                    'Payment succeeded - subscription activated'
                );
            } else {
                retries--;
                if (retries > 0) {
                    request.log.warn(
                        { subscriptionId: stripeSubscriptionId, retriesLeft: retries },
                        'Subscription not found, retrying...'
                    );
                    // Wait 500ms before retry (subscription might still be inserting)
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }

        if (!updatedRow) {
            request.log.error(
                { subscriptionId: stripeSubscriptionId },
                'Failed to activate subscription - not found after retries'
            );
            return;
        }

        // Reset quota for the new billing period.
        await subscriptionsService.initializeUsagePeriod(updatedRow.userId, periodStart, periodEnd);

        // Drop the boolean status cache so a `past_due → active` recovery is
        // visible to the reply pipeline immediately, not after a 60s TTL.
        await subscriptionsService.invalidateStatusCache(updatedRow.userId);
    }

    /**
     * Handle failed payment
     */
    private async handlePaymentFailed(invoice: Stripe.Invoice, request: FastifyRequest) {
        const stripeSubscriptionId = invoice.subscription as string;

        if (!stripeSubscriptionId) {
            return;
        }

        // Update subscription status and get userId
        const result = await db
            .update(subscriptions)
            .set({
                status: 'past_due',
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.externalSubscriptionId, stripeSubscriptionId))
            .returning({ userId: subscriptions.userId });

        request.log.info({ subscriptionId: stripeSubscriptionId }, 'Payment failed');

        // Notify user about failed payment
        if (result.length > 0) {
            await subscriptionsService.invalidateStatusCache(result[0].userId);
            notificationService.sendTemplateNotification(
                result[0].userId,
                'payment_failed',
                {},
                { deepLink: '/settings' }
            ).catch(err => request.log.error({ err }, 'Failed to send payment_failed notification'));
        }
    }

    /**
     * Handle a refund issued in Stripe (manually via Dashboard or via the
     * refund-charge.ts admin script). We log it and notify the customer.
     * Refund alone does NOT cancel the subscription — that comes through a
     * separate `customer.subscription.deleted` event if applicable.
     */
    private async handleChargeRefunded(charge: Stripe.Charge, request: FastifyRequest) {
        const stripeCustomerId = typeof charge.customer === 'string'
            ? charge.customer
            : charge.customer?.id;

        if (!stripeCustomerId) {
            request.log.warn({ chargeId: charge.id }, 'Refunded charge has no customer ID');
            return;
        }

        const [sub] = await db
            .select({ userId: subscriptions.userId })
            .from(subscriptions)
            .where(eq(subscriptions.stripeCustomerId, stripeCustomerId))
            .orderBy(desc(subscriptions.createdAt))
            .limit(1);

        if (!sub) {
            request.log.warn({ chargeId: charge.id, stripeCustomerId }, 'No subscription matched refunded charge');
            return;
        }

        request.log.info(
            {
                chargeId: charge.id,
                userId: sub.userId,
                amountRefunded: charge.amount_refunded,
                currency: charge.currency,
            },
            'Charge refunded'
        );

        // Best-effort notification. Failure must not break the webhook.
        notificationService.sendTemplateNotification(
            sub.userId,
            'refund_processed',
            {
                amount: (charge.amount_refunded / 100).toFixed(2),
                currency: charge.currency.toUpperCase(),
            },
            { deepLink: '/settings' }
        ).catch(err => request.log.error({ err, chargeId: charge.id }, 'Failed to send refund_processed notification'));
    }
}

export const paymentController = new PaymentController();
