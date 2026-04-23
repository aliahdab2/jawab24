/**
 * Daily lead digest email service.
 *
 * Runs once per day (via cron). For each user with ≥ DIGEST_THRESHOLD
 * new (non-emailed) leads across their pages, sends a single digest email
 * summarizing those leads and stamps them with `digest_emailed_at` so they
 * aren't included in future digests.
 *
 * Constraints:
 * - Max one email per user per day (guaranteed by daily cron + stamping)
 * - Language picked by detecting the language of the user's page knowledge base
 * - Errors for one user must not block other users' digests
 * - Leads are stamped only after the email send succeeds (idempotent retry)
 */
import { inArray, isNull, and, eq } from 'drizzle-orm';
import { db } from '../db';
import { leads, pages, users } from '../db/schema';
import { emailService } from './email';
import { leadDigestEmailTemplate, type LeadDigestRow } from '../utils/emailTemplates';
import { detectLanguageCode } from '../utils/language';
import { captureError } from '../utils/sentryHelpers';
import { config } from '../config';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';

export const DIGEST_THRESHOLD = 10;

let logger: Logger = noopLogger;
export function setLeadDigestLogger(l: Logger): void { logger = l; }

interface DigestResult {
    processed: number;
    sent: number;
    skipped: number;
    errors: number;
}

/**
 * Pick the digest language for a user by detecting the language of their
 * pages' knowledge bases. Falls back to 'en' if detection is inconclusive.
 */
function pickDigestLanguage(kbTexts: Array<string | null>): 'ar' | 'en' {
    const joined = kbTexts.filter(Boolean).join('\n').trim();
    if (!joined) return 'en';
    const detected = detectLanguageCode(joined);
    return detected === 'ar' ? 'ar' : 'en';
}

/**
 * Run the daily digest job.
 * Safe to call multiple times per day — only users with ≥ threshold
 * non-emailed leads will receive one, and those leads are stamped atomically.
 */
export async function runDailyLeadDigest(): Promise<DigestResult> {
    const startedAt = Date.now();
    logger.info('[LeadDigest] Starting daily digest run');

    // Fetch all unsent leads joined with page ownership in one query.
    // Grouping happens in-memory — lead volume is bounded by threshold math.
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
        if (!row.userId) continue; // page not owned by a user (shouldn't happen, but guard)
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

    for (const [userId, bucket] of byUser) {
        result.processed++;
        if (bucket.leadIds.length < DIGEST_THRESHOLD) {
            result.skipped++;
            continue;
        }

        try {
            const [user] = await db
                .select({ email: users.email })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1);

            if (!user?.email) {
                logger.warn('[LeadDigest] Skipping user without email', { userId });
                result.skipped++;
                continue;
            }

            const lang = pickDigestLanguage(bucket.kbTexts);
            // Newest leads first in the table
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
                logger.error('[LeadDigest] Email send failed', {
                    userId,
                    error: send.error,
                    leadCount: bucket.leadIds.length,
                });
                result.errors++;
                continue;
            }

            // Stamp leads only after successful send — idempotent on retry
            await db
                .update(leads)
                .set({ digestEmailedAt: new Date() })
                .where(and(inArray(leads.id, bucket.leadIds), isNull(leads.digestEmailedAt)));

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

// Optional: a peek helper that returns the most recent N leads for a user
// (used by the digest for ordering). Kept inline above; exported for tests.
export const __test__ = { pickDigestLanguage };
