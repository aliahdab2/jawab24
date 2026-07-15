/**
 * Trial lifecycle emails — a single daily job with two stages:
 *
 *   Stage A (reminder): T-3 days before trial end, while the merchant can still
 *     act. Activation-aware — value-led if they've used it, a "switch it on"
 *     nudge if they haven't (targets the activation leak).
 *   Stage B (win-back): on/just after trial end, for trials that did NOT convert
 *     to a paid (active) subscription. Includes 1-click churn-reason links.
 *
 * Each stage stamps its own idempotency column on `subscriptions`
 * (trial_reminder_emailed_at / trial_ended_emailed_at) once the email is sent OR
 * terminally skipped (no email / unsubscribed), so a merchant is never emailed
 * twice per stage. Transient send failures do NOT stamp — retried next run.
 *
 * Trial expiry is lazy in this codebase (status flips only on read — see
 * subscriptions.getUserSubscription), so both stages key off `trial_ends_at`
 * windows, not the status transition.
 */
import { and, eq, gt, lt, gte, lte, isNull, inArray } from 'drizzle-orm';
import { db } from '../db';
import { subscriptions, users, settings } from '../db/schema';
import { emailService, type EmailType } from './email';
import { trialLifecycleEmailTemplate } from '../utils/emailTemplates';
import { analyticsService } from './analytics';
import { isEmailSuppressed } from '../utils/emailSuppression';
import { generateTrialFeedbackToken, generateUnsubscribeToken } from '../utils/tokens';
import { t, type MessageKey } from '../utils/i18n';
import { captureError } from '../utils/sentryHelpers';
import { config } from '../config';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';

let logger: Logger = noopLogger;
export function setTrialLifecycleLogger(l: Logger): void { logger = l; }

let intervalHandle: NodeJS.Timeout | null = null;
const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
const REMINDER_LEAD_DAYS = 3;

const FEEDBACK_REASONS: ReadonlyArray<{ slug: string; key: MessageKey }> = [
    { slug: 'too_expensive', key: 'trialFeedbackTooExpensive' },
    { slug: 'didnt_work', key: 'trialFeedbackDidntWork' },
    { slug: 'too_complex', key: 'trialFeedbackTooComplex' },
    { slug: 'just_testing', key: 'trialFeedbackJustTesting' },
];

type Variant = 'reminder' | 'ended';
interface StageResult { sent: number; skipped: number; errors: number; }
interface Candidate {
    subId: string;
    userId: string;
    email: string | null;
    dashboardLanguage: string | null;
    trialEndsAt: Date | null;
    trialStart: Date;
}

async function stamp(subId: string, variant: Variant): Promise<void> {
    await db.update(subscriptions)
        .set(variant === 'reminder' ? { trialReminderEmailedAt: new Date() } : { trialEndedEmailedAt: new Date() })
        .where(eq(subscriptions.id, subId));
}

/** Send (or terminally skip) one candidate. Returns which counter to bump. */
async function processCandidate(variant: Variant, c: Candidate, now: Date): Promise<'sent' | 'skipped' | 'error'> {
    // Terminal skips — stamp so we never reconsider this row.
    if (!c.email) {
        await stamp(c.subId, variant);
        return 'skipped';
    }
    if (await isEmailSuppressed(c.email)) {
        await stamp(c.subId, variant);
        return 'skipped';
    }

    const lang: 'ar' | 'en' = c.dashboardLanguage === 'en' ? 'en' : 'ar';
    const to = variant === 'reminder' ? now : (c.trialEndsAt ?? now);
    const stats = await analyticsService.getTrialRecapStats(c.userId, c.trialStart, to);

    const upgradeUrl = `${config.frontendUrl}/${lang}/pricing`;
    const dashboardUrl = `${config.frontendUrl}/${lang}/dashboard`;
    const unsubscribeUrl = `${config.frontendUrl}/unsubscribe?email=${encodeURIComponent(c.email)}&token=${generateUnsubscribeToken(c.email)}`;

    const feedbackLinks = variant === 'ended'
        ? FEEDBACK_REASONS.map(r => ({
            label: t(r.key, lang),
            url: `${config.frontendUrl}/trial-feedback?u=${c.userId}&reason=${r.slug}&token=${generateTrialFeedbackToken(c.userId)}`,
        }))
        : undefined;

    const daysLeft = c.trialEndsAt
        ? Math.max(1, Math.ceil((c.trialEndsAt.getTime() - now.getTime()) / DAY_MS))
        : REMINDER_LEAD_DAYS;

    const { subject, html } = trialLifecycleEmailTemplate({
        variant,
        lang,
        activated: stats.activated,
        messagesHandled: stats.messagesHandled,
        leadsCaptured: stats.leadsCaptured,
        daysLeft,
        upgradeUrl,
        dashboardUrl,
        unsubscribeUrl,
        feedbackLinks,
    });

    const type: EmailType = variant === 'reminder' ? 'trial_reminder' : 'trial_ended';
    const send = await emailService.send({ to: c.email, subject, html, type, userId: c.userId });

    if (send.success) {
        await stamp(c.subId, variant);
        return 'sent';
    }
    // Transient failure — leave the stamp null so it retries next run.
    logger.error(`[TrialEmail] ${variant} send failed`, { userId: c.userId, error: send.error });
    return 'error';
}

