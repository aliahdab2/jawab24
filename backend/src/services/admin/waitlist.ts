import type { FastifyBaseLogger } from 'fastify';
import { db } from '../../db';
import {
    users, waitlistEmails, waitlistEmailSends, emailUnsubscribes,
} from '../../db/schema';
import { eq, and, desc, sql, ilike, isNotNull, isNull, inArray } from 'drizzle-orm';
import { config } from '../../config';
import { emailService } from '../email';
import { waitlistEmailTemplate } from '../../utils/emailTemplates';
import { WAITLIST_TEMPLATES } from '../../utils/waitlistTemplates';
import { resolveRecipientLanguages } from '../../utils/recipientLanguage';
import { generateUnsubscribeToken } from '../../utils/tokens';
import type { SendEmailInput } from '../../utils/validation';

/**
 * Admin Waitlist / broadcast-email service.
 *
 * Behaviour-preserving move. The send-email loop's mid-batch failure behaviour
 * (count + continue, no rollback) is intentionally unchanged — out of scope for
 * the refactor.
 */

export interface WaitlistListResult {
    data: (typeof waitlistEmails.$inferSelect)[];
    features: string[];
    emailCount: number;
    phoneOnlyCount: number;
    userEmailCount: number;
    total: number;
}

export interface SendEmailResult {
    sent: number;
    failed: number;
    total: number;
    fromWaitlist: number;
    fromUsers: number;
    fromExtra: number;
}

/** Thrown when the recipient count exceeds the per-send safety cap (HTTP 400). */
export class TooManyRecipientsError extends Error {
    constructor() { super('Too many recipients (max 10000 per send)'); }
}

/** Thrown when an unknown templateId is supplied (HTTP 400). */
export class UnknownTemplateError extends Error {
    constructor(templateId: string) { super(`Unknown templateId: ${templateId}`); }
}

