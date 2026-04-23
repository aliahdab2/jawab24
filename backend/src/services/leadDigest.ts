/**
 * Daily lead digest email service.
 *
 * Runs once per day (via cron). For each user with ≥ DIGEST_THRESHOLD
 * non-emailed leads, sends a single digest email summarizing those leads
 * and stamps them with `digest_emailed_at` so they aren't included again.
 *
 * Best-practice guards applied before sending:
 *   1. User has an email on file
 *   2. User has an active or trialing subscription (not churned)
 *   3. User logged in within ENGAGEMENT_WINDOW_DAYS (protects Resend
 *      sender reputation — low-engagement recipients hurt deliverability
 *      for everyone)
 *
 * Skipped users' leads are still stamped so the daily query doesn't
 * repeatedly process abandoned accounts. Every send/skip is recorded
 * in `lead_digest_sends` for observability and customer-support lookups.
 */
import { inArray, isNull, and, eq } from 'drizzle-orm';
import { db } from '../db';
import { leads, pages, users, subscriptions, leadDigestSends } from '../db/schema';
import { emailService } from './email';
import { leadDigestEmailTemplate, type LeadDigestRow } from '../utils/emailTemplates';
import { detectLanguageCode } from '../utils/language';
import { captureError } from '../utils/sentryHelpers';
import { config } from '../config';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';

export const DIGEST_THRESHOLD = 10;
export const ENGAGEMENT_WINDOW_DAYS = 30;
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

export type DigestSendStatus =
    | 'sent'
    | 'failed'
    | 'skipped_no_email'
    | 'skipped_no_subscription'
    | 'skipped_abandoned';

let logger: Logger = noopLogger;
export function setLeadDigestLogger(l: Logger): void { logger = l; }

interface DigestResult {
    processed: number;
    sent: number;
    skipped: number;
    errors: number;
}

/**
 * Pick digest language by detecting the language of the user's pages' KBs.
 * Falls back to 'en' if detection is inconclusive.
 */
function pickDigestLanguage(kbTexts: Array<string | null>): 'ar' | 'en' {
    const joined = kbTexts.filter(Boolean).join('\n').trim();
    if (!joined) return 'en';
    const detected = detectLanguageCode(joined);
    return detected === 'ar' ? 'ar' : 'en';
}

async function recordSend(row: {
    userId: string;
    status: DigestSendStatus;
    leadCount: number;
    lang?: 'ar' | 'en' | null;
    resendEmailId?: string | null;
    errorMessage?: string | null;
}): Promise<void> {
    try {
        await db.insert(leadDigestSends).values({
            userId: row.userId,
            status: row.status,
            leadCount: row.leadCount,
            lang: row.lang ?? null,
            resendEmailId: row.resendEmailId ?? null,
            errorMessage: row.errorMessage ?? null,
        });
    } catch (err) {
        // Audit-log failure must not block the actual send flow
        captureError(err, 'Failed to write lead_digest_sends row', {
            tags: { service: 'lead-digest' },
            extra: { userId: row.userId, status: row.status },
        });
    }
}

async function stampLeads(leadIds: string[]): Promise<void> {
    await db
        .update(leads)
        .set({ digestEmailedAt: new Date() })
        .where(and(inArray(leads.id, leadIds), isNull(leads.digestEmailedAt)));
}

/**
 * Run the daily digest job.
 * Idempotent: leads stamped only after successful send (or when skipping
 * for terminal reasons — no email, no subscription, abandoned — so they
 * don't pile up forever).
 */
