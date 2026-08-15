/**
 * Shared engine for subscription-lifecycle notice sweeps.
 *
 * Extracted from services/trialReminders.ts so every daily "tell the merchant
 * about their subscription" job runs ONE delivery loop instead of hand-copied
 * variants that drift apart. Current consumers: the two trial sweeps
 * (trialReminders.ts) and the dunning sweeps (dunningNotices.ts).
 *
 * Two delivery modes, chosen per config:
 *
 * - 'inapp-primary' (default; the trial sweeps, byte-identical to their
 *   pre-extraction behavior): in-app notification first — its failure is the
 *   only retryable case (row stays un-stamped for tomorrow). Email second and
 *   best-effort: the merchant has already been told in-app, and retrying the
 *   email tomorrow would re-send the bell row too. `stamp()` lands last.
 *
 * - 'email-primary' (the dunning sweeps): email IS the notice — there is no
 *   in-app send. Per row: `enrich` (optional async fetch; null/throw skips the
 *   row un-stamped so tomorrow retries) → `claim` (atomic stamp BEFORE the
 *   send, because a webhook path races the sweep for the same stamp) →
 *   `trySend` (never `send`: a network throw would abort the sweep) →
 *   delivered keeps the stamp, anything else `release`s it back to NULL.
 */
import { eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '../db';
import { subscriptions, users, settings } from '../db/schema';
import { emailService } from './email';
import type { EmailType } from './email';
import { notificationService } from './notifications';
import type { NotificationPayload } from './notifications';
import { captureError } from '../utils/sentryHelpers';
import { resolveLocale } from '../utils/i18n';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';

let logger: Logger = noopLogger;
export function setLifecycleSweepLogger(l: Logger): void { logger = l; }

export interface LifecycleNoticeResult {
    /** Subscriptions inside the sweep's window that had not been notified yet. */
    due: number;
    /** Merchants successfully notified on the sweep's primary channel. */
    notified: number;
    /** Emails successfully sent (inapp-primary: ≤ notified; email-primary: = notified). */
    emailed: number;
    /** Rows left un-stamped for tomorrow because the primary channel failed. */
    errors: number;
}

/** The projection every sweep selects — one merchant-facing subscription row. */
export interface LifecycleNoticeRow {
    subscriptionId: string;
    userId: string;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    externalSubscriptionId: string | null;
    email: string | null;
    name: string | null;
    dashboardLanguage: string | null;
}

/**
 * Everything that differs between sweeps. Keeping the delivery loop in ONE
 * place is deliberate: the retry semantics are the part that must never
 * diverge between sweeps, the way a fix applied to one hand-copied loop and
 * not the other would.
 */
export interface LifecycleNoticeConfig<TExtra = unknown> {
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
    /** Delivery semantics — see the module doc. Defaults to 'inapp-primary'. */
    deliveryMode?: 'inapp-primary' | 'email-primary';

    // --- inapp-primary members -------------------------------------------
    /** Bell/push payload for a row, or null to skip the row entirely. */
    composeNotification?(row: LifecycleNoticeRow): NotificationPayload | null;
    /** The sweep's own idempotency stamp — sweeps must never share one. */
    stamp?(): Partial<typeof subscriptions.$inferInsert>;

    // --- email-primary members -------------------------------------------
    /**
     * Per-row async data fetch (e.g. the Stripe invoice). Returning null or
     * throwing skips the row WITHOUT stamping — it stays visible to tomorrow's
     * run instead of being silently swallowed.
     */
    enrich?(row: LifecycleNoticeRow): Promise<TExtra | null>;
    /** Atomically claim the row's stamp; false = another trigger owns it. */
    claim?(row: LifecycleNoticeRow): Promise<boolean>;
    /** Release a claimed stamp after a send that provably did not go out. */
    release?(row: LifecycleNoticeRow): Promise<void>;
    /** Resend Idempotency-Key (24h provider-side dedup across triggers). */
    idempotencyKey?(row: LifecycleNoticeRow, extra: TExtra | undefined): string;

    /** Email content; only called when the row has an email address. */
    composeEmail(row: LifecycleNoticeRow, lang: 'ar' | 'en', name: string, extra?: TExtra): { subject: string; html: string };
}

/** Shared SELECT for every sweep — only the WHERE differs per config. */
export function selectDueRows(where: SQL | undefined): Promise<LifecycleNoticeRow[]> {
    return db
        .select({
            subscriptionId: subscriptions.id,
            userId: subscriptions.userId,
            trialEndsAt: subscriptions.trialEndsAt,
            currentPeriodEnd: subscriptions.currentPeriodEnd,
            externalSubscriptionId: subscriptions.externalSubscriptionId,
            email: users.email,
            name: users.name,
            dashboardLanguage: settings.dashboardLanguage,
        })
        .from(subscriptions)
        .innerJoin(users, eq(users.id, subscriptions.userId))
        .leftJoin(settings, eq(settings.userId, subscriptions.userId))
        .where(where);
}

/** The delivery loop every sweep shares. */
export async function runLifecycleNoticeSweep<TExtra>(cfg: LifecycleNoticeConfig<TExtra>): Promise<LifecycleNoticeResult> {
    const startedAt = Date.now();
    const now = new Date();

    logger.info(`${cfg.label} Starting run`, cfg.startMeta);

    const rows = await cfg.fetchDue(now);
    const result: LifecycleNoticeResult = { due: rows.length, notified: 0, emailed: 0, errors: 0 };

    for (const row of rows) {
        if ((cfg.deliveryMode ?? 'inapp-primary') === 'email-primary') {
            await deliverEmailPrimary(cfg, row, result);
            continue;
        }

        const notification = cfg.composeNotification?.(row);
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
            .set(cfg.stamp?.() ?? {})
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
 * One email-primary row. Wrapped so any per-row failure — enrich, claim, the
 * send itself — is captured and the loop continues; a single broken row must
 * never starve the rest of the sweep.
 */
async function deliverEmailPrimary<TExtra>(
    cfg: LifecycleNoticeConfig<TExtra>,
    row: LifecycleNoticeRow,
    result: LifecycleNoticeResult,
): Promise<void> {
    try {
        if (!row.email) {
            // No address to deliver the primary channel to — skip WITHOUT
            // stamping so the row stays visible (Sentry, daily) until an admin
            // fixes the account instead of being silently marked notified.
            result.errors++;
            captureError(null, `${cfg.noticeName} row has no email address`, {
                tags: { cron: cfg.cronTag },
                level: 'warning',
                extra: { subscriptionId: row.subscriptionId, userId: row.userId },
            });
            return;
        }

        let extra: TExtra | undefined;
        if (cfg.enrich) {
            const enriched = await cfg.enrich(row);
            if (enriched === null) {
                result.errors++;
                return; // enrich captured its own context; row stays un-stamped
            }
            extra = enriched;
        }

        if (cfg.claim && !(await cfg.claim(row))) return; // another trigger owns this episode

        const lang = resolveLocale(row.dashboardLanguage);
        const { subject, html } = cfg.composeEmail(row, lang, row.name || row.email.split('@')[0], extra);

        const send = await emailService.trySend({
            to: row.email,
            subject,
            html,
            type: cfg.emailType,
            userId: row.userId,
            ...(cfg.idempotencyKey ? { idempotencyKey: cfg.idempotencyKey(row, extra) } : {}),
        });

        if (send.delivered) {
            result.notified++;
            result.emailed++;
            logger.info(`${cfg.label} Emailed merchant`, {
                subscriptionId: row.subscriptionId,
                userId: row.userId,
                lang,
            });
            return;
        }

        result.errors++;
        await cfg.release?.(row);
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
    } catch (err) {
        result.errors++;
        captureError(err, `${cfg.noticeName} sweep row failed`, {
            tags: { cron: cfg.cronTag },
            level: 'error',
            extra: { subscriptionId: row.subscriptionId, userId: row.userId },
        });
    }
}
