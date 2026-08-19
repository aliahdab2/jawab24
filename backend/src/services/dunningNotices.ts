/**
 * Dunning emails for the Stripe rail — the merchant-facing lifecycle of an
 * unpaid renewal. Three notices, each sent AT MOST ONCE per failure episode
 * (an episode runs from the first failed renewal charge to the next successful
 * payment, which resets the stamps):
 *
 *   1. payment_failed    — the renewal charge was declined; service still runs.
 *                          Webhook (invoice.payment_failed) + daily sweep
 *                          Branch A as catch-up/backfill.
 *   2. service_suspended — the merchant actually lost replies: Stripe canceled
 *                          the subscription (webhook), or the past_due grace
 *                          expired with no webhook firing (sweep Branch B).
 *   3. payment_recovered — a payment landed while an episode was open; closes
 *                          the loop. Webhook (invoice.payment_succeeded) only.
 *
 * Why this exists: before it, a failed renewal produced ONE in-app notification
 * and nothing else — the dashboard showed everything normal while Stripe
 * retried, and the eventual suspension was silent (Nourva, 2026-08-13; the
 * fleet audit of 2026-08-09 found ~2,333 unanswered messages/week across 8
 * silently-suspended pages).
 *
 * Concurrency: the webhook path and the daily sweep race for the same notice
 * (Stripe re-fires invoice.payment_failed on every Smart-Retry attempt). The
 * stamp is therefore CLAIMED atomically before composing (UPDATE … WHERE the
 * stamp IS NULL), sent via trySend (never send — a network throw must not
 * abort a sweep or 5xx a webhook), and RELEASED back to NULL when the send
 * provably did not go out, so the other trigger retries. A Resend
 * Idempotency-Key shared by both triggers is the 24h provider-side belt for
 * the ambiguous-failure window.
 *
 * Manual/bank rails are deliberately OUT of scope here — their lifecycle
 * emails are the subscription-expiry reminder plan (PLAN-email-strategy).
 */