export async function runDailyLeadDigest(): Promise<DigestResult> {
    const startedAt = Date.now();
    logger.info('[LeadDigest] Starting daily digest run');

    const rows = await db
        .select({
            leadId: leads.id,
            leadName: leads.senderName,
            leadPhone: leads.phone,
            leadSource: leads.sourceType,
            leadCreatedAt: leads.createdAt,
            pageKb: pages.knowledgeBase,
            userId: pages.userId,
        })
        .from(leads)
        .innerJoin(pages, eq(pages.id, leads.pageId))
        .where(isNull(leads.digestEmailedAt));

    const byUser = new Map<string, {
        leadIds: string[];
        digestLeads: LeadDigestRow[];
        kbTexts: Array<string | null>;
    }>();

    for (const row of rows) {
        if (!row.userId) continue;
        const bucket = byUser.get(row.userId) ?? { leadIds: [], digestLeads: [], kbTexts: [] };
        bucket.leadIds.push(row.leadId);
        bucket.digestLeads.push({
            name: row.leadName,
            phone: row.leadPhone,
            sourceType: row.leadSource,
            createdAt: row.leadCreatedAt,
        });
        bucket.kbTexts.push(row.pageKb);
        byUser.set(row.userId, bucket);
    }

    const result: DigestResult = { processed: 0, sent: 0, skipped: 0, errors: 0 };
    const engagementCutoff = new Date(Date.now() - ENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    for (const [userId, bucket] of byUser) {
        result.processed++;
        if (bucket.leadIds.length < DIGEST_THRESHOLD) {
            result.skipped++;
            continue; // below threshold — let leads accumulate, don't stamp
        }

        try {
            // One query to fetch everything we need for the gates
            const [user] = await db
                .select({
                    email: users.email,
                    lastSeenAt: users.lastSeenAt,
                })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1);

            if (!user?.email) {
                await stampLeads(bucket.leadIds);
                await recordSend({ userId, status: 'skipped_no_email', leadCount: bucket.leadIds.length });
                result.skipped++;
                logger.warn('[LeadDigest] Skipping — no email', { userId });
                continue;
            }

            // Gate: active subscription
            const [sub] = await db
                .select({ status: subscriptions.status })
                .from(subscriptions)
                .where(eq(subscriptions.userId, userId))
                .limit(1);

            if (!sub?.status || !ACTIVE_SUBSCRIPTION_STATUSES.has(sub.status)) {
                await stampLeads(bucket.leadIds);
                await recordSend({ userId, status: 'skipped_no_subscription', leadCount: bucket.leadIds.length });
                result.skipped++;
                logger.info('[LeadDigest] Skipping — no active subscription', { userId, subStatus: sub?.status ?? 'none' });
                continue;
            }

            // Gate: recent engagement (protects Resend sender reputation)
            if (!user.lastSeenAt || user.lastSeenAt < engagementCutoff) {
                await stampLeads(bucket.leadIds);
                await recordSend({ userId, status: 'skipped_abandoned', leadCount: bucket.leadIds.length });
                result.skipped++;
                logger.info('[LeadDigest] Skipping — abandoned user', {
                    userId,
                    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
                });
                continue;
            }

            const lang = pickDigestLanguage(bucket.kbTexts);
            const sortedLeads = [...bucket.digestLeads].sort(
                (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
            );

            const { subject, html } = leadDigestEmailTemplate({
                lang,
                leadCount: bucket.leadIds.length,
                leads: sortedLeads,
                dashboardUrl: `${config.frontendUrl}/${lang}/leads`,
            });

            const send = await emailService.send({ to: user.email, subject, html });
            if (!send.success) {
                // Do NOT stamp — transient failure, retry tomorrow
                await recordSend({
                    userId,
                    status: 'failed',
                    leadCount: bucket.leadIds.length,
                    lang,
                    errorMessage: send.error ?? 'unknown',
                });
                result.errors++;
                logger.error('[LeadDigest] Email send failed', {
                    userId,
                    error: send.error,
                    leadCount: bucket.leadIds.length,
                });
                continue;
            }

            await stampLeads(bucket.leadIds);
            await recordSend({
                userId,
                status: 'sent',
                leadCount: bucket.leadIds.length,
                lang,
                resendEmailId: send.id ?? null,
            });
            result.sent++;
            logger.info('[LeadDigest] Sent', {
                userId,
                leadCount: bucket.leadIds.length,
                lang,
                emailId: send.id,
            });
        } catch (err) {
            result.errors++;
            captureError(err, 'Lead digest failed for user', {
                tags: { service: 'lead-digest' },
                extra: { userId, leadCount: bucket.leadIds.length },
            });
            logger.error('[LeadDigest] Unexpected error', { userId, error: String(err) });
        }
    }

    logger.info('[LeadDigest] Run complete', {
        ...result,
        durationMs: Date.now() - startedAt,
    });
    return result;
}

export const __test__ = { pickDigestLanguage };