class AdminWaitlistService {
    /** Paginated waitlist signups + audience counts for the send-email UI. */
    async list(opts: { limitNum: number; offset: number; feature?: string; search?: string }): Promise<WaitlistListResult> {
        const { limitNum, offset, feature, search } = opts;

        const conditions = [];
        if (feature) {
            conditions.push(eq(waitlistEmails.feature, feature));
        }
        if (search) {
            conditions.push(ilike(waitlistEmails.email, `%${search}%`));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [entries, countResult] = await Promise.all([
            db.select()
                .from(waitlistEmails)
                .where(whereClause)
                .orderBy(desc(waitlistEmails.createdAt))
                .limit(limitNum)
                .offset(offset),
            db.select({ count: sql<number>`count(*)::int` })
                .from(waitlistEmails)
                .where(whereClause),
        ]);

        const total = countResult[0]?.count ?? 0;

        // Distinct features for filter dropdown
        const features = await db
            .selectDistinct({ feature: waitlistEmails.feature })
            .from(waitlistEmails)
            .orderBy(waitlistEmails.feature);

        // Email vs phone-only subscribers (for send-email UI), excluding unsubscribed
        const emailCountResult = await db
            .select({ count: sql<number>`count(distinct email)::int` })
            .from(waitlistEmails)
            .where(and(
                ...(whereClause ? [whereClause] : []),
                isNotNull(waitlistEmails.email),
                isNull(waitlistEmails.unsubscribedAt),
            ));
        const emailCount = emailCountResult[0]?.count ?? 0;

        // Registered users with email (global, not affected by waitlist filters)
        const userEmailCountResult = await db
            .select({ count: sql<number>`count(distinct lower(email))::int` })
            .from(users)
            .where(and(
                isNotNull(users.email),
                sql`lower(${users.email}) NOT IN (SELECT email FROM email_unsubscribes)`,
            ));
        const userEmailCount = userEmailCountResult[0]?.count ?? 0;

        return {
            data: entries,
            features: features.map(f => f.feature),
            emailCount,
            phoneOnlyCount: total - emailCount,
            userEmailCount,
            total,
        };
    }

    /** Read-only list of reusable email templates (code-as-data). */
    listTemplates() {
        return WAITLIST_TEMPLATES;
    }

    /**
     * Send a broadcast email to the resolved audience. Resolves recipients per
     * the audience rules, applies the global suppression list, dedupes, sends
     * one-by-one (mid-batch failures counted, not rolled back), and writes the
     * waitlist_email_sends audit row.
     *
     * Throws UnknownTemplateError / TooManyRecipientsError (both → HTTP 400).
     */
    async sendEmail(input: SendEmailInput, adminUserId: string, log: FastifyBaseLogger): Promise<SendEmailResult> {
        const { subject, body, feature, emailIds, extraEmails, audience, templateId } = input;

        // Resolve template once if templateId points to a custom-HTML template.
        const customHtmlTemplate = templateId
            ? WAITLIST_TEMPLATES.find(t => t.id === templateId)
            : undefined;
        const useCustomHtml = Boolean(
            customHtmlTemplate?.htmlBodyAr || customHtmlTemplate?.htmlBodyEn,
        );
        if (templateId && !customHtmlTemplate) {
            throw new UnknownTemplateError(templateId);
        }

        // Normalize extras: lowercase + dedupe (zod already validated shape + length)
        const extraEmailsClean = Array.from(new Set(
            (extraEmails ?? []).map(e => e.toLowerCase().trim()).filter(e => e.length > 0),
        ));

        const hasExplicitSelection = Array.isArray(emailIds) && emailIds.length > 0;
        const includeWaitlist = audience === 'waitlist' || audience === 'both';
        const includeUsers = audience === 'users' || audience === 'both';

        let waitlistEmailsList: string[] = [];
        if (includeWaitlist) {
            const waitlistConditions = [
                isNotNull(waitlistEmails.email),
                isNull(waitlistEmails.unsubscribedAt),
            ];
            if (hasExplicitSelection) {
                waitlistConditions.push(inArray(waitlistEmails.id, emailIds));
            } else if (feature) {
                waitlistConditions.push(eq(waitlistEmails.feature, feature));
            }
            const waitlistRows = await db
                .select({ email: waitlistEmails.email })
                .from(waitlistEmails)
                .where(and(...waitlistConditions));
            waitlistEmailsList = waitlistRows
                .map(r => r.email)
                .filter((e): e is string => Boolean(e))
                .map(e => e.toLowerCase());
        }

        let usersEmailsList: string[] = [];
        if (includeUsers) {
            const userRows = await db
                .select({ email: users.email })
                .from(users)
                .where(isNotNull(users.email));
            usersEmailsList = userRows
                .map(r => r.email)
                .filter((e): e is string => Boolean(e))
                .map(e => e.toLowerCase());
        }

        // Apply global suppression list — single query, then in-memory filter
        const suppressed = await db
            .select({ email: emailUnsubscribes.email })
            .from(emailUnsubscribes);
        const suppressedSet = new Set(suppressed.map(r => r.email));

        const filterSuppressed = (list: string[]) => list.filter(e => !suppressedSet.has(e));
        const waitlistFiltered = filterSuppressed(waitlistEmailsList);
        const usersFiltered = filterSuppressed(usersEmailsList);
        const extrasFiltered = filterSuppressed(extraEmailsClean);

        // Merge all sources, dedupe
        const uniqueEmails = [...new Set([
            ...waitlistFiltered,
            ...usersFiltered,
            ...extrasFiltered,
        ])];

        if (uniqueEmails.length > 10_000) {
            throw new TooManyRecipientsError();
        }

        if (uniqueEmails.length === 0) {
            return { sent: 0, failed: 0, total: 0, fromWaitlist: 0, fromUsers: 0, fromExtra: 0 };
        }

        const frontendUrl = config.frontendUrl || 'https://jawab24.com';

        // Per-recipient language only matters when using a custom-HTML template.
        const recipientLang = useCustomHtml
            ? await resolveRecipientLanguages(uniqueEmails)
            : null;

        let successCount = 0;
        let failureCount = 0;

        for (const email of uniqueEmails) {
            const token = generateUnsubscribeToken(email);
            const unsubscribeUrl = `${frontendUrl}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;

            // For custom-HTML templates: pick AR/EN variant by recipient language,
            // fall back to the other variant if only one exists.
            let customHtml: string | undefined;
            if (useCustomHtml && customHtmlTemplate) {
                const lang = recipientLang?.get(email) ?? 'ar';
                customHtml =
                    (lang === 'en'
                        ? customHtmlTemplate.htmlBodyEn ?? customHtmlTemplate.htmlBodyAr
                        : customHtmlTemplate.htmlBodyAr ?? customHtmlTemplate.htmlBodyEn);
            }

            const html = waitlistEmailTemplate({ subject, body, unsubscribeUrl, customHtml });
            const result = await emailService.send({ to: email, subject, html, type: 'waitlist' });
            if (result.success) {
                successCount++;
            } else {
                failureCount++;
                log.warn({ email, error: result.error }, 'Failed to send waitlist email');
            }
        }

        // Audit: store `feature` only when it was the effective waitlist filter
        await db.insert(waitlistEmailSends).values({
            subject,
            body,
            recipientCount: uniqueEmails.length,
            successCount,
            failureCount,
            feature: hasExplicitSelection || !includeWaitlist ? null : (feature ?? null),
            sentBy: adminUserId,
        });

        return {
            sent: successCount,
            failed: failureCount,
            total: uniqueEmails.length,
            fromWaitlist: waitlistFiltered.length,
            fromUsers: usersFiltered.length,
            fromExtra: extrasFiltered.length,
        };
    }
}

export const adminWaitlistService = new AdminWaitlistService();
