/**
 * Trial lifecycle notices: the ENDING reminder and the ENDED "last try".
 *
 * Two daily sweeps (cron, registered in index.ts), each through two channels —
 * an in-app notification (bell row + push) and an email:
 *   1. runTrialEndingReminders — REMINDER_LEAD_DAYS before `trial_ends_at`
 *   2. runTrialEndedNotices — after `trial_ends_at`, once the reply gate has
 *      closed: the final conversion touch, sent proactively because the
 *      reactive auto_reply_paused_billing notification only fires if a
 *      customer happens to write in
 *
 * Why this exists: before it, nothing on the platform ever told a merchant their
 * trial was about to end. `trial_ends_at` was only ever read lazily — the status
 * flips `trialing → past_due` the next time the subscription is fetched — so the
 * first signal a merchant got was replies quietly stopping. On 2026-07-31, 30 of
 * 52 `trialing` subscriptions were already past their `trial_ends_at` and had
 * sent zero replies in the preceding two weeks.
 *
 * Scope, deliberately narrow (owner's ruling, 2026-07-31):
 *   - ONE reminder, REMINDER_LEAD_DAYS before expiry. No second/last-day nudge.
 *   - No backfill. Trials that already expired are never warned retroactively —
 *     the query's `trial_ends_at > now` bound is what enforces that, so widening
 *     the window later must not drop it.
 *
 * Idempotency: `subscriptions.trial_ending_notified_at` is stamped once the
 * in-app notification has landed, and the query skips stamped rows. The daily
 * cadence over a 3-day window would otherwise warn the same merchant three
 * times.
 */
