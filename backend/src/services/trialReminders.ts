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
 *     the reminder query's `trial_ends_at > now` bound is what enforces that
 *     (and the ended sweep's ENDED_LOOKBACK_DAYS bound is its mirror), so
 *     widening either window later must not drop them.
 *
 * Idempotency: each sweep stamps its own column (`trial_ending_notified_at` /
 * `trial_ended_notified_at`) once the in-app notification has landed, and its
 * query skips stamped rows. The daily cadence would otherwise notify the same
 * merchant repeatedly.
 */
import { and, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '../db';
import { subscriptions, users, settings } from '../db/schema';
import { emailService } from './email';
import type { EmailType } from './email';
import { notificationService, NOTIFICATION_TEMPLATES } from './notifications';
import type { NotificationPayload } from './notifications';
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
    /** Subscriptions inside the sweep's window that had not been notified yet. */
    due: number;
    /** In-app notifications successfully created. */
    notified: number;
    /** Emails successfully sent (≤ notified; email is best-effort). */
    emailed: number;
    /** Subscriptions left un-stamped because the in-app notification failed. */
    errors: number;
}

/** The projection both sweeps select — one merchant-facing trial row. */
interface LifecycleNoticeRow {
    subscriptionId: string;
    userId: string;
    trialEndsAt: Date | null;
    email: string | null;
    name: string | null;
    dashboardLanguage: string | null;
}

/**
 * Everything that differs between the two sweeps. Keeping the delivery loop in
 * ONE place (runLifecycleNoticeSweep) is deliberate: the retry semantics —
 * in-app failure leaves the row un-stamped for tomorrow, email is best-effort —
 * are the part that must never diverge between sweeps, the way a fix applied to
 * one hand-copied loop and not the other would. `subscription_expiring` (still
 * missing, see docs/notifications-roadmap.md) should become a third config.
 */
interface LifecycleNoticeConfig {
    /** Log-line prefix, e.g. '[TrialReminders]'. */
    label: string;
    /** Sentry `cron` tag. */
    cronTag: string;
    /** Human prefix for Sentry messages, e.g. 'Trial-ending'. */
    noticeName: string;
    emailType: EmailType;
    /** Extra fields for the start-of-run log line. */
    startMeta: Record<string, unknown>;
    fetchDue(now: Date): Promise<LifecycleNoticeRow[]>;
    /** Bell/push payload for a row, or null to skip the row entirely. */
    composeNotification(row: LifecycleNoticeRow): NotificationPayload | null;
    /** Email content; only called when the row has an email address. */
    composeEmail(row: LifecycleNoticeRow, lang: 'ar' | 'en', name: string): { subject: string; html: string };
    /** The sweep's own idempotency stamp — sweeps must never share one. */
    stamp(): Partial<typeof subscriptions.$inferInsert>;
}

/** Shared SELECT for both sweeps — only the WHERE differs per config. */
function selectDueRows(where: SQL | undefined): Promise<LifecycleNoticeRow[]> {
    return db
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
        .where(where);
}

function pricingUrl(lang: 'ar' | 'en'): string {
    return `${config.frontendUrl}/${lang}/pricing`;
}

/**
 * The delivery loop both sweeps share.
 *
 * Per row: in-app notification first — a failure is the only retryable case
 * (the row stays un-stamped, so tomorrow's run tries again). Email second and
 * best-effort by design: the merchant has already been told in-app, and
 * retrying the email tomorrow would re-send the bell row too, so a failed send
 * is captured, not retried. The stamp lands last.
 */
async function runLifecycleNoticeSweep(cfg: LifecycleNoticeConfig): Promise<TrialReminderResult> {
    const startedAt = Date.now();
    const now = new Date();

    logger.info(`${cfg.label} Starting run`, cfg.startMeta);

    const rows = await cfg.fetchDue(now);
    const result: TrialReminderResult = { due: rows.length, notified: 0, emailed: 0, errors: 0 };

    for (const row of rows) {
        const notification = cfg.composeNotification(row);
        if (!notification) continue;

        const lang = resolveLocale(row.dashboardLanguage);

        try {
            await notificationService.sendNotification(row.userId, notification);
            result.notified++;
        } catch (err) {
            result.errors++;
            logger.error(`${cfg.label} In-app notification failed`, {
                subscriptionId: row.subscriptionId,
                userId: row.userId,
                error: String(err),
            });
            captureError(err, `${cfg.noticeName} notification failed`, {
                tags: { cron: cfg.cronTag },
                level: 'error',
                extra: { subscriptionId: row.subscriptionId, userId: row.userId },
            });
            continue;
        }

        if (row.email) {
            const { subject, html } = cfg.composeEmail(row, lang, row.name || row.email.split('@')[0]);

            const send = await emailService.send({
                to: row.email,
                subject,
                html,
                type: cfg.emailType,
                userId: row.userId,
            });

            if (send.success) {
                result.emailed++;
            } else {
                logger.error(`${cfg.label} Email failed`, {
                    subscriptionId: row.subscriptionId,
                    userId: row.userId,
                    error: send.error,
                });
                captureError(
                    new Error(`${cfg.noticeName} email failed: ${send.error ?? 'unknown'}`),
                    `${cfg.noticeName} email failed`,
                    {
                        tags: { cron: cfg.cronTag },
                        level: 'warning',
                        extra: { subscriptionId: row.subscriptionId, userId: row.userId, resendError: send.error },
                    },
                );
            }
        }

        await db
            .update(subscriptions)
            .set(cfg.stamp())
            .where(eq(subscriptions.id, row.subscriptionId));

        logger.info(`${cfg.label} Notified merchant`, {
            subscriptionId: row.subscriptionId,
            userId: row.userId,
            trialEndsAt: row.trialEndsAt?.toISOString(),
            lang,
            emailed: Boolean(row.email),
        });
    }

    logger.info(`${cfg.label} Run complete`, { ...result, durationMs: Date.now() - startedAt });
    return result;
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
 * Run the daily trial-ending reminder sweep.
 *
 * Idempotent via `trial_ending_notified_at`; the `gt(now)` bound is the
 * no-backfill guarantee — an already-expired trial can never enter the result
 * set, however wide the window becomes.
 */
export function runTrialEndingReminders(): Promise<TrialReminderResult> {
    return runLifecycleNoticeSweep({
        label: '[TrialReminders]',
        cronTag: 'trial_reminders',
        noticeName: 'Trial-ending',
        emailType: 'trial_ending',
        startMeta: { leadDays: REMINDER_LEAD_DAYS },
        fetchDue: (now) => selectDueRows(and(
            eq(subscriptions.status, 'trialing'),
            isNull(subscriptions.trialEndingNotifiedAt),
            gt(subscriptions.trialEndsAt, now),
            lte(subscriptions.trialEndsAt, new Date(now.getTime() + REMINDER_LEAD_DAYS * DAY_MS)),
        )),
        // Narrowed by the query, but the column is nullable in the schema —
        // a null date row is skipped rather than notified with broken copy.
        composeNotification: (row) => row.trialEndsAt
            ? {
                type: 'trial_ending',
                titles: NOTIFICATION_TEMPLATES.trial_ending.titles,
                bodies: buildTrialEndingBodies(row.trialEndsAt),
            }
            : null,
        composeEmail: (row, lang, name) => trialEndingEmailTemplate({
            lang,
            name,
            // Non-null: composeNotification already skipped null-date rows.
            trialEndLabel: formatDateLong(row.trialEndsAt as Date, lang),
            pricingUrl: pricingUrl(lang),
        }),
        stamp: () => ({ trialEndingNotifiedAt: new Date() }),
    });
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
 */
export function runTrialEndedNotices(): Promise<TrialReminderResult> {
    return runLifecycleNoticeSweep({
        label: '[TrialEnded]',
        cronTag: 'trial_ended_notices',
        noticeName: 'Trial-ended',
        emailType: 'trial_ended',
        startMeta: { lookbackDays: ENDED_LOOKBACK_DAYS },
        fetchDue: (now) => selectDueRows(and(
            inArray(subscriptions.status, ['trialing', 'past_due']),
            isNull(subscriptions.paymentMethod),
            isNull(subscriptions.trialEndedNotifiedAt),
            lte(subscriptions.trialEndsAt, now),
            gt(subscriptions.trialEndsAt, new Date(now.getTime() - ENDED_LOOKBACK_DAYS * DAY_MS)),
        )),
        // Variable-free template: the persisted bodies are used as-is — no
        // per-locale formatting pass like buildTrialEndingBodies.
        composeNotification: () => ({
            type: 'trial_ended',
            titles: NOTIFICATION_TEMPLATES.trial_ended.titles,
            bodies: NOTIFICATION_TEMPLATES.trial_ended.bodies,
        }),
        composeEmail: (_row, lang, name) => trialEndedEmailTemplate({
            lang,
            name,
            pricingUrl: pricingUrl(lang),
        }),
        stamp: () => ({ trialEndedNotifiedAt: new Date() }),
    });
}
