import { FastifyReply, FastifyRequest, FastifyBaseLogger } from 'fastify';
import { stripeService, DemoUserStripeError } from '../services/stripe';
import { subscriptionsService } from '../services/subscriptions';
import { topupService, UnknownTopupPackError, type TopupPack } from '../services/topup';
import { db } from '../db';
import { subscriptions, users, plans, stripeWebhookEvents } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { config } from '../config';
import { resolveMarketplaceBilling } from '../services/marketplaceBilling';
import { captureError } from '../utils/sentryHelpers';
import { isSanctionedGeo } from '../utils/sanctions';
import { shouldBlockUnknownGeo } from '../middleware/geo';
import type { CreateCheckoutSessionRequest, SubscriptionStatus } from '../types/payment';
import { resolveStripePriceForInterval } from '../utils/stripePrice';
import { mapStripeSubscriptionStatus } from '../config/stripeBilling';
import { dispatchStripeEvent } from './paymentWebhookHandlers';

// Type for authenticated requests
interface AuthenticatedRequest extends FastifyRequest {
    user?: { userId: string; isAdmin?: boolean };
}

/**
 * Marketplace-billed accounts must never reach a Stripe surface. Three rails
 * (Shopify D-G, Salla Article 5, Zid App Market), one gate — every Stripe entry
 * point calls this and stops when it returns true (the 400 has already been
 * sent).
 *
 * The rails' rulings, their order, and the Stripe exemption all live in
 * `services/marketplaceBilling.ts`; this function is only the HTTP shape around
 * that verdict. Shopify is still evaluated first and its behaviour is
 * byte-for-byte unchanged.
 */