import { and, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import { db } from '../db';
import { subscriptions, users, settings } from '../db/schema';
import { emailService } from './email';
import { notificationService, NOTIFICATION_TEMPLATES } from './notifications';
import { trialEndingEmailTemplate, trialEndedEmailTemplate } from '../utils/emailTemplates';
import { captureError } from '../utils/sentryHelpers';
import { config } from '../config';
import { resolveLocale } from '../utils/i18n';
import { formatDateLong } from '../utils/formatDate';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';

/** How many days before `trial_ends_at` the single reminder goes out. */
export const REMINDER_LEAD_DAYS = 3;
/**
 * How far back the trial-ENDED sweep looks. This bound is the no-backfill
 * guarantee for the second sweep (mirror of `gt(now)` in the first): a trial
 * that expired before the lookback window — e.g. the ~30 long-expired rows in
 * prod when this shipped — is never noticed retroactively, however long the
 * job was down. Anything expiring from now on is caught within one daily run.
 */
export const ENDED_LOOKBACK_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

let logger: Logger = noopLogger;
export function setTrialRemindersLogger(l: Logger): void { logger = l; }

export interface TrialReminderResult {
    /** Subscriptions inside the reminder window that had not been warned yet. */
    due: number;
    /** In-app notifications successfully created. */
    notified: number;
    /** Reminder emails successfully sent (≤ notified; email is best-effort). */
    emailed: number;
    /** Subscriptions left un-stamped because the in-app notification failed. */
    errors: number;
}

/**
 * Build the in-app notification body for every locale the template carries,
 * formatting the date separately in each.
 *
 * `sendTemplateNotification` can't be used here: it applies ONE variables map to
 * all locales, and the bell row persists every locale (the client renders the
 * one matching the current UI language). A single pre-formatted date would show
 * an Arabic date to a merchant who switches the dashboard to English.
 *
 * Iterating the template's own locale keys keeps this correct when a third
 * language is added, instead of hard-coding ar/en here.
 */
export function buildTrialEndingBodies(trialEndsAt: Date): Record<string, string> {
    return Object.fromEntries(
        Object.entries(NOTIFICATION_TEMPLATES.trial_ending.bodies).map(([locale, text]) => [
            locale,
            text.replace('{trialEnd}', formatDateLong(trialEndsAt, locale)),
        ]),
    );
}

/**
 * Run the daily trial-ending reminder job.
 *
 * Idempotent: each subscription is stamped after its in-app notification lands,
 * so a re-run (restart, manual invocation) is a no-op for anyone already warned.
 */
export async function runTrialEndingReminders(): Promise<TrialReminderResult> {
    const startedAt = Date.now();
    const now = new Date();
    const windowEnd = new Date(now.getTime() + REMINDER_LEAD_DAYS * DAY_MS);

    logger.info('[TrialReminders] Starting run', { leadDays: REMINDER_LEAD_DAYS });

    const rows = await db
        .select({
            subscriptionId: subscriptions.id,
            userId: subscriptions.userId,
            trialEndsAt: subscriptions.trialEndsAt,
            email: users.email,
            name: users.name,
            dashboardLanguage: settings.dashboardLanguage,
        })
        .from(subscriptions)
        .innerJoin(users, eq(users.id, subscriptions.userId))
        .leftJoin(settings, eq(settings.userId, subscriptions.userId))
        .where(and(
            eq(subscriptions.status, 'trialing'),
            isNull(subscriptions.trialEndingNotifiedAt),
            // `gt(now)` is the no-backfill guarantee: an already-expired trial is
            // never in the result set, however wide the window becomes.
            gt(subscriptions.trialEndsAt, now),
            lte(subscriptions.trialEndsAt, windowEnd),
        ));

    const result: TrialReminderResult = { due: rows.length, notified: 0, emailed: 0, errors: 0 };

    for (const row of rows) {
        // Narrowed by the query, but the column is nullable in the schema.
        if (!row.trialEndsAt) continue;

        const lang = resolveLocale(row.dashboardLanguage);
        const trialEndLabel = formatDateLong(row.trialEndsAt, lang);

        try {
            await notificationService.sendNotification(row.userId, {
                type: 'trial_ending',
                titles: NOTIFICATION_TEMPLATES.trial_ending.titles,
                bodies: buildTrialEndingBodies(row.trialEndsAt),
            });
            result.notified++;
        } catch (err) {
            // Not stamped — the merchant has been told nothing, so tomorrow's run
            // must try again. This is the only retryable failure in the job.
            result.errors++;
            logger.error('[TrialReminders] In-app notification failed', {
                subscriptionId: row.subscriptionId,
                userId: row.userId,
                error: String(err),
            });
            captureError(err, 'Trial-ending notification failed', {
                tags: { cron: 'trial_reminders' },
                level: 'error',
                extra: { subscriptionId: row.subscriptionId, userId: row.userId },
            });
            continue;
        }

        // Email is the second channel, and best-effort by design: the merchant has
        // already been warned in-app, and retrying the email tomorrow would mean
        // re-sending the bell row too. A failure is captured, not retried.
        if (row.email) {
            const { subject, html } = trialEndingEmailTemplate({
                lang,
                name: row.name || row.email.split('@')[0],
                trialEndLabel,
                pricingUrl: `${config.frontendUrl}/${lang}/pricing`,
            });

            const send = await emailService.send({
                to: row.email,
                subject,
                html,
                type: 'trial_ending',
                userId: row.userId,
            });

            if (send.success) {
                result.emailed++;
            } else {
                logger.error('[TrialReminders] Reminder email failed', {
                    subscriptionId: row.subscriptionId,
                    userId: row.userId,
                    error: send.error,
                });
                captureError(
                    new Error(`Trial-ending email failed: ${send.error ?? 'unknown'}`),
                    'Trial-ending email failed',
                    {
                        tags: { cron: 'trial_reminders' },
                        level: 'warning',
                        extra: { subscriptionId: row.subscriptionId, userId: row.userId, resendError: send.error },
                    },
                );
            }
        }

        await db
            .update(subscriptions)
            .set({ trialEndingNotifiedAt: new Date() })
            .where(eq(subscriptions.id, row.subscriptionId));

        logger.info('[TrialReminders] Warned merchant', {
            subscriptionId: row.subscriptionId,
            userId: row.userId,
            trialEndsAt: row.trialEndsAt.toISOString(),
            lang,
            emailed: Boolean(row.email),
        });
    }

    logger.info('[TrialReminders] Run complete', { ...result, durationMs: Date.now() - startedAt });
    return result;
}

/**
 * Run the daily trial-ENDED notice — the "last try" conversion touch.
 *
 * Fires once per trial, after `trial_ends_at` has passed and the reply gate has
 * closed (checkSubscriptionStatus blocks expired no-payment-method trials with
 * no grace). Without it, the only expiry signal is `auto_reply_paused_billing`,
 * which is reactive: it fires on the next inbound customer message, so a
 * merchant nobody writes to is never told their replies stopped.
 *
 * Row selection:
 *   - status IN ('trialing','past_due'): an expired trial sits in 'trialing'
 *     until getUserSubscription lazily flips it, and in 'past_due' after. Both
 *     are the same merchant state; 'canceled' (explicit cancel, or the
 *     trial-consumed anti-abuse shape) is deliberately excluded.
 *   - payment_method IS NULL: converted subscriptions (stripe/shopify/manual)
 *     are not trials anymore, whatever their trial_ends_at says.
 *   - the ENDED_LOOKBACK_DAYS bound is the no-backfill guard (see its doc).
 *
 * Channel semantics match runTrialEndingReminders: in-app first (a failure
 * leaves the row un-stamped for tomorrow), email best-effort after.
 */
export async function runTrialEndedNotices(): Promise<TrialReminderResult> {
    const startedAt = Date.now();
    const now = new Date();
    const lookbackStart = new Date(now.getTime() - ENDED_LOOKBACK_DAYS * DAY_MS);

    logger.info('[TrialEnded] Starting run', { lookbackDays: ENDED_LOOKBACK_DAYS });

    const rows = await db
        .select({
            subscriptionId: subscriptions.id,
            userId: subscriptions.userId,
            trialEndsAt: subscriptions.trialEndsAt,
            email: users.email,
            name: users.name,
            dashboardLanguage: settings.dashboardLanguage,
        })
        .from(subscriptions)
        .innerJoin(users, eq(users.id, subscriptions.userId))
        .leftJoin(settings, eq(settings.userId, subscriptions.userId))
        .where(and(
            inArray(subscriptions.status, ['trialing', 'past_due']),
            isNull(subscriptions.paymentMethod),
            isNull(subscriptions.trialEndedNotifiedAt),
            lte(subscriptions.trialEndsAt, now),
            gt(subscriptions.trialEndsAt, lookbackStart),
        ));

    const result: TrialReminderResult = { due: rows.length, notified: 0, emailed: 0, errors: 0 };

    for (const row of rows) {
        const lang = resolveLocale(row.dashboardLanguage);

        try {
            // The template is variable-free, so the persisted bodies can be used
            // as-is — no per-locale formatting pass like buildTrialEndingBodies.
            await notificationService.sendNotification(row.userId, {
                type: 'trial_ended',
                titles: NOTIFICATION_TEMPLATES.trial_ended.titles,
                bodies: NOTIFICATION_TEMPLATES.trial_ended.bodies,
            });
            result.notified++;
        } catch (err) {
            result.errors++;
            logger.error('[TrialEnded] In-app notification failed', {
                subscriptionId: row.subscriptionId,
                userId: row.userId,
                error: String(err),
            });
            captureError(err, 'Trial-ended notification failed', {
                tags: { cron: 'trial_ended_notices' },
                level: 'error',
                extra: { subscriptionId: row.subscriptionId, userId: row.userId },
            });
            continue;
        }

        if (row.email) {
            const { subject, html } = trialEndedEmailTemplate({
                lang,
                name: row.name || row.email.split('@')[0],
                pricingUrl: `${config.frontendUrl}/${lang}/pricing`,
            });

            const send = await emailService.send({
                to: row.email,
                subject,
                html,
                type: 'trial_ended',
                userId: row.userId,
            });

            if (send.success) {
                result.emailed++;
            } else {
                logger.error('[TrialEnded] Last-try email failed', {
                    subscriptionId: row.subscriptionId,
                    userId: row.userId,
                    error: send.error,
                });
                captureError(
                    new Error(`Trial-ended email failed: ${send.error ?? 'unknown'}`),
                    'Trial-ended email failed',
                    {
                        tags: { cron: 'trial_ended_notices' },
                        level: 'warning',
                        extra: { subscriptionId: row.subscriptionId, userId: row.userId, resendError: send.error },
                    },
                );
            }
        }

        await db
            .update(subscriptions)
            .set({ trialEndedNotifiedAt: new Date() })
            .where(eq(subscriptions.id, row.subscriptionId));

        logger.info('[TrialEnded] Notified merchant', {
            subscriptionId: row.subscriptionId,
            userId: row.userId,
            trialEndsAt: row.trialEndsAt?.toISOString(),
            lang,
            emailed: Boolean(row.email),
        });
    }

    logger.info('[TrialEnded] Run complete', { ...result, durationMs: Date.now() - startedAt });
    return result;
}
