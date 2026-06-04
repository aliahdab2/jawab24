import { FastifyReply, FastifyRequest } from 'fastify';
import { stripeService, stripeRefId, DemoUserStripeError } from '../services/stripe';
import { paymentRequestService } from '../services/paymentRequest';
import { subscriptionsService } from '../services/subscriptions';
import { topupService, UnknownTopupPackError, type TopupPack } from '../services/topup';
import { db } from '../db';
import { subscriptions, users, plans, settings, stripeWebhookEvents } from '../db/schema';
import { eq, desc, or } from 'drizzle-orm';
import { config } from '../config';
import { notificationService } from '../services/notifications';
import { emailService } from '../services/email';
import { subscriptionWelcomeEmailTemplate } from '../utils/emailTemplates';
import { captureError } from '../utils/sentryHelpers';
import { isSanctionedGeo } from '../utils/sanctions';
import { shouldBlockUnknownGeo } from '../middleware/geo';
import type { CreateCheckoutSessionRequest, SubscriptionStatus } from '../types/payment';
import type Stripe from 'stripe';

// Type for authenticated requests
interface AuthenticatedRequest extends FastifyRequest {
    user?: { userId: string; isAdmin?: boolean };
}

/**
 * Convert a Stripe Unix timestamp (seconds) to a Date, or null if the value is
 * missing/invalid. Stripe occasionally sends null for `current_period_*` and
 * `trial_end` (e.g. paused subscriptions, or when a subscription item drives
 * the period in newer API versions). Passing those to `new Date()` yields an
 * Invalid Date, which Drizzle's timestamp encoder rejects with RangeError.
 */
