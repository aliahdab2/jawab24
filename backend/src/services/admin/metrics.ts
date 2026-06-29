import { db } from '../../db';
import { users, plans, adminAuditLogs, leadDigestSends, emailSends } from '../../db/schema';
import { eq, desc } from 'drizzle-orm';
import { analyticsService, type AdminUserAiCostPeriod } from '../analytics';
import { getBilling, getReconciliation } from '../aiCostSnapshots';
import { computeRunway, setBalanceAnchor } from '../aiCostMonitor';
import { runDailyLeadDigest } from '../leadDigest';

/**
 * Admin Metrics / misc-read service: AI cost reporting, plans dropdown, audit
 * logs, lead-digest history + manual run, and single-email fetch. Orchestrates
 * the existing analyticsService + leadDigest job.
 */

export const AI_COST_PERIODS: readonly AdminUserAiCostPeriod[] = ['7d', '30d', '90d', 'this_month', 'last_month'];

class AdminMetricsService {
    /** AI cost by page for a single user, scoped to a preset period (default 30d). */
    async getUserAiCost(userId: string, period: AdminUserAiCostPeriod) {
        return analyticsService.getUserAiCostByPage(userId, period);
    }

    /** Global AI consumption + caching across all workspaces, scoped to a period. */
    async getGlobalAiCost(period: AdminUserAiCostPeriod) {
        return analyticsService.getGlobalAiCostByPipeline(period);
    }

    /** Authoritative OpenAI billing (from snapshots) — by month/model/api-key. */
    async getAiBilling(period: AdminUserAiCostPeriod) {
        return getBilling(period);
    }

    /** OpenAI prod-key spend vs our ai_usage_log estimate (like-for-like) + org total. */
    async getAiReconciliation(period: AdminUserAiCostPeriod) {
        return getReconciliation(period);
    }

    /** Current OpenAI credit runway + severity (org-total burn). */
    async getAiRunway() {
        return computeRunway();
    }

    /** Set the credit-balance anchor, then return the recomputed runway. */
    async setAiCreditBalance(opts: { balanceUsd: number; anchoredAt: string; note?: string | null; updatedBy?: string | null }) {
        await setBalanceAnchor(opts);
        return computeRunway();
    }

    /** All plans, for the admin dropdown (ordered by sortOrder). */
    async listPlans() {
        return db
            .select({
                id: plans.id,
                name: plans.name,
                slug: plans.slug,
                price: plans.price,
                isActive: plans.isActive,
            })
            .from(plans)
            .orderBy(plans.sortOrder);
    }

    /** Most recent 100 admin audit logs, joined to the acting admin's email. */
    async listAuditLogs() {
        return db
            .select({
                id: adminAuditLogs.id,
                action: adminAuditLogs.action,
                previousValue: adminAuditLogs.previousValue,
                newValue: adminAuditLogs.newValue,
                paymentReference: adminAuditLogs.paymentReference,
                note: adminAuditLogs.note,
                createdAt: adminAuditLogs.createdAt,
                adminEmail: users.email,
            })
            .from(adminAuditLogs)
            .leftJoin(users, eq(adminAuditLogs.adminUserId, users.id))
            .orderBy(adminAuditLogs.createdAt)
            .limit(100);
    }

    /** Paginated lead-digest send/skip history, optionally filtered by status. */
    async listLeadDigestHistory(opts: { limit: number; offset: number; status?: string }) {
        const { limit, offset, status } = opts;
        const where = status ? eq(leadDigestSends.status, status) : undefined;
        return db
            .select({
                id: leadDigestSends.id,
                workspaceId: leadDigestSends.workspaceId,
                userId: leadDigestSends.userId,
                userEmail: users.email,
                status: leadDigestSends.status,
                leadCount: leadDigestSends.leadCount,
                lang: leadDigestSends.lang,
                resendEmailId: leadDigestSends.resendEmailId,
                errorMessage: leadDigestSends.errorMessage,
                emailSendId: leadDigestSends.emailSendId,
                createdAt: leadDigestSends.createdAt,
            })
            .from(leadDigestSends)
            .leftJoin(users, eq(users.id, leadDigestSends.userId))
            .where(where)
            .orderBy(desc(leadDigestSends.createdAt))
            .limit(limit)
            .offset(offset);
    }

    /** Manually trigger the daily lead digest job. */
    async runLeadDigest() {
        return runDailyLeadDigest();
    }

    /** Single outbound email (subject + html body) by email_sends id. Null = not found. */
    async getEmail(id: string) {
        const [row] = await db
            .select({
                id: emailSends.id,
                type: emailSends.type,
                toEmail: emailSends.toEmail,
                subject: emailSends.subject,
                htmlBody: emailSends.htmlBody,
                status: emailSends.status,
                errorMessage: emailSends.errorMessage,
                createdAt: emailSends.createdAt,
            })
            .from(emailSends)
            .where(eq(emailSends.id, id))
            .limit(1);
        return row ?? null;
    }
}

export const adminMetricsService = new AdminMetricsService();
