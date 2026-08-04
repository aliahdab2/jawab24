/**
 * Daily lead digest email service.
 *
 * Runs once per day (via cron). Aggregates unsent leads per **workspace**
 * (not per user). A workspace's digest fires when EITHER trigger is met:
 *   - volume:  ≥ DIGEST_THRESHOLD unsent leads, or
 *   - age:     the oldest unsent lead is ≥ DIGEST_MAX_AGE_HOURS old.
 * The volume trigger alone starved low-volume merchants (found live
 * 2026-08-04: a paying merchant at ~1 lead/day was emailed exactly once —
 * the day his first 10 accumulated — then never again while 9 more piled
 * up; a lead is time-sensitive, so the age trigger caps the wait).
 * When it fires, the digest fans out to all workspace owners + admins who:
 *   1. have an email on file
 *   2. logged in within ENGAGEMENT_WINDOW_DAYS (protects sender reputation)
 *   3. have not muted the digest (`workspace_members.lead_digest_muted_at` IS NULL)
 *
 * The workspace itself must also pass:
 *   - The owner has an active or trialing subscription (anchors billing)
 *
 * Leads are stamped with `digest_emailed_at` only after at least one
 * recipient receives the email successfully (or when no recipient is ever
 * eligible — e.g. all admins muted/abandoned/no email — to prevent the
 * batch from piling up forever). Transient send failures do not stamp,
 * so they are retried tomorrow.
 *
 * Every send/skip is recorded in `lead_digest_sends` (one row per
 * recipient per workspace fan-out).
 */
import { inArray, isNull, and, eq } from 'drizzle-orm';
import { db } from '../db';
import {
    leads,
    pages,
    users,
    subscriptions,
    workspaceMembers,
    leadDigestSends,
} from '../db/schema';
import { emailService } from './email';
import { leadDigestEmailTemplate, type LeadDigestRow } from '../utils/emailTemplates';
import { detectLanguageCode } from '../utils/language';
import { captureError } from '../utils/sentryHelpers';
import { config } from '../config';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';

export const DIGEST_THRESHOLD = 10;
// Age flush: send even below threshold once the oldest unsent lead has waited
// this long. 48h keeps the daily cron's worst case at "two mornings", without
// mailing a merchant every single day for a one-lead trickle.
export const DIGEST_MAX_AGE_HOURS = 48;
export const ENGAGEMENT_WINDOW_DAYS = 30;
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);
const RECIPIENT_ROLES = ['owner', 'admin'] as const;

export type DigestSendStatus =
    | 'sent'
    | 'failed'
    | 'skipped_no_email'
    | 'skipped_no_subscription'
    | 'skipped_abandoned'
    | 'skipped_muted';

let logger: Logger = noopLogger;
export function setLeadDigestLogger(l: Logger): void { logger = l; }

interface DigestResult {
    processed: number; // workspaces evaluated
    sent: number;      // recipients successfully emailed
    skipped: number;   // recipients skipped (per-recipient + below-threshold workspaces)
    errors: number;    // recipient send failures
}

interface Recipient {
    userId: string;
    email: string | null;
    lastSeenAt: Date | null;
    leadDigestMutedAt: Date | null;
}

type EligibleRecipient = Recipient & { email: string; lastSeenAt: Date; leadDigestMutedAt: null };

function classifyRecipient(
    r: Recipient,
    engagementCutoff: Date,
): { kind: 'skip'; status: DigestSendStatus } | { kind: 'eligible'; recipient: EligibleRecipient } {
    if (r.leadDigestMutedAt) return { kind: 'skip', status: 'skipped_muted' };
    if (!r.email) return { kind: 'skip', status: 'skipped_no_email' };
    if (!r.lastSeenAt || r.lastSeenAt < engagementCutoff) return { kind: 'skip', status: 'skipped_abandoned' };
    return { kind: 'eligible', recipient: r as EligibleRecipient };
}

function pickDigestLanguage(kbTexts: Array<string | null>): 'ar' | 'en' {
    const joined = kbTexts.filter(Boolean).join('\n').trim();
    if (!joined) return 'en';
    const detected = detectLanguageCode(joined);
    return detected === 'ar' ? 'ar' : 'en';
}