async function runStage(variant: Variant, candidates: Candidate[], now: Date): Promise<StageResult> {
    const result: StageResult = { sent: 0, skipped: 0, errors: 0 };
    for (const c of candidates) {
        try {
            const outcome = await processCandidate(variant, c, now);
            if (outcome === 'sent') result.sent++;
            else if (outcome === 'skipped') result.skipped++;
            else result.errors++;
        } catch (err) {
            result.errors++;
            captureError(err, `Trial ${variant} email failed for a user`, {
                tags: { service: 'trial-lifecycle-email', variant },
                extra: { userId: c.userId, subId: c.subId },
            });
        }
    }
    return result;
}

function mapRows(rows: Array<{
    subId: string; userId: string; email: string | null; dashboardLanguage: string | null;
    trialEndsAt: Date | null; currentPeriodStart: Date | null; createdAt: Date | null;
}>): Candidate[] {
    return rows.map(r => ({
        subId: r.subId,
        userId: r.userId,
        email: r.email,
        dashboardLanguage: r.dashboardLanguage,
        trialEndsAt: r.trialEndsAt,
        trialStart: r.currentPeriodStart ?? r.createdAt ?? new Date(0),
    }));
}

const SELECT_COLS = {
    subId: subscriptions.id,
    userId: subscriptions.userId,
    email: users.email,
    dashboardLanguage: settings.dashboardLanguage,
    trialEndsAt: subscriptions.trialEndsAt,
    currentPeriodStart: subscriptions.currentPeriodStart,
    createdAt: subscriptions.createdAt,
};

/** Runs both stages. Safe to call from the cron or the admin trigger. */
export async function runDailyTrialLifecycleEmails(): Promise<{ reminder: StageResult; winback: StageResult }> {
    const now = new Date();
    const reminderCutoff = new Date(now.getTime() + REMINDER_LEAD_DAYS * DAY_MS);
    const winbackFloor = new Date(now.getTime() - 2 * DAY_MS);

    // Stage A — reminder: still trialing, ends within the next 3 days, not yet reminded.
    const reminderRows = await db.select(SELECT_COLS)
        .from(subscriptions)
        .innerJoin(users, eq(users.id, subscriptions.userId))
        .leftJoin(settings, eq(settings.userId, subscriptions.userId))
        .where(and(
            eq(subscriptions.status, 'trialing'),
            gt(subscriptions.trialEndsAt, now),
            lte(subscriptions.trialEndsAt, reminderCutoff),
            isNull(subscriptions.trialReminderEmailedAt),
        ));

    // Stage B — win-back: trial just ended, did NOT convert to active, not yet win-backed.
    const winbackRows = await db.select(SELECT_COLS)
        .from(subscriptions)
        .innerJoin(users, eq(users.id, subscriptions.userId))
        .leftJoin(settings, eq(settings.userId, subscriptions.userId))
        .where(and(
            lt(subscriptions.trialEndsAt, now),
            gte(subscriptions.trialEndsAt, winbackFloor),
            inArray(subscriptions.status, ['trialing', 'past_due']),
            isNull(subscriptions.trialEndedEmailedAt),
        ));

    const reminder = await runStage('reminder', mapRows(reminderRows), now);
    const winback = await runStage('ended', mapRows(winbackRows), now);

    logger.info('[TrialEmail] Daily run complete', {
        reminder, winback,
        reminderCandidates: reminderRows.length,
        winbackCandidates: winbackRows.length,
    });
    return { reminder, winback };
}

export function startTrialLifecycleCron(): void {
    if (intervalHandle) return;
    logger.info('[TrialEmail] Cron started — daily reminder (T-3d) + win-back sweep');
    intervalHandle = setInterval(() => {
        runDailyTrialLifecycleEmails().catch(err => {
            captureError(err, 'Trial lifecycle email cron failed', { tags: { service: 'trial-lifecycle-email' } });
        });
    }, SWEEP_INTERVAL_MS);
}

export function stopTrialLifecycleCron(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
}