function stripeTsToDate(ts: number | null | undefined): Date | null {
    if (ts === null || ts === undefined) return null;
    const ms = ts * 1000;
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
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
     * Create a one-time PaymentIntent for a Credit top-up pack (self-service
     * card payment). Returns clientSecret for the modal's Stripe PaymentElement.
     * POST /api/payment/create-topup-intent
     *
     * Mirrors createSubscriptionIntent: identical sanctions gate, same
     * find-or-reuse Stripe customer, same demo-user block. A `pending` row is
     * recorded now; the balance is credited only when payment_intent.succeeded
     * arrives (see handleTopupPaymentSucceeded).
     */
    async createTopupIntent(
        request: FastifyRequest<{ Body: { pack?: string } }>,
        reply: FastifyReply
    ) {
        try {
            const userId = (request as AuthenticatedRequest).user?.userId;
            if (!userId) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            // KILL-SWITCH — authoritative gate. When top-up is disabled no
            // PaymentIntent is ever created, so charging is off the instant the
            // flag flips (env change + recreate), independent of any frontend.
            if (!config.topup.enabled) {
                return reply.status(403).send({ error: 'Top-ups are temporarily unavailable', code: 'TOPUP_DISABLED' });
            }

            // SANCTIONS CHECK — identical to createSubscriptionIntent. A Stripe
            // charge for a sanctioned jurisdiction is the same legal exposure
            // whether it's a subscription or a one-time top-up.
            if (request.geo && isSanctionedGeo(request.geo)) {
                request.log.warn({ userId, geo: request.geo }, 'Top-up blocked: sanctioned jurisdiction');
                return reply.status(403).send({ error: 'Payments are not available in your region', code: 'SANCTIONED_GEO_BLOCK' });
            }
            if (shouldBlockUnknownGeo(request.geo)) {
                request.log.warn({ userId, geo: request.geo }, 'Top-up blocked: unknown geo');
                return reply.status(403).send({ error: 'Unable to process payment at this time', code: 'GEO_VERIFICATION_REQUIRED' });
            }

            const pack = request.body.pack;
            const packConfig = pack ? config.topup.packs[pack as TopupPack] : undefined;
            if (!pack || !packConfig) {
                return reply.status(400).send({
                    error: 'Invalid top-up pack',
                    code: 'INVALID_PACK',
                    message: `Valid packs: ${Object.keys(config.topup.packs).join(', ')}`,
                });
            }

            const [user] = await db.select().from(users).where(eq(users.id, userId));
            if (!user) return reply.status(404).send({ error: 'User not found' });
            if (!user.email) {
                return reply.status(400).send({ error: 'Email required', message: 'Please add your email address to complete the purchase', code: 'EMAIL_REQUIRED' });
            }

            // Reuse the user's existing Stripe customer (from a subscription) so
            // top-ups and subscriptions share one customer — saved cards, the
            // billing portal, and invoice history stay unified.
            const existingSubscriptions = await db
                .select({ stripeCustomerId: subscriptions.stripeCustomerId })
                .from(subscriptions)
                .where(eq(subscriptions.userId, userId));

            let stripeCustomerId = existingSubscriptions.find(s => s.stripeCustomerId)?.stripeCustomerId;
            if (!stripeCustomerId) {
                stripeCustomerId = await stripeService.findOrCreateCustomer(user.email, userId);
            }

            const paymentIntent = await stripeService.createTopupPaymentIntent({
                customerId: stripeCustomerId,
                amountCents: packConfig.priceCents,
                currency: config.topup.currency,
                userId,
                pack,
            });

            if (!paymentIntent.client_secret) {
                request.log.error({ paymentIntentId: paymentIntent.id }, 'Top-up PaymentIntent missing client_secret');
                return reply.status(500).send({ error: 'Failed to start top-up payment' });
            }

            // Record the pending purchase before returning. By the time the user
            // enters card details and the payment succeeds, this row is long
            // committed, so the webhook always finds it.
            await topupService.createPendingStripeTopup({
                userId,
                pack: pack as TopupPack,
                stripePaymentIntentId: paymentIntent.id,
            });

            return reply.send({ clientSecret: paymentIntent.client_secret });
        } catch (error) {
            if (error instanceof DemoUserStripeError) {
                return reply.status(403).send({ error: error.message, code: error.code });
            }
            if (error instanceof UnknownTopupPackError) {
                return reply.status(400).send({ error: error.message, code: 'INVALID_PACK' });
            }
            request.log.error({ err: error }, 'Create top-up intent error');
            return reply.status(500).send({ error: 'Failed to start top-up payment' });
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

            // SANCTIONS CHECK: Block payment processing for sanctioned jurisdictions

            // Check if geo is sanctioned
            if (request.geo && isSanctionedGeo(request.geo)) {
                request.log.warn({
                    userId,
                    geo: request.geo,
                    route: '/payment/change-plan',
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
                    route: '/payment/change-plan',
                }, 'Payment blocked: unknown geo (safe-by-default)');

                return reply.status(403).send({
                    error: 'Unable to process payment at this time',
                    code: 'GEO_VERIFICATION_REQUIRED',
                });
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
            const updatedPeriodStart = stripeTsToDate(updated.current_period_start);
            const updatedPeriodEnd = stripeTsToDate(updated.current_period_end);
            await db
                .update(subscriptions)
                .set({
                    planId,
                    status: updated.status,
                    ...(updatedPeriodStart && { currentPeriodStart: updatedPeriodStart }),
                    ...(updatedPeriodEnd && { currentPeriodEnd: updatedPeriodEnd }),
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

                    case 'payment_intent.succeeded':
                        await this.handleTopupPaymentSucceeded(
                            event.data.object as Stripe.PaymentIntent,
                            request
                        );
                        break;

                    case 'payment_intent.payment_failed':
                        await this.handleTopupPaymentFailed(
                            event.data.object as Stripe.PaymentIntent,
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

                    case 'charge.dispute.created':
                        await this.handleChargeDisputed(
                            event.data.object as Stripe.Dispute,
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
        // Admin "collect payment" link (mode: 'payment', no plan/subscription).
        // Route to the collect-only handler BEFORE the subscription path — it has
        // no planId, so the guard below would otherwise reject it. It only marks
        // the payment_requests row paid; it NEVER credits reply balance.
        if (session.metadata?.type === 'manual_payment') {
            await this.handleManualPaymentComplete(session, request);
            return;
        }

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
            currentPeriodStart: stripeTsToDate(stripeSubscription.current_period_start),
            currentPeriodEnd: stripeTsToDate(stripeSubscription.current_period_end),
            trialEndsAt: stripeTsToDate(stripeSubscription.trial_end),
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
     * Collect-only completion for an admin-generated payment link. Marks the
     * payment_requests row `paid` (status-gated → idempotent on webhook replay)
     * and does NOTHING else — the replies it bills for were credited separately
     * by hand, so this never touches users.topup_balance.
     */
    private async handleManualPaymentComplete(
        session: Stripe.Checkout.Session,
        request: FastifyRequest
    ) {
        // Only credit-collect on an actually-paid session (a 'complete' session can
        // still be unpaid for async methods); reconciliation covers the rest.
        if (session.payment_status !== 'paid') {
            request.log.info(
                { sessionId: session.id, paymentStatus: session.payment_status },
                'Manual payment session completed but not yet paid — leaving pending'
            );
            return;
        }
        const paymentIntentId = stripeRefId(session.payment_intent);

        const flipped = await paymentRequestService.markPaid(session.id, paymentIntentId);
        request.log.info(
            { sessionId: session.id, paymentIntentId, paymentRequestId: session.metadata?.paymentRequestId, flipped },
            flipped ? 'Manual payment request marked paid' : 'Manual payment request already settled (webhook replay)'
        );
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
            const trialEndsAt = stripeTsToDate(stripeSubscription.trial_end);

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
            cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
            updatedAt: new Date(),
        };
        const periodStart = stripeTsToDate(stripeSubscription.current_period_start);
        const periodEnd = stripeTsToDate(stripeSubscription.current_period_end);
        if (periodStart) updateValues.currentPeriodStart = periodStart;
        if (periodEnd) updateValues.currentPeriodEnd = periodEnd;
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
        const periodStart = stripeTsToDate(stripeSubscription.current_period_start);
        const periodEnd = stripeTsToDate(stripeSubscription.current_period_end);

        // Update subscription status with retry logic for race conditions
        let retries = 3;
        let updatedRow: { id: string; userId: string } | null = null;

        while (retries > 0 && !updatedRow) {
            const result = await db
                .update(subscriptions)
                .set({
                    status: 'active',
                    ...(periodStart && { currentPeriodStart: periodStart }),
                    ...(periodEnd && { currentPeriodEnd: periodEnd }),
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

        // Reset quota for the new billing period. Skip if Stripe didn't return
        // valid period boundaries (rare — e.g. paused subs); the previous row
        // remains in place and will be reset on the next renewal event.
        if (periodStart && periodEnd) {
            await subscriptionsService.initializeUsagePeriod(updatedRow.userId, periodStart, periodEnd);
        } else {
            request.log.warn(
                { subscriptionId: stripeSubscriptionId },
                'Skipping usage period reset - Stripe returned invalid current_period boundaries'
            );
        }

        // Drop the boolean status cache so a `past_due → active` recovery is
        // visible to the reply pipeline immediately, not after a 60s TTL.
        await subscriptionsService.invalidateStatusCache(updatedRow.userId);
    }

    /**
     * Handle a successful one-time PaymentIntent — credit a Credit top-up pack.
     *
     * GUARD: subscription invoices ALSO emit payment_intent.succeeded. Only
     * PaymentIntents we tagged `metadata.type = 'topup'` are top-ups; everything
     * else (subscription first-invoice PIs, etc.) is ignored here and handled by
     * the invoice.* events. This metadata gate is what makes adding this event
     * to the shared webhook safe — it cannot touch subscription state.
     */
    private async handleTopupPaymentSucceeded(paymentIntent: Stripe.PaymentIntent, request: FastifyRequest) {
        if (paymentIntent.metadata?.type !== 'topup') {
            request.log.info({ paymentIntentId: paymentIntent.id }, 'payment_intent.succeeded is not a top-up, skipping');
            return;
        }

        const result = await topupService.settleStripeTopup(paymentIntent.id);

        if (result.credited) {
            request.log.info(
                { paymentIntentId: paymentIntent.id, userId: result.userId, repliesAdded: result.repliesAdded, newBalance: result.newBalance },
                'Top-up credited'
            );
            // Best-effort notification — failure must not break the webhook.
            if (result.userId) {
                notificationService.sendTemplateNotification(
                    result.userId,
                    'topup_credited',
                    { replies: String(result.repliesAdded ?? '') },
                    { deepLink: '/dashboard' }
                ).catch(err => request.log.error({ err, paymentIntentId: paymentIntent.id }, 'Failed to send topup_credited notification'));
            }
            return;
        }

        if (result.alreadySettled) {
            request.log.info({ paymentIntentId: paymentIntent.id }, 'Top-up already settled (webhook replay), skipping');
            return;
        }

        // No pending row matched a top-up-tagged PaymentIntent. The pending row
        // is written before the client can pay, so this is near-impossible —
        // surface it loudly for manual reconciliation rather than silently
        // dropping a paid-for top-up.
        captureError(new Error('topup_settle_no_pending_row'), 'Top-up PaymentIntent succeeded but no pending row found', {
            tags: { service: 'payment', flow: 'topup_settle' },
            extra: { paymentIntentId: paymentIntent.id, metadata: paymentIntent.metadata },
        });
    }

    /**
     * Handle a failed top-up PaymentIntent — mark the pending row `failed` for
     * funnel hygiene. Ignores non-top-up PaymentIntents (subscription invoice
     * failures flow through invoice.payment_failed instead).
     */
    private async handleTopupPaymentFailed(paymentIntent: Stripe.PaymentIntent, request: FastifyRequest) {
        if (paymentIntent.metadata?.type !== 'topup') {
            return;
        }
        await topupService.markStripeTopupFailed(paymentIntent.id);
        request.log.info({ paymentIntentId: paymentIntent.id }, 'Top-up payment failed, pending row marked failed');
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
        // A refunded charge may belong to a one-time top-up (not a subscription).
        // Reverse it FIRST — clawing back the reply credits — and stop here if it
        // matched a top-up row, so we don't also run the subscription path.
        const refundedTopup = await this.reverseTopupForCharge(charge, request, 'refund');
        if (refundedTopup) return;

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

    /**
     * Dispute (chargeback) on a charge. The bank pulls the funds immediately
     * pending resolution, so for a digital-credit product the money-safe move is
     * to revoke the top-up credits now (same as a refund). If the dispute is
     * later won, credits can be re-granted via /admin/topup.
     */
    private async handleChargeDisputed(dispute: Stripe.Dispute, request: FastifyRequest) {
        const charge: Pick<Stripe.Charge, 'id' | 'payment_intent'> = {
            id: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id,
            payment_intent: dispute.payment_intent ?? null,
        };
        await this.reverseTopupForCharge(charge, request, 'dispute');
        // No subscription-side dispute handling today; nothing else to do.
    }

    /**
     * Resolve a refunded/disputed charge to its top-up row (by PaymentIntent) and
     * reverse it. Returns true if a top-up row matched (so the caller can stop),
     * false otherwise (the charge wasn't a top-up — caller falls through). Shared
     * by the refund and dispute webhook handlers.
     */
    private async reverseTopupForCharge(
        charge: Pick<Stripe.Charge, 'id' | 'payment_intent'>,
        request: FastifyRequest,
        kind: 'refund' | 'dispute',
    ): Promise<boolean> {
        const paymentIntentId = typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : charge.payment_intent?.id;
        if (!paymentIntentId) return false;

        const { reversed, decremented } = await topupService.reverseStripeTopup(paymentIntentId);
        if (!reversed) return false;

        request.log.info(
            { chargeId: charge.id, paymentIntentId, kind, creditsClawedBack: decremented },
            'Top-up reversed from charge ' + kind
        );
        return true;
    }
}

export const paymentController = new PaymentController();