import type Stripe from 'stripe';
import { and, eq, gt, isNull, isNotNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { subscriptions, users, settings } from '../db/schema';
import { emailService } from './email';
import { stripeService } from './stripe';
import { GRACE_PERIOD_DAYS } from './subscriptions';
import {
    paymentFailedEmailTemplate,
    serviceSuspendedEmailTemplate,
    paymentRecoveredEmailTemplate,
} from '../utils/emailTemplates';
import {
    getExpandedLatestInvoice,
    getInvoiceAmountDue,
    getInvoiceBillingReason,
    getInvoiceHostedUrl,
    getInvoiceSubscriptionId,
} from '../utils/stripeCompat';
import { formatDateLong } from '../utils/formatDate';
import { formatMoney } from '../utils/formatMoney';
import { captureError } from '../utils/sentryHelpers';
import { resolveLocale } from '../utils/i18n';
import { config } from '../config';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';
import {
    runLifecycleNoticeSweep,
    selectDueRows,
    setLifecycleSweepLogger,
} from './lifecycleNoticeSweep';
import type { LifecycleNoticeResult, LifecycleNoticeRow } from './lifecycleNoticeSweep';

const DAY_MS = 24 * 60 * 60 * 1000;

let logger: Logger = noopLogger;
export function setDunningNoticesLogger(l: Logger): void {
    logger = l;
    setLifecycleSweepLogger(l);
}

function dashboardUrl(): string {
    return `${config.frontendUrl}/dashboard`;
}

function pricingUrl(lang: 'ar' | 'en'): string {
    return `${config.frontendUrl}/${lang}/pricing`;
}

/** The instant a past_due row's entitlement actually ends. */
function graceEnd(periodEnd: Date): Date {
    return new Date(periodEnd.getTime() + GRACE_PERIOD_DAYS * DAY_MS);
}

// ---------------------------------------------------------------------------
// Stamp claims — the atomic idempotency primitive both triggers share.
// ---------------------------------------------------------------------------

async function claimRenewalFailureStamp(subscriptionId: string): Promise<boolean> {
    const rows = await db
        .update(subscriptions)
        .set({ renewalFailureNotifiedAt: new Date() })
        .where(and(eq(subscriptions.id, subscriptionId), isNull(subscriptions.renewalFailureNotifiedAt)))
        .returning({ id: subscriptions.id });
    return rows.length > 0;
}

async function releaseRenewalFailureStamp(subscriptionId: string): Promise<void> {
    await db
        .update(subscriptions)
        .set({ renewalFailureNotifiedAt: null })
        .where(eq(subscriptions.id, subscriptionId));
}

/**
 * Claiming the suspension notice also closes the renewal-failed stamp (via
 * COALESCE, preserving a real earlier timestamp): once the merchant is told
 * replies STOPPED, the milder "your renewal failed, service still runs" email
 * must never follow it.
 */
async function claimSuspensionStamp(subscriptionId: string): Promise<boolean> {
    const rows = await db
        .update(subscriptions)
        .set({
            suspensionNotifiedAt: new Date(),
            renewalFailureNotifiedAt: sql`COALESCE(${subscriptions.renewalFailureNotifiedAt}, NOW())`,
        })
        .where(and(eq(subscriptions.id, subscriptionId), isNull(subscriptions.suspensionNotifiedAt)))
        .returning({ id: subscriptions.id });
    return rows.length > 0;
}

/**
 * Releases ONLY the suspension stamp. The renewal stamp a failed claim may
 * have co-set stays — a row in suspension territory is outside Branch A's
 * window anyway, and tomorrow's Branch B retry is the correct channel.
 */
async function releaseSuspensionStamp(subscriptionId: string): Promise<void> {
    await db
        .update(subscriptions)
        .set({ suspensionNotifiedAt: null })
        .where(eq(subscriptions.id, subscriptionId));
}

// ---------------------------------------------------------------------------
// Webhook-path row lookup
// ---------------------------------------------------------------------------

interface DunningRow {
    subscriptionId: string;
    userId: string;
    status: string | null;
    cancelAtPeriodEnd: boolean | null;
    currentPeriodEnd: Date | null;
    renewalFailureNotifiedAt: Date | null;
    suspensionNotifiedAt: Date | null;
    email: string | null;
    name: string | null;
    dashboardLanguage: string | null;
}

async function findRowByStripeSubscriptionId(stripeSubscriptionId: string): Promise<DunningRow | null> {
    const rows = await db
        .select({
            subscriptionId: subscriptions.id,
            userId: subscriptions.userId,
            status: subscriptions.status,
            cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
            currentPeriodEnd: subscriptions.currentPeriodEnd,
            renewalFailureNotifiedAt: subscriptions.renewalFailureNotifiedAt,
            suspensionNotifiedAt: subscriptions.suspensionNotifiedAt,
            email: users.email,
            name: users.name,
            dashboardLanguage: settings.dashboardLanguage,
        })
        .from(subscriptions)
        .innerJoin(users, eq(users.id, subscriptions.userId))
        .leftJoin(settings, eq(settings.userId, subscriptions.userId))
        .where(eq(subscriptions.externalSubscriptionId, stripeSubscriptionId))
        .limit(1);
    return rows[0] ?? null;
}

function displayName(row: { name: string | null; email: string | null }): string {
    return row.name || (row.email ? row.email.split('@')[0] : '');
}

// ---------------------------------------------------------------------------
// 1. payment_failed — webhook entry (invoice.payment_failed)
// ---------------------------------------------------------------------------

/**
 * Email the merchant that a renewal charge was declined. Never throws — the
 * caller's row-state work (status flip, in-app notification) already
 * succeeded, and the daily sweep is the retry channel.
 */
export async function notifyRenewalFailed(invoice: Stripe.Invoice, log: Logger = logger): Promise<void> {
    try {
        // A first-invoice failure happens inside checkout with the merchant
        // present — in-checkout UX, not dunning material.
        if (getInvoiceBillingReason(invoice) === 'subscription_create') return;

        const stripeSubscriptionId = getInvoiceSubscriptionId(invoice);
        if (!stripeSubscriptionId) return;

        const row = await findRowByStripeSubscriptionId(stripeSubscriptionId);
        if (!row) return; // unlinked subscription — nothing to notify
        if (!row.email) {
            captureError(null, 'Renewal-failed notice: row has no email address', {
                tags: { service: 'dunning' },
                level: 'warning',
                extra: { subscriptionId: row.subscriptionId, userId: row.userId },
            });
            return;
        }

        // Past the grace boundary the honest message is "replies stopped", not
        // "replies keep running until…" — that row belongs to the suspension
        // flow (sweep Branch B / the deletion webhook).
        if (row.currentPeriodEnd && graceEnd(row.currentPeriodEnd) < new Date()) return;

        if (!(await claimRenewalFailureStamp(row.subscriptionId))) return; // episode already notified

        const lang = resolveLocale(row.dashboardLanguage);
        const amount = getInvoiceAmountDue(invoice);
        const { subject, html } = paymentFailedEmailTemplate({
            lang,
            name: displayName(row),
            amountLabel: amount ? formatMoney(amount.amountCents, amount.currency, lang) : null,
            graceEndLabel: row.currentPeriodEnd ? formatDateLong(graceEnd(row.currentPeriodEnd), lang) : null,
            payUrl: getInvoiceHostedUrl(invoice) ?? dashboardUrl(),
        });

        const send = await emailService.trySend({
            to: row.email,
            subject,
            html,
            type: 'payment_failed',
            userId: row.userId,
            ...(typeof invoice.id === 'string' ? { idempotencyKey: `payment_failed:${invoice.id}` } : {}),
        });

        if (!send.delivered) {
            await releaseRenewalFailureStamp(row.subscriptionId);
            captureError(new Error(`Renewal-failed email failed: ${send.error ?? 'unknown'}`), 'Renewal-failed email failed', {
                tags: { service: 'dunning' },
                level: 'warning',
                extra: { subscriptionId: row.subscriptionId, userId: row.userId, resendError: send.error },
            });
            return;
        }

        log.info('Renewal-failed email sent', { subscriptionId: row.subscriptionId, userId: row.userId });
    } catch (err) {
        captureError(err, 'Renewal-failed notice crashed', {
            tags: { service: 'dunning' },
            extra: { invoiceId: invoice.id },
        });
    }
}

// ---------------------------------------------------------------------------
// 2. service_suspended — webhook entry (customer.subscription.deleted)
// ---------------------------------------------------------------------------

export interface DeletionNoticeContext {
    row: DunningRow;
}

/**
 * Snapshot the row BEFORE the handler flips it to canceled — the involuntary/
 * voluntary distinction needs the prior status. Never throws; null disables
 * the notice.
 */
export async function prepareSubscriptionDeletedNotice(stripeSubscriptionId: string): Promise<DeletionNoticeContext | null> {
    try {
        const row = await findRowByStripeSubscriptionId(stripeSubscriptionId);
        return row ? { row } : null;
    } catch (err) {
        captureError(err, 'Deletion-notice snapshot failed', {
            tags: { service: 'dunning' },
            extra: { stripeSubscriptionId },
        });
        return null;
    }
}

/**
 * Email the merchant that replies stopped because Stripe gave up collecting.
 * Voluntary cancellations (merchant asked to stop) never get it. Never throws.
 */
export async function sendSubscriptionDeletedNotice(
    ctx: DeletionNoticeContext | null,
    stripeSubscription: Stripe.Subscription,
    log: Logger = logger,
): Promise<void> {
    if (!ctx) return;
    const { row } = ctx;
    try {
        const cancellationReason = (stripeSubscription as unknown as {
            cancellation_details?: { reason?: unknown } | null;
        }).cancellation_details?.reason;

        const voluntary = cancellationReason === 'cancellation_requested'
            || stripeSubscription.cancel_at_period_end === true
            || row.cancelAtPeriodEnd === true;
        const involuntary = cancellationReason === 'payment_failed'
            || (!voluntary && (row.status === 'past_due' || row.renewalFailureNotifiedAt !== null));
        if (!involuntary) return;

        if (!row.email) {
            captureError(null, 'Suspension notice: row has no email address', {
                tags: { service: 'dunning' },
                level: 'warning',
                extra: { subscriptionId: row.subscriptionId, userId: row.userId },
            });
            return;
        }

        if (!(await claimSuspensionStamp(row.subscriptionId))) return;

        const lang = resolveLocale(row.dashboardLanguage);
        const { subject, html } = serviceSuspendedEmailTemplate({
            lang,
            name: displayName(row),
            stoppedSinceLabel: formatDateLong(new Date(), lang),
            // The subscription is deleted at Stripe — its invoices are no
            // longer payable; only a fresh checkout revives the account.
            ctaUrl: pricingUrl(lang),
            ctaVariant: 'resubscribe',
        });

        const send = await emailService.trySend({
            to: row.email,
            subject,
            html,
            type: 'service_suspended',
            userId: row.userId,
            idempotencyKey: `service_suspended:${stripeSubscription.id}`,
        });

        if (!send.delivered) {
            await releaseSuspensionStamp(row.subscriptionId);
            captureError(new Error(`Suspension email failed: ${send.error ?? 'unknown'}`), 'Suspension email failed', {
                tags: { service: 'dunning' },
                level: 'warning',
                extra: { subscriptionId: row.subscriptionId, userId: row.userId, resendError: send.error },
            });
            return;
        }

        log.info('Suspension email sent', { subscriptionId: row.subscriptionId, userId: row.userId });
    } catch (err) {
        captureError(err, 'Suspension notice crashed', {
            tags: { service: 'dunning' },
            extra: { subscriptionId: row.subscriptionId },
        });
    }
}

// ---------------------------------------------------------------------------
// 3. payment_recovered — webhook entry (invoice.payment_succeeded)
// ---------------------------------------------------------------------------

/**
 * Reset the failure-episode stamps after a successful payment and, when an
 * episode was actually open (the merchant got a scary email), close the loop
 * with a confirmation. The atomic reset IS the once-only claim: a normal
 * renewal matches zero rows and sends nothing. Never throws.
 */
export async function handlePaymentRecovery(
    stripeSubscriptionId: string,
    invoiceId: string | undefined,
    periodEnd: Date | null,
    log: Logger = logger,
): Promise<void> {
    try {
        const reset = await db
            .update(subscriptions)
            .set({ renewalFailureNotifiedAt: null, suspensionNotifiedAt: null })
            .where(and(
                eq(subscriptions.externalSubscriptionId, stripeSubscriptionId),
                or(isNotNull(subscriptions.renewalFailureNotifiedAt), isNotNull(subscriptions.suspensionNotifiedAt)),
            ))
            .returning({ subscriptionId: subscriptions.id, userId: subscriptions.userId });
        if (reset.length === 0) return; // no open episode — a normal renewal

        const row = await findRowByStripeSubscriptionId(stripeSubscriptionId);
        if (!row?.email) return;
        if (!periodEnd) return; // the copy promises a date; without one, silence beats a broken sentence

        const lang = resolveLocale(row.dashboardLanguage);
        const { subject, html } = paymentRecoveredEmailTemplate({
            lang,
            name: displayName(row),
            periodEndLabel: formatDateLong(periodEnd, lang),
            dashboardUrl: dashboardUrl(),
        });

        // Best-effort, no release: the episode is closed either way, and
        // re-opening it to retry a confirmation would risk re-sending the
        // scary emails instead.
        const send = await emailService.trySend({
            to: row.email,
            subject,
            html,
            type: 'payment_recovered',
            userId: row.userId,
            ...(invoiceId ? { idempotencyKey: `payment_recovered:${invoiceId}` } : {}),
        });

        if (send.delivered) {
            log.info('Payment-recovered email sent', { subscriptionId: row.subscriptionId, userId: row.userId });
        }
    } catch (err) {
        captureError(err, 'Payment-recovery notice crashed', {
            tags: { service: 'dunning' },
            extra: { stripeSubscriptionId },
        });
    }
}

// ---------------------------------------------------------------------------
// Daily sweep — catch-up for both notices (registered in index.ts)
// ---------------------------------------------------------------------------

interface SuspensionExtra {
    ctaUrl: string;
    ctaVariant: 'pay' | 'resubscribe';
}

interface RenewalFailedExtra {
    payUrl: string;
    amountLabel: string | null;
    invoiceId: string | null;
}


/**
 * Run both dunning sweeps. Branch B (suspension) runs FIRST and its claim also
 * closes the renewal stamp, so a row that crossed the grace boundary before
 * ever being emailed gets ONLY the suspension notice — never a stale "service
 * still runs" one after it.
 *
 * Branch A deliberately has NO lookback bound — catching rows whose
 * invoice.payment_failed webhook fired before this feature deployed is the
 * point (the backfill inverts trialReminders' no-backfill rule). It re-fetches
 * the CURRENT open invoice from Stripe because the original webhook payload is
 * long gone.
 */
export async function runDunningNotices(): Promise<{
    suspended: LifecycleNoticeResult;
    renewalFailed: LifecycleNoticeResult;
}> {
    const suspended = await runLifecycleNoticeSweep<SuspensionExtra>({
        label: '[DunningSuspended]',
        cronTag: 'dunning_notices',
        noticeName: 'Service-suspended',
        emailType: 'service_suspended',
        deliveryMode: 'email-primary',
        startMeta: { graceDays: GRACE_PERIOD_DAYS },
        fetchDue: (now) => selectDueRows(and(
            eq(subscriptions.paymentMethod, 'stripe'),
            eq(subscriptions.status, 'past_due'),
            isNull(subscriptions.suspensionNotifiedAt),
            isNotNull(subscriptions.currentPeriodEnd),
            lte(subscriptions.currentPeriodEnd, new Date(now.getTime() - GRACE_PERIOD_DAYS * DAY_MS)),
        )),
        enrich: enrichSuspension,
        claim: (row) => claimSuspensionStamp(row.subscriptionId),
        release: (row) => releaseSuspensionStamp(row.subscriptionId),
        idempotencyKey: (row) => `service_suspended:${row.externalSubscriptionId}`,
        composeEmail: (row, lang, name, extra) => serviceSuspendedEmailTemplate({
            lang,
            name,
            // Non-null by the query's isNotNull bound.
            stoppedSinceLabel: formatDateLong(graceEnd(row.currentPeriodEnd as Date), lang),
            ctaUrl: extra?.ctaUrl ?? pricingUrl(lang),
            ctaVariant: extra?.ctaVariant ?? 'resubscribe',
        }),
    });

    const renewalFailed = await runLifecycleNoticeSweep<RenewalFailedExtra>({
        label: '[DunningRenewalFailed]',
        cronTag: 'dunning_notices',
        noticeName: 'Renewal-failed',
        emailType: 'payment_failed',
        deliveryMode: 'email-primary',
        startMeta: { graceDays: GRACE_PERIOD_DAYS, backfill: true },
        fetchDue: (now) => selectDueRows(and(
            eq(subscriptions.paymentMethod, 'stripe'),
            eq(subscriptions.status, 'past_due'),
            isNull(subscriptions.renewalFailureNotifiedAt),
            or(
                isNull(subscriptions.currentPeriodEnd),
                gt(subscriptions.currentPeriodEnd, new Date(now.getTime() - GRACE_PERIOD_DAYS * DAY_MS)),
            ),
        )),
        enrich: enrichRenewalFailed,
        claim: (row) => claimRenewalFailureStamp(row.subscriptionId),
        release: (row) => releaseRenewalFailureStamp(row.subscriptionId),
        idempotencyKey: (row, extra) => `payment_failed:${extra?.invoiceId ?? row.externalSubscriptionId}`,
        composeEmail: (row, lang, name, extra) => paymentFailedEmailTemplate({
            lang,
            name,
            amountLabel: extra?.amountLabel ?? null,
            graceEndLabel: row.currentPeriodEnd ? formatDateLong(graceEnd(row.currentPeriodEnd), lang) : null,
            payUrl: extra?.payUrl ?? dashboardUrl(),
        }),
    });

    logger.info('[Dunning] Run complete', {
        suspended: { due: suspended.due, emailed: suspended.emailed, errors: suspended.errors },
        renewalFailed: { due: renewalFailed.due, emailed: renewalFailed.emailed, errors: renewalFailed.errors },
    });

    return { suspended, renewalFailed };
}

/**
 * Shared per-row Stripe fetch for the sweeps. Returning null skips the row
 * WITHOUT stamping — the miss stays visible in Sentry daily until an admin
 * reconciles, never silently marked notified.
 */
async function fetchStripeStateForRow(
    row: LifecycleNoticeRow,
    branch: 'suspension' | 'renewal',
): Promise<{ stripeSub: Stripe.Subscription; invoice: Stripe.Invoice | null } | null> {
    if (!row.externalSubscriptionId) {
        captureError(null, 'Dunning sweep: stripe row has no external subscription id', {
            tags: { cron: 'dunning_notices' },
            level: 'warning',
            extra: { subscriptionId: row.subscriptionId, branch },
        });
        return null;
    }
    const stripeSub = await stripeService.getSubscriptionWithLatestInvoice(row.externalSubscriptionId);
    return { stripeSub, invoice: getExpandedLatestInvoice(stripeSub) };
}

/**
 * Renewal branch: drift guards — the "renewal failed, service still runs"
 * email must only go to a row whose Stripe side agrees an open invoice awaits.
 */
async function enrichRenewalFailed(row: LifecycleNoticeRow): Promise<RenewalFailedExtra | null> {
    const state = await fetchStripeStateForRow(row, 'renewal');
    if (!state) return null;
    const { stripeSub, invoice } = state;

    if (stripeSub.status === 'canceled') {
        captureError(null, 'Dunning sweep: row past_due locally but canceled at Stripe (missed webhook?)', {
            tags: { cron: 'dunning_notices' },
            level: 'warning',
            extra: { subscriptionId: row.subscriptionId, stripeSubscriptionId: row.externalSubscriptionId },
        });
        return null;
    }
    if (!invoice || invoice.status !== 'open') {
        captureError(null, 'Dunning sweep: no open invoice for past_due row', {
            tags: { cron: 'dunning_notices' },
            level: 'warning',
            extra: { subscriptionId: row.subscriptionId, invoiceStatus: invoice?.status ?? 'missing' },
        });
        return null;
    }

    const amount = getInvoiceAmountDue(invoice);
    const lang = resolveLocale(row.dashboardLanguage);
    return {
        payUrl: getInvoiceHostedUrl(invoice) ?? dashboardUrl(),
        amountLabel: amount ? formatMoney(amount.amountCents, amount.currency, lang) : null,
        invoiceId: typeof invoice.id === 'string' ? invoice.id : null,
    };
}

/**
 * Suspension branch: the notice is correct whatever Stripe's state — the
 * merchant HAS lost replies. Stripe only decides the CTA: a still-open
 * invoice is payable (canceled subs' invoices are not).
 */
async function enrichSuspension(row: LifecycleNoticeRow): Promise<SuspensionExtra | null> {
    const state = await fetchStripeStateForRow(row, 'suspension');
    if (!state) return null;
    const { stripeSub, invoice } = state;

    if (stripeSub.status !== 'canceled' && invoice && invoice.status === 'open') {
        const hosted = getInvoiceHostedUrl(invoice);
        if (hosted) return { ctaUrl: hosted, ctaVariant: 'pay' };
    }
    return { ctaUrl: pricingUrl(resolveLocale(row.dashboardLanguage)), ctaVariant: 'resubscribe' };
}