async function rejectIfMarketplaceBilled(
    userId: string,
    reply: FastifyReply,
    log?: FastifyBaseLogger,
): Promise<boolean> {
    const sub = await subscriptionsService.getUserSubscription(userId);
    const verdict = await resolveMarketplaceBilling(userId, sub);
    if (!verdict) return false;

    // Logged because this guard's characteristic failure is being SILENTLY
    // INERT: the store-based rails' exemption reads a payment_method that is
    // NULL on every fresh trial, so a regression there suppresses nothing and
    // looks exactly like "no marketplace merchants hit a paywall this week". A
    // refusal count is the only way to tell working from broken in production.
    log?.info(
        { userId, rail: verdict.marketplace },
        'Marketplace billing guard refused a Stripe entry point',
    );
    reply.status(400).send({ error: verdict.message, code: verdict.code });
    return true;
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

            if (await rejectIfMarketplaceBilled(userId, reply, request.log)) return;

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

            // Pick monthly or yearly Stripe price. Refuses (never falls back
            // to monthly) when yearly is requested but not configured.
            const priceResolution = resolveStripePriceForInterval(plan, request.body.billingInterval);
            if (!priceResolution.ok) {
                request.log.warn(
                    { userId, planId, code: priceResolution.code, requestedInterval: request.body.billingInterval },
                    'Checkout refused: Stripe price not resolvable for requested interval'
                );
                return reply.status(400).send({ error: priceResolution.error, code: priceResolution.code });
            }
            const { stripePriceId } = priceResolution;

            // Look at the user's full subscription history (any status).
            const existingSubscriptions = await db
                .select({
                    id: subscriptions.id,
                    status: subscriptions.status,
                    planId: subscriptions.planId,
                    externalSubscriptionId: subscriptions.externalSubscriptionId,
                })
                .from(subscriptions)
                .where(eq(subscriptions.userId, userId));

            // Determine trial days:
            // - Trial only for an account with NO prior subscription history of any
            //   kind. A user who already consumed a trial on this account (now
            //   canceled/past_due) must not get fresh Stripe trial days — that was a
            //   re-trial loophole. Upgrade/downgrade from an active/trialing sub also
            //   gets no trial.
            let trialDays = 0;
            if (existingSubscriptions.length === 0 && plan.trialDays && plan.trialDays > 0) {
                trialDays = plan.trialDays;
                request.log.info({ userId, planId, trialDays }, 'New user eligible for trial');
            } else if (existingSubscriptions.length > 0) {
                request.log.info(
                    { userId, planId, priorSubscriptions: existingSubscriptions.length },
                    'Existing/returning subscriber - no trial on checkout'
                );
            }

            // Build return URLs server-side (no client-supplied URLs = no open-redirect risk)

            // Hosted mode: redirect the customer to checkout.stripe.com, where
            // Stripe is first-party and privacy browsers have nothing to block
            // (see createHostedCheckoutSession for the incident that forced
            // this). Used by the native-app bounce and the web fallback link.
            if (request.body.uiMode === 'hosted') {
                // `hosted=1` tells the return page Stripe only redirects here
                // AFTER a successful payment, so an unauthenticated browser
                // (the app bounce) can still show an honest success state.
                const { sessionId, url } = await stripeService.createHostedCheckoutSession(
                    userId,
                    user.email,
                    planId,
                    stripePriceId,
                    `${config.frontendUrl}/payment/return?session_id={CHECKOUT_SESSION_ID}&hosted=1`,
                    `${config.frontendUrl}/pricing`,
                    trialDays
                );
                // Logged so hosted-vs-embedded adoption is measurable — deciding
                // whether to go hosted-everywhere (D-040's open question) needs
                // this split, and grep-ability beats adding a metric for it now.
                request.log.info({ userId, planId, sessionId, uiMode: 'hosted' }, 'Hosted checkout session created');
                return reply.send({ sessionId, url });
            }

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

            if (await rejectIfMarketplaceBilled(userId, reply, request.log)) return;

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

            const priceResolution = resolveStripePriceForInterval(plan, request.body.billingInterval);
            if (!priceResolution.ok) {
                request.log.warn(
                    { userId, planId, code: priceResolution.code, requestedInterval: request.body.billingInterval },
                    'Subscription intent refused: Stripe price not resolvable for requested interval'
                );
                return reply.status(400).send({ error: priceResolution.error, code: priceResolution.code });
            }
            const { stripePriceId } = priceResolution;

            // Check existing subscriptions for trial eligibility
            const existingSubscriptions = await db
                .select({ id: subscriptions.id, status: subscriptions.status, planId: subscriptions.planId, stripeCustomerId: subscriptions.stripeCustomerId })
                .from(subscriptions)
                .where(eq(subscriptions.userId, userId));

            // Trial only for an account with NO prior subscription history of any
            // kind — a user who already consumed a trial (now canceled/past_due)
            // must not get fresh Stripe trial days (re-trial loophole).
            let trialDays = 0;
            if (existingSubscriptions.length === 0 && plan.trialDays && plan.trialDays > 0) {
                trialDays = plan.trialDays;
                request.log.info({ userId, planId, trialDays }, 'New user eligible for trial');
            } else if (existingSubscriptions.length > 0) {
                request.log.info({ userId, planId, priorSubscriptions: existingSubscriptions.length }, 'Existing/returning subscriber - no trial on checkout');
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

            // D-G covers EVERY Stripe surface, not just subscriptions: a top-up
            // is a Stripe charge beside Shopify billing — the exact off-platform
            // billing Shopify forbids for App Store installs. The hidden CTA is
            // the friendly layer; this is the enforcement. Runs AFTER the free
            // in-memory gates (kill-switch, geo) — it is the only check here
            // that costs a DB read.
            if (await rejectIfMarketplaceBilled(userId, reply, request.log)) return;

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

            if (await rejectIfMarketplaceBilled(userId, reply, request.log)) return;

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
            if (!planId) {
                return reply.status(400).send({ error: 'Plan ID is required' });
            }

            const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
            if (!plan) {
                return reply.status(404).send({ error: 'Plan not found' });
            }

            const priceResolution = resolveStripePriceForInterval(plan, request.body.billingInterval);
            if (!priceResolution.ok) {
                request.log.warn(
                    { userId, planId, code: priceResolution.code, requestedInterval: request.body.billingInterval },
                    'Plan change refused: Stripe price not resolvable for requested interval'
                );
                return reply.status(400).send({ error: priceResolution.error, code: priceResolution.code });
            }
            const newPriceId = priceResolution.stripePriceId;

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

            // Local mirror so the UI reflects the change without waiting for a
            // webhook. It writes NO period: `current_period_end` means paid
            // through, and only `invoice.payment_succeeded` proves that. A plan
            // change creates a proration invoice, and Stripe reports the new
            // period as soon as it is CREATED — before it is paid, and while
            // the subscription still reads `active` (measured on the 08-13
            // renewal: the advancing event carried status=active with an open,
            // amount_paid=0 invoice). The proration's payment_succeeded sets the
            // period.
            //
            // This comment previously said the mirror was safe because
            // "the subscription.updated webhook is authoritative and will
            // re-write these fields". That stopped being true in this same
            // branch, which removed that write — leaving this the authoritative
            // and ungated one.
            //
            // The status is mapped, not mirrored raw: Stripe's enum is wider
            // than ours, and `incomplete` is reachable here when the proration
            // invoice needs SCA. Raw, it used to entitle silently; since the
            // CHECK constraint in 0173 it would fail the write and 500 this
            // endpoint instead.
            const changeMapping = mapStripeSubscriptionStatus(updated.status);
            await db
                .update(subscriptions)
                .set({
                    planId,
                    ...(changeMapping.write && { status: changeMapping.status }),
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

            // D-G: a shopify row's externalSubscriptionId is an AppSubscription
            // GID — passing it to stripeService.cancelSubscription is a
            // guaranteed Stripe error. Cancellation lives in Shopify admin.
            if (await rejectIfMarketplaceBilled(userId, reply, request.log)) return;

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

            // D-G: the Stripe portal would open against a stale/foreign Stripe
            // customer for a shopify-billed account. Plan management lives in
            // Shopify admin.
            if (await rejectIfMarketplaceBilled(userId, reply, request.log)) return;

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
                await dispatchStripeEvent(event, request);

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
}

export const paymentController = new PaymentController();
