/**
 * Trial-ending reminder service.
 *
 * Runs once per day (via cron, registered in index.ts). Warns every merchant
 * whose free trial ends within REMINDER_LEAD_DAYS, through two channels:
 *   1. an in-app notification (the bell row, plus a push if they have a device)
 *   2. an email
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
import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import { db } from '../db';
import { subscriptions, users, settings } from '../db/schema';
import { emailService } from './email';
import { notificationService, NOTIFICATION_TEMPLATES } from './notifications';
import { trialEndingEmailTemplate } from '../utils/emailTemplates';
import { captureError } from '../utils/sentryHelpers';
import { config } from '../config';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';

/** How many days before `trial_ends_at` the single reminder goes out. */
export const REMINDER_LEAD_DAYS = 3;
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
 * Human-readable trial end date, in the given locale.
 * Date only — the exact hour is noise for a "three days left" reminder.
 * Shared by both channels so the email and the bell row can never disagree.
 */
export function formatTrialEndDate(d: Date, lang: string): string {
    try {
        return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long' }).format(d);
    } catch {
        return d.toISOString().slice(0, 10);
    }
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
            text.replace('{trialEnd}', formatTrialEndDate(trialEndsAt, locale)),
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

        const lang: 'ar' | 'en' = row.dashboardLanguage === 'en' ? 'en' : 'ar';
        const trialEndLabel = formatTrialEndDate(row.trialEndsAt, lang);

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
