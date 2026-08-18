import { db } from '../db';
import { subscriptions, users, plans, settings } from '../db/schema';
import { eq, desc, or } from 'drizzle-orm';
import { config } from '../config';
import { stripeService, stripeRefId } from '../services/stripe';
import { paymentRequestService } from '../services/paymentRequest';
import { subscriptionsService } from '../services/subscriptions';
import { adoptStripeSubscription } from '../services/subscriptionLinking';
import {
    notifyRenewalFailed,
    prepareSubscriptionDeletedNotice,
    sendSubscriptionDeletedNotice,
    handlePaymentRecovery,
} from '../services/dunningNotices';
import { topupService } from '../services/topup';
import { notificationService } from '../services/notifications';
import { emailService } from '../services/email';
import { subscriptionWelcomeEmailTemplate } from '../utils/emailTemplates';
import { captureError } from '../utils/sentryHelpers';
import { stripeTsToDate } from '../utils/stripeTime';
import { mapStripeSubscriptionStatus, isPaidStripeStatus } from '../config/stripeBilling';
import { getInvoiceSubscriptionId, getSubscriptionPeriod } from '../utils/stripeCompat';
import { resolveLocale } from '../utils/i18n';
import { createRequestLogger } from '../types/logger';
import type { FastifyRequest } from 'fastify';
import type Stripe from 'stripe';

/**
 * Dispatch a verified Stripe event to its handler. Extracted from
 * PaymentController.handleWebhook — that method still owns signature
 * verification, idempotency, and the completed/processing status transitions;
 * this owns only the per-event-type routing and processing logic.
 *
 * Throws on handler failure so the caller can leave the event in `processing`
 * and return 5xx for a Stripe retry.
 */
export async function dispatchStripeEvent(event: Stripe.Event, request: FastifyRequest): Promise<void> {
    switch (event.type) {
        case 'checkout.session.completed':
            await handleCheckoutComplete(event.data.object as Stripe.Checkout.Session, request);
            break;

        case 'customer.subscription.created':
            await handleSubscriptionCreated(event.data.object as Stripe.Subscription, request);
            break;

        case 'customer.subscription.updated':
            await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, request);
            break;

        case 'customer.subscription.deleted':
            await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, request);
            break;

        case 'invoice.payment_succeeded':
            await handlePaymentSucceeded(event.data.object as Stripe.Invoice, request);
            break;

        case 'payment_intent.succeeded':
            await handleTopupPaymentSucceeded(event.data.object as Stripe.PaymentIntent, request);
            break;

        case 'payment_intent.payment_failed':
            await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent, request);
            break;

        case 'invoice.payment_failed':
            await handlePaymentFailed(event.data.object as Stripe.Invoice, request);
            break;

        case 'charge.refunded':
            await handleChargeRefunded(event.data.object as Stripe.Charge, request);
            break;

        case 'charge.dispute.created':
            await handleChargeDisputed(event.data.object as Stripe.Dispute, request);
            break;

        default:
            request.log.info({ eventType: event.type }, 'Unhandled webhook event type');
    }
}

/**
 * Handle successful checkout session.
 * Exported for direct unit testing (manual_payment routing); the dispatcher
 * above is its production caller.
 */