async function recordSend(row: {
    workspaceId: string;
    userId: string;
    status: DigestSendStatus;
    leadCount: number;
    lang?: 'ar' | 'en' | null;
    resendEmailId?: string | null;
    errorMessage?: string | null;
    emailSendId?: string | null;
}): Promise<void> {
    try {
        await db.insert(leadDigestSends).values({
            workspaceId: row.workspaceId,
            userId: row.userId,
            status: row.status,
            leadCount: row.leadCount,
            lang: row.lang ?? null,
            resendEmailId: row.resendEmailId ?? null,
            errorMessage: row.errorMessage ?? null,
            emailSendId: row.emailSendId ?? null,
        });
    } catch (err) {
        // Audit-log failure must not block the actual send flow
        captureError(err, 'Failed to write lead_digest_sends row', {
            tags: { service: 'lead-digest' },
            extra: { workspaceId: row.workspaceId, userId: row.userId, status: row.status },
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
 * Idempotent: leads stamped only after at least one successful send, or
 * when no recipient is eligible (terminal — prevents pile-up).
 */
export async function runDailyLeadDigest(): Promise<DigestResult> {
    const startedAt = Date.now();
    logger.info('[LeadDigest] Starting daily digest run');

    // Pull unsent leads + their owning page's workspace.
    // Pages without a workspace_id (legacy data) are skipped — they have no
    // recipients to fan out to.
    const rows = await db
        .select({
            leadId: leads.id,
            leadName: leads.senderName,
            leadPhone: leads.phone,
            leadSource: leads.sourceType,
            leadCreatedAt: leads.createdAt,
            leadExtracted: leads.extractedData,
            pageKb: pages.knowledgeBase,
            workspaceId: pages.workspaceId,
        })
        .from(leads)
        .innerJoin(pages, eq(pages.id, leads.pageId))
        .where(isNull(leads.digestEmailedAt));

    const byWorkspace = new Map<string, {
        leadIds: string[];
        digestLeads: LeadDigestRow[];
        kbTexts: Array<string | null>;
    }>();

    for (const row of rows) {
        if (!row.workspaceId) continue; // pages without workspace — unreachable
        const bucket = byWorkspace.get(row.workspaceId) ?? { leadIds: [], digestLeads: [], kbTexts: [] };
        bucket.leadIds.push(row.leadId);
        bucket.digestLeads.push({
            name: row.leadName,
            phone: row.leadPhone,
            sourceType: row.leadSource,
            createdAt: row.leadCreatedAt,
            summary: row.leadExtracted?.summary ?? null,
        });
        bucket.kbTexts.push(row.pageKb);
        byWorkspace.set(row.workspaceId, bucket);
    }

    const result: DigestResult = { processed: 0, sent: 0, skipped: 0, errors: 0 };
    const engagementCutoff = new Date(Date.now() - ENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    for (const [workspaceId, bucket] of byWorkspace) {
        result.processed++;
        // Volume OR age: below-threshold batches still flush once their oldest
        // lead has waited DIGEST_MAX_AGE_HOURS (leads are time-sensitive; the
        // threshold alone silenced low-volume merchants for ~10 days at a time).
        // Seeded with Infinity rather than element 0 so an empty bucket needs no
        // non-null assertion: it yields Infinity, i.e. "nothing old enough".
        const oldestMs = bucket.digestLeads.reduce(
            (min, l) => Math.min(min, l.createdAt.getTime()),
            Infinity,
        );
        const ageFlush = oldestMs <= Date.now() - DIGEST_MAX_AGE_HOURS * 60 * 60 * 1000;
        if (bucket.leadIds.length < DIGEST_THRESHOLD && !ageFlush) {
            result.skipped++;
            continue; // below both triggers — let leads accumulate, don't stamp, no audit
        }

        try {
            // Workspace-level gate: owner must have an active/trialing subscription.
            // Subscription is per-user, not per-workspace, so we anchor on the owner's plan.
            const [ownerSub] = await db
                .select({
                    ownerUserId: workspaceMembers.userId,
                    subStatus: subscriptions.status,
                })
                .from(workspaceMembers)
                .leftJoin(subscriptions, eq(subscriptions.userId, workspaceMembers.userId))
                .where(and(
                    eq(workspaceMembers.workspaceId, workspaceId),
                    eq(workspaceMembers.role, 'owner'),
                ))
                .limit(1);

            if (!ownerSub?.ownerUserId
                || !ownerSub.subStatus
                || !ACTIVE_SUBSCRIPTION_STATUSES.has(ownerSub.subStatus)) {
                await stampLeads(bucket.leadIds);
                await recordSend({
                    workspaceId,
                    userId: ownerSub?.ownerUserId ?? workspaceId, // fall back to workspaceId so audit row has a non-null FK target context
                    status: 'skipped_no_subscription',
                    leadCount: bucket.leadIds.length,
                });
                result.skipped++;
                logger.info('[LeadDigest] Skipping workspace — no active subscription', {
                    workspaceId,
                    subStatus: ownerSub?.subStatus ?? 'none',
                });
                continue;
            }

            // Fan-out: all owners + admins. Each is a candidate recipient.
            const recipients = await db
                .select({
                    userId: workspaceMembers.userId,
                    email: users.email,
                    lastSeenAt: users.lastSeenAt,
                    leadDigestMutedAt: workspaceMembers.leadDigestMutedAt,
                })
                .from(workspaceMembers)
                .innerJoin(users, eq(users.id, workspaceMembers.userId))
                .where(and(
                    eq(workspaceMembers.workspaceId, workspaceId),
                    inArray(workspaceMembers.role, RECIPIENT_ROLES as unknown as string[]),
                )) as Recipient[];

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

            let anySent = false;
            let anyTransientFailure = false;

            for (const candidate of recipients) {
                const classification = classifyRecipient(candidate, engagementCutoff);
                if (classification.kind === 'skip') {
                    await recordSend({
                        workspaceId,
                        userId: candidate.userId,
                        status: classification.status,
                        leadCount: bucket.leadIds.length,
                        lang,
                    });
                    result.skipped++;
                    continue;
                }

                const recipient = classification.recipient;
                const send = await emailService.send({
                    to: recipient.email,
                    subject,
                    html,
                    type: 'lead_digest',
                    userId: recipient.userId,
                });

                if (!send.success) {
                    anyTransientFailure = true;
                    await recordSend({
                        workspaceId,
                        userId: recipient.userId,
                        status: 'failed',
                        leadCount: bucket.leadIds.length,
                        lang,
                        errorMessage: send.error ?? 'unknown',
                        emailSendId: send.emailSendId ?? null,
                    });
                    result.errors++;
                    logger.error('[LeadDigest] Email send failed', {
                        workspaceId,
                        recipientUserId: recipient.userId,
                        error: send.error,
                        leadCount: bucket.leadIds.length,
                    });
                    captureError(
                        new Error(`Lead digest send failed: ${send.error ?? 'unknown'}`),
                        'Lead digest send failed',
                        {
                            tags: { cron: 'lead_digest' },
                            level: 'error',
                            extra: { workspaceId, recipientUserId: recipient.userId, leadCount: bucket.leadIds.length, lang, resendError: send.error },
                        },
                    );
                    continue;
                }

                anySent = true;
                await recordSend({
                    workspaceId,
                    userId: recipient.userId,
                    status: 'sent',
                    leadCount: bucket.leadIds.length,
                    lang,
                    resendEmailId: send.id ?? null,
                    emailSendId: send.emailSendId ?? null,
                });
                result.sent++;
                logger.info('[LeadDigest] Sent', {
                    workspaceId,
                    recipientUserId: recipient.userId,
                    leadCount: bucket.leadIds.length,
                    lang,
                    emailId: send.id,
                });
            }

            // Stamp leads if at least one recipient received it, OR if every
            // recipient was filtered for a terminal reason (no email, abandoned,
            // muted) — those won't change tomorrow, so don't pile up the batch.
            // Don't stamp if any recipient saw a transient send failure with
            // no successful sibling — we want a retry next run.
            const allTerminal = !anySent && !anyTransientFailure;
            if (anySent || allTerminal) {
                await stampLeads(bucket.leadIds);
            }
        } catch (err) {
            result.errors++;
            captureError(err, 'Lead digest failed for workspace', {
                tags: { service: 'lead-digest' },
                extra: { workspaceId, leadCount: bucket.leadIds.length },
            });
            logger.error('[LeadDigest] Unexpected error', { workspaceId, error: String(err) });
        }
    }

    logger.info('[LeadDigest] Run complete', {
        ...result,
        durationMs: Date.now() - startedAt,
    });
    return result;
}

export const __test__ = { pickDigestLanguage };