export async function handleCheckoutComplete(
    session: Stripe.Checkout.Session,
    request: FastifyRequest
) {
    // Admin "collect payment" link (mode: 'payment', no plan/subscription).
    // Route to the collect-only handler BEFORE the subscription path — it has
    // no planId, so the guard below would otherwise reject it. It only marks
    // the payment_requests row paid; it NEVER credits reply balance.
    if (session.metadata?.type === 'manual_payment') {
        await handleManualPaymentComplete(session, request);
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
    const period = getSubscriptionPeriod(stripeSubscription);

    // Same translation as the update path (config/stripeBilling.ts): a raw
    // Stripe status outside our union entitles forever. A first invoice that
    // has not settled at checkout-completion time (`incomplete`, effectively
    // unreachable for cards) has no non-entitling representation in our
    // five-value union other than `canceled` — `past_due` with a month-away
    // period is a full free month, and with a NULL period it skips the grace
    // check entirely and reads as allowed. `canceled` blocks unconditionally
    // and is healed by adoptStripeSubscription, which takes over this very row
    // the moment the subscription reports active/trialing.
    const insertMapping = mapStripeSubscriptionStatus(stripeSubscription.status);
    const insertStatus = insertMapping.write ? insertMapping.status : 'canceled';
    if (!isPaidStripeStatus(stripeSubscription.status)) {
        captureError(null, 'Checkout completed on an unpaid Stripe subscription', {
            level: 'warning',
            tags: { service: 'payments', flow: 'checkout_complete' },
            extra: { subscriptionId: stripeSubscription.id, stripeStatus: stripeSubscription.status, insertStatus },
        });
    }

    const [insertedSub] = await db.insert(subscriptions).values({
        userId,
        planId,
        status: insertStatus,
        externalSubscriptionId: stripeSubscription.id,
        paymentMethod: 'stripe',
        stripeCustomerId: stripeSubscription.customer as string,
        stripeCheckoutSessionId: session.id,
        currentPeriodStart: stripeTsToDate(period.start),
        currentPeriodEnd: stripeTsToDate(period.end),
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
        await sendSubscriptionWelcomeEmail(userId, planId, stripeSubscription, request);
    }
}

/**
 * Collect-only completion for an admin-generated payment link. Marks the
 * payment_requests row `paid` (status-gated → idempotent on webhook replay)
 * and does NOTHING else — the replies it bills for were credited separately
 * by hand, so this never touches users.topup_balance.
 */
async function handleManualPaymentComplete(
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
async function sendSubscriptionWelcomeEmail(
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

        const lang = resolveLocale(userSettings?.dashboardLanguage);
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
export async function handleSubscriptionCreated(
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
        await adoptStripeSubscription(stripeSubscription, request.log);
    }
}

/**
 * Handle subscription updated
 */
export async function handleSubscriptionUpdated(
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
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        updatedAt: new Date(),
    };

    // Stripe's status is translated, never mirrored raw: three of its eight
    // values are outside our union and fall through the entitlement gate to
    // allowed-forever. See config/stripeBilling.ts for the full ruling.
    const mapping = mapStripeSubscriptionStatus(stripeSubscription.status);
    if (mapping.write) {
        updateValues.status = mapping.status;
    } else {
        // Leave the existing status in place — see StripeStatusMapping. An
        // `unknown` status additionally means Stripe's enum has outgrown our
        // map, which must be visible rather than silently mis-entitling.
        request.log.warn(
            { subscriptionId: stripeSubscription.id, stripeStatus: stripeSubscription.status, reason: mapping.reason },
            'Stripe status not mapped — leaving local status unchanged'
        );
        if (mapping.reason === 'unknown') {
            captureError(null, 'Unmapped Stripe subscription status', {
                level: 'warning',
                tags: { service: 'payments', flow: 'subscription_updated' },
                extra: { subscriptionId: stripeSubscription.id, stripeStatus: stripeSubscription.status },
            });
        }
    }

    // The period is mirrored ONLY when Stripe says it is paid for. A `past_due`
    // or `unpaid` subscription keeps generating invoices, so Stripe advances
    // current_period_* into a month the merchant has not paid — mirroring that
    // grants both a free month of entitlement and a fresh monthly quota.
    // Our column means PAID THROUGH; that is how the gate, the 3-day grace and
    // the dunning emails all read it.
    const period = getSubscriptionPeriod(stripeSubscription);
    const periodStart = stripeTsToDate(period.start);
    const periodEnd = stripeTsToDate(period.end);
    if (isPaidStripeStatus(stripeSubscription.status)) {
        if (periodStart) updateValues.currentPeriodStart = periodStart;
        if (periodEnd) updateValues.currentPeriodEnd = periodEnd;
    } else {
        request.log.info(
            { subscriptionId: stripeSubscription.id, stripeStatus: stripeSubscription.status },
            'Unpaid status — keeping the last paid-through period'
        );
    }
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
        // Never linked (see adoptStripeSubscription). This is the event that
        // carries a PaymentElement subscription from `incomplete` to `active`,
        // so it is the normal moment for a first-time payer to get adopted.
        await adoptStripeSubscription(stripeSubscription, request.log);
    }
}

/**
 * Handle subscription deleted
 */
export async function handleSubscriptionDeleted(
    stripeSubscription: Stripe.Subscription,
    request: FastifyRequest
) {
    // Snapshot BEFORE the flip: telling an involuntary cancellation (Stripe
    // gave up collecting → suspension email) from a voluntary one (merchant
    // asked to stop → no email) needs the row's prior status.
    const noticeCtx = await prepareSubscriptionDeletedNotice(stripeSubscription.id);

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

    // The merchant just lost replies — the one moment they must hear about
    // over email, not only in-app. Never throws.
    await sendSubscriptionDeletedNotice(noticeCtx, stripeSubscription, createRequestLogger(request.log));
}

/**
 * Handle successful payment
 */
export async function handlePaymentSucceeded(invoice: Stripe.Invoice, request: FastifyRequest) {
    const stripeSubscriptionId = getInvoiceSubscriptionId(invoice);

    if (!stripeSubscriptionId) {
        request.log.warn({ invoiceId: invoice.id }, 'Invoice has no subscription ID');
        return;
    }

    // Pull the latest period boundaries from Stripe so DB matches Stripe's truth.
    // On renewal Stripe advances the period; we must mirror that and reset quota —
    // otherwise the previous period's usage row keeps blocking.
    const stripeSubscription = await stripeService.getSubscription(stripeSubscriptionId);
    const period = getSubscriptionPeriod(stripeSubscription);
    const periodStart = stripeTsToDate(period.start);
    const periodEnd = stripeTsToDate(period.end);

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
        // The row was never linked to Stripe (see adoptStripeSubscription).
        // Money has demonstrably landed at this point, so adopt on the invoice
        // rather than logging an error and dropping a paid customer.
        const adopted = await adoptStripeSubscription(stripeSubscription, request.log);
        if (!adopted) {
            request.log.error(
                { subscriptionId: stripeSubscriptionId },
                'Failed to activate subscription - not found after retries, and could not adopt'
            );
        }
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

    // Close any open dunning episode: resets the notified stamps and — only
    // when an episode WAS open — emails the payment-recovered confirmation.
    // A normal renewal resets nothing and sends nothing. Never throws.
    await handlePaymentRecovery(
        stripeSubscriptionId,
        typeof invoice.id === 'string' ? invoice.id : undefined,
        periodEnd,
        createRequestLogger(request.log),
    );
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
export async function handleTopupPaymentSucceeded(paymentIntent: Stripe.PaymentIntent, request: FastifyRequest) {
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
 * Handle a failed card attempt on ANY PaymentIntent — top-up or subscription
 * first invoice. Money state is never touched here; this handler exists purely
 * so a refused card leaves a trace.
 *
 * IMPORTANT: `payment_intent.payment_failed` marks a single FAILED ATTEMPT,
 * not a dead PaymentIntent. The PI stays at `requires_payment_method` and the
 * customer can retry on the same client secret (the checkout reuses the same
 * intent) — Stripe then fires `payment_intent.succeeded` for the SAME PI. So
 * we must NOT flip the row to a terminal `failed` here: that would block
 * settleStripeTopup from crediting the retry, leaving money captured with no
 * replies — and reconcileStripeTopups only sweeps `pending`, so it wouldn't
 * self-heal. Leave the row open and just log the attempt; genuine
 * abandonment/cancellation is terminal-ized by reconcileStripeTopups, which
 * re-queries Stripe before marking a row failed.
 *
 * The non-top-up branch used to be a bare `return`. That silence is what hid a
 * merchant whose card was refused three times in nine minutes (2026-07-25): the
 * subscription's first-invoice PI fails client-side at `confirmPayment`, so no
 * `invoice.payment_failed` follows and the account simply sat `incomplete` with
 * nothing on our side to show for it. Logging the decline code (and the card's
 * issuing country — cross-border refusals are the common case for our
 * merchants) makes the next one greppable instead of anecdotal.
 */
export async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent, request: FastifyRequest) {
    const lastError = paymentIntent.last_payment_error;
    const card = lastError?.payment_method?.card;
    const attempt = {
        paymentIntentId: paymentIntent.id,
        customerId: stripeRefId(paymentIntent.customer),
        userId: paymentIntent.metadata?.userId,
        errorCode: lastError?.code,
        declineCode: lastError?.decline_code,
        cardCountry: card?.country,
        cardBrand: card?.brand,
    };

    if (paymentIntent.metadata?.type !== 'topup') {
        request.log.warn(attempt, 'Subscription card attempt failed');
        return;
    }

    request.log.warn(
        attempt,
        'Top-up payment attempt failed (non-terminal); leaving row open for retry/reconcile',
    );
}

/**
 * Handle failed payment
 */
export async function handlePaymentFailed(invoice: Stripe.Invoice, request: FastifyRequest) {
    const stripeSubscriptionId = getInvoiceSubscriptionId(invoice);

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

        // Dunning email with the invoice's hosted payment link — once per
        // failure episode (Stripe re-fires this event on every Smart-Retry
        // attempt; the stamp claim absorbs the repeats). Never throws; the
        // daily sweep is the retry channel.
        await notifyRenewalFailed(invoice, createRequestLogger(request.log));
    }
}

/**
 * Handle a refund issued in Stripe (manually via Dashboard or via the
 * refund-charge.ts admin script). We log it and notify the customer.
 * Refund alone does NOT cancel the subscription — that comes through a
 * separate `customer.subscription.deleted` event if applicable.
 */
export async function handleChargeRefunded(charge: Stripe.Charge, request: FastifyRequest) {
    // A refunded charge may belong to a one-time top-up (not a subscription).
    // Reverse it FIRST — clawing back the reply credits — and stop here if it
    // matched a top-up row, so we don't also run the subscription path.
    const refundedTopup = await reverseTopupForCharge(charge, request, 'refund');
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
async function handleChargeDisputed(dispute: Stripe.Dispute, request: FastifyRequest) {
    const charge: Pick<Stripe.Charge, 'id' | 'payment_intent'> = {
        id: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id,
        payment_intent: dispute.payment_intent ?? null,
    };
    await reverseTopupForCharge(charge, request, 'dispute');
    // No subscription-side dispute handling today; nothing else to do.
}

/**
 * Resolve a refunded/disputed charge to its top-up row (by PaymentIntent) and
 * reverse it. Returns true if a top-up row matched (so the caller can stop),
 * false otherwise (the charge wasn't a top-up — caller falls through). Shared
 * by the refund and dispute webhook handlers.
 */
export async function reverseTopupForCharge(
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
