import { db } from '../db';
import { comments, posts, instagramComments, instagramMedia, messages, pages, aiUsageLog } from '../db/schema';
import { eq, and, gte, lt, isNotNull, sql } from 'drizzle-orm';

interface AnalyticsOverview {
    period: { from: string; to: string; days: number };
    totals: {
        comments: number;
        messages: number;
        replied: number;
        unreplied: number;
        replyRate: string;
        flagged: number;
    };
    byMethod: Record<string, number>;
    byIntent: Record<string, number>;
    byLanguage: Record<string, number>;
    byPlatform: Record<string, number>;
    flags: Record<string, number>;
    responseTime: {
        avgSeconds: number | null;
        p50Seconds: number | null;
        p95Seconds: number | null;
    };
}

export class AnalyticsService {
    async getOverview(workspaceId: string, days: number = 30, pageId?: string): Promise<AnalyticsOverview> {
        const now = new Date();
        const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

        const [fbComments, igComments, msgRows, responseTimes] = await Promise.all([
            this.queryFbComments(workspaceId, since, pageId),
            this.queryIgComments(workspaceId, since, pageId),
            this.queryMessages(workspaceId, since, pageId),
            this.queryResponseTimes(workspaceId, since, pageId),
        ]);

        // Aggregate all rows
        const byMethod: Record<string, number> = {};
        const byIntent: Record<string, number> = {};
        const byLanguage: Record<string, number> = {};
        const flags: Record<string, number> = {};
        let totalComments = 0;
        let totalMessages = 0;
        let totalReplied = 0;
        let totalFlagged = 0;

        const processRow = (row: GroupedRow, type: 'comment' | 'message') => {
            const count = Number(row.count);
            const replied = Number(row.replied_count);
            const flagged = Number(row.flagged_count);

            if (type === 'comment') totalComments += count;
            else totalMessages += count;
            totalReplied += replied;
            totalFlagged += flagged;

            // Method
            if (row.reply_method) {
                byMethod[row.reply_method] = (byMethod[row.reply_method] || 0) + replied;
            }

            // Intent
            if (row.ai_intent) {
                byIntent[row.ai_intent] = (byIntent[row.ai_intent] || 0) + count;
            }

            // Language
            const lang = row.detected_language || 'unknown';
            byLanguage[lang] = (byLanguage[lang] || 0) + count;

            // Flags (comma-separated in flag_reason column)
            if (row.flag_reason) {
                for (const flag of row.flag_reason.split(',')) {
                    const trimmed = flag.trim();
                    if (trimmed) {
                        flags[trimmed] = (flags[trimmed] || 0) + flagged;
                    }
                }
            }
        };

        for (const row of fbComments) processRow(row, 'comment');
        for (const row of igComments) processRow(row, 'comment');
        for (const row of msgRows) processRow(row, 'message');

        const total = totalComments + totalMessages;
        const unreplied = total - totalReplied;
        const replyRate = total > 0 ? ((totalReplied / total) * 100).toFixed(1) : '0.0';

        // Platform breakdown from messages (which has a platform column)
        const byPlatform: Record<string, number> = {
            facebook: totalComments - igComments.reduce((s, r) => s + Number(r.count), 0),
            instagram: igComments.reduce((s, r) => s + Number(r.count), 0),
        };
        // Add message platform counts
        for (const row of msgRows) {
            if (row.platform) {
                byPlatform[row.platform] = (byPlatform[row.platform] || 0) + Number(row.count);
            }
        }

        // Response times (computed in SQL via percentile_cont)
        const { avg, p50, p95 } = responseTimes;

        return {
            period: {
                from: since.toISOString().split('T')[0],
                to: now.toISOString().split('T')[0],
                days,
            },
            totals: {
                comments: totalComments,
                messages: totalMessages,
                replied: totalReplied,
                unreplied,
                replyRate,
                flagged: totalFlagged,
            },
            byMethod,
            byIntent,
            byLanguage,
            byPlatform,
            flags,
            responseTime: {
                avgSeconds: avg,
                p50Seconds: p50,
                p95Seconds: p95,
            },
        };
    }

    private async queryFbComments(workspaceId: string, since: Date, pageId?: string): Promise<GroupedRow[]> {
        const conditions = [
            eq(pages.workspaceId, workspaceId),
            gte(comments.createdTime, since),
        ];
        if (pageId) conditions.push(eq(pages.id, pageId));

        const rows = await db
            .select({
                count: sql<number>`count(*)`,
                replied_count: sql<number>`count(*) filter (where ${comments.replied} = true)`,
                flagged_count: sql<number>`count(*) filter (where ${comments.needsAttention} = true)`,
                reply_method: comments.replyMethod,
                ai_intent: comments.aiIntent,
                detected_language: comments.detectedLanguage,
                flag_reason: comments.flagReason,
            })
            .from(comments)
            .innerJoin(posts, eq(comments.postId, posts.id))
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(and(...conditions))
            .groupBy(comments.replyMethod, comments.aiIntent, comments.detectedLanguage, comments.flagReason);

        return rows as GroupedRow[];
    }

    private async queryIgComments(workspaceId: string, since: Date, pageId?: string): Promise<GroupedRow[]> {
        const conditions = [
            eq(pages.workspaceId, workspaceId),
            gte(instagramComments.createdTime, since),
        ];
        if (pageId) conditions.push(eq(pages.id, pageId));

        const rows = await db
            .select({
                count: sql<number>`count(*)`,
                replied_count: sql<number>`count(*) filter (where ${instagramComments.replied} = true)`,
                flagged_count: sql<number>`count(*) filter (where ${instagramComments.needsAttention} = true)`,
                reply_method: instagramComments.replyMethod,
                ai_intent: instagramComments.aiIntent,
                detected_language: instagramComments.detectedLanguage,
                flag_reason: instagramComments.flagReason,
            })
            .from(instagramComments)
            .innerJoin(instagramMedia, eq(instagramComments.mediaId, instagramMedia.id))
            .innerJoin(pages, eq(instagramMedia.pageId, pages.id))
            .where(and(...conditions))
            .groupBy(instagramComments.replyMethod, instagramComments.aiIntent, instagramComments.detectedLanguage, instagramComments.flagReason);

        return rows as GroupedRow[];
    }

    private async queryMessages(workspaceId: string, since: Date, pageId?: string): Promise<(GroupedRow & { platform?: string | null })[]> {
        const conditions = [
            eq(pages.workspaceId, workspaceId),
            eq(messages.direction, 'incoming'),
            gte(messages.createdTime, since),
        ];
        if (pageId) conditions.push(eq(pages.id, pageId));

        const rows = await db
            .select({
                count: sql<number>`count(*)`,
                replied_count: sql<number>`count(*) filter (where ${messages.replied} = true)`,
                flagged_count: sql<number>`count(*) filter (where ${messages.needsAttention} = true)`,
                reply_method: messages.replyMethod,
                ai_intent: messages.aiIntent,
                detected_language: sql<string | null>`null`,
                flag_reason: messages.flagReason,
                platform: messages.platform,
            })
            .from(messages)
            .innerJoin(pages, eq(messages.pageId, pages.id))
            .where(and(...conditions))
            .groupBy(messages.replyMethod, messages.aiIntent, messages.flagReason, messages.platform);

        return rows as (GroupedRow & { platform?: string | null })[];
    }

    private async queryResponseTimes(workspaceId: string, since: Date, pageId?: string): Promise<{ avg: number | null; p50: number | null; p95: number | null }> {
        // Compute avg, p50, p95 in SQL using percentile_cont — avoids fetching thousands of rows into JS.
        // Uses a CTE to UNION ALL response times from all three tables, then aggregates once.
        const pageFilter = pageId ? sql` AND ${pages.id} = ${pageId}` : sql``;

        const result = await db.execute(sql`
            WITH all_times AS (
                SELECT extract(epoch from (${comments.repliedAt} - ${comments.createdTime})) AS seconds
                FROM ${comments}
                INNER JOIN ${posts} ON ${comments.postId} = ${posts.id}
                INNER JOIN ${pages} ON ${posts.pageId} = ${pages.id}
                WHERE ${pages.workspaceId} = ${workspaceId}
                  AND ${comments.replied} = true
                  AND (${comments.needsAttention} = false OR ${comments.needsAttention} IS NULL)
                  AND ${comments.createdTime} >= ${since}
                  ${pageFilter}
                UNION ALL
                SELECT extract(epoch from (${instagramComments.repliedAt} - ${instagramComments.createdTime})) AS seconds
                FROM ${instagramComments}
                INNER JOIN ${instagramMedia} ON ${instagramComments.mediaId} = ${instagramMedia.id}
                INNER JOIN ${pages} ON ${instagramMedia.pageId} = ${pages.id}
                WHERE ${pages.workspaceId} = ${workspaceId}
                  AND ${instagramComments.replied} = true
                  AND (${instagramComments.needsAttention} = false OR ${instagramComments.needsAttention} IS NULL)
                  AND ${instagramComments.createdTime} >= ${since}
                  ${pageFilter}
                UNION ALL
                SELECT extract(epoch from (${messages.repliedAt} - ${messages.createdTime})) AS seconds
                FROM ${messages}
                INNER JOIN ${pages} ON ${messages.pageId} = ${pages.id}
                WHERE ${pages.workspaceId} = ${workspaceId}
                  AND ${messages.replied} = true
                  AND (${messages.needsAttention} = false OR ${messages.needsAttention} IS NULL)
                  AND ${messages.direction} = 'incoming'
                  AND ${messages.createdTime} >= ${since}
                  ${pageFilter}
            )
            SELECT
                ROUND(AVG(seconds)::numeric, 1) AS avg,
                ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds))::numeric, 1) AS p50,
                ROUND((percentile_cont(0.95) WITHIN GROUP (ORDER BY seconds))::numeric, 1) AS p95
            FROM all_times
            WHERE seconds > 0 AND seconds IS NOT NULL
        `);

        const row = result[0] as { avg: string | null; p50: string | null; p95: string | null } | undefined;
        return {
            avg: row?.avg ? Number(row.avg) : null,
            p50: row?.p50 ? Number(row.p50) : null,
            p95: row?.p95 ? Number(row.p95) : null,
        };
    }

    async getAiUsage(userId: string, days: number = 30): Promise<AiUsageReport> {
        const now = new Date();
        const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

        const [rows, intentRows] = await Promise.all([
            db
                .select({
                    model: aiUsageLog.model,
                    day: sql<string>`DATE(${aiUsageLog.createdAt})`,
                    calls: sql<number>`count(*)`,
                    llmCalls: sql<number>`count(*) filter (where ${aiUsageLog.cached} = false)`,
                    cacheHits: sql<number>`count(*) filter (where ${aiUsageLog.cached} = true)`,
                    tokensIn: sql<number>`COALESCE(SUM(${aiUsageLog.tokensIn}), 0)`,
                    tokensOut: sql<number>`COALESCE(SUM(${aiUsageLog.tokensOut}), 0)`,
                    costUsd: sql<number>`COALESCE(SUM(${aiUsageLog.costUsd}), 0)`,
                })
                .from(aiUsageLog)
                .where(and(
                    eq(aiUsageLog.userId, userId),
                    gte(aiUsageLog.createdAt, since),
                ))
                .groupBy(aiUsageLog.model, sql`DATE(${aiUsageLog.createdAt})`)
                .orderBy(sql`DATE(${aiUsageLog.createdAt})`),
            db
                .select({
                    intent: aiUsageLog.intent,
                    calls: sql<number>`count(*)`,
                    llmCalls: sql<number>`count(*) filter (where ${aiUsageLog.cached} = false)`,
                    cacheHits: sql<number>`count(*) filter (where ${aiUsageLog.cached} = true)`,
                    tokensIn: sql<number>`COALESCE(SUM(${aiUsageLog.tokensIn}), 0)`,
                    tokensOut: sql<number>`COALESCE(SUM(${aiUsageLog.tokensOut}), 0)`,
                    costUsd: sql<number>`COALESCE(SUM(${aiUsageLog.costUsd}), 0)`,
                })
                .from(aiUsageLog)
                .where(and(
                    eq(aiUsageLog.userId, userId),
                    gte(aiUsageLog.createdAt, since),
                    isNotNull(aiUsageLog.intent),
                ))
                .groupBy(aiUsageLog.intent),
        ]);

        const totals: AiUsageModelStats = { calls: 0, llmCalls: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
        const byModel: Record<string, AiUsageModelStats> = {};
        const byDayMap: Record<string, { calls: number; tokensIn: number; tokensOut: number; costUsd: number }> = {};

        for (const row of rows) {
            const calls = Number(row.calls);
            const llmCalls = Number(row.llmCalls);
            const cacheHits = Number(row.cacheHits);
            const tokensIn = Number(row.tokensIn);
            const tokensOut = Number(row.tokensOut);
            const costUsd = Number(row.costUsd);

            totals.calls += calls;
            totals.llmCalls += llmCalls;
            totals.cacheHits += cacheHits;
            totals.tokensIn += tokensIn;
            totals.tokensOut += tokensOut;
            totals.costUsd += costUsd;

            if (!byModel[row.model]) {
                byModel[row.model] = { calls: 0, llmCalls: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
            }
            byModel[row.model].calls += calls;
            byModel[row.model].llmCalls += llmCalls;
            byModel[row.model].cacheHits += cacheHits;
            byModel[row.model].tokensIn += tokensIn;
            byModel[row.model].tokensOut += tokensOut;
            byModel[row.model].costUsd += costUsd;

            const day = String(row.day);
            if (!byDayMap[day]) {
                byDayMap[day] = { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
            }
            byDayMap[day].calls += calls;
            byDayMap[day].tokensIn += tokensIn;
            byDayMap[day].tokensOut += tokensOut;
            byDayMap[day].costUsd += costUsd;
        }

        // Round cost to avoid floating-point noise
        const roundCost = (v: number) => Math.round(v * 1_000_000) / 1_000_000;
        totals.costUsd = roundCost(totals.costUsd);
        for (const m of Object.keys(byModel)) {
            byModel[m].costUsd = roundCost(byModel[m].costUsd);
        }

        const byDay = Object.entries(byDayMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, data]) => ({ date, ...data, costUsd: roundCost(data.costUsd) }));

        const byIntent: Record<string, AiUsageModelStats> = {};
        for (const row of intentRows) {
            const key = row.intent ?? 'unknown';
            byIntent[key] = {
                calls: Number(row.calls),
                llmCalls: Number(row.llmCalls),
                cacheHits: Number(row.cacheHits),
                tokensIn: Number(row.tokensIn),
                tokensOut: Number(row.tokensOut),
                costUsd: roundCost(Number(row.costUsd)),
            };
        }

        return {
            period: {
                from: since.toISOString().split('T')[0],
                to: now.toISOString().split('T')[0],
                days,
            },
            totals,
            byModel,
            byDay,
            byIntent,
        };
    }

    /**
     * Per-user AI cost breakdown by Facebook/Instagram page for a given preset period.
     *
     * Powers the "AI Cost by Page" card on /admin/customers/[userId]. NULL pageId rows
     * (embeddings, lead extraction, anything not tied to a page) are folded into a single
     * '__no_page__' bucket so the totals reconcile with the global observability page.
     */
    async getUserAiCostByPage(userId: string, period: AdminUserAiCostPeriod = '30d'): Promise<AdminUserAiCostReport> {
        const { rangeStart, rangeEnd } = resolvePeriodRange(period);

        const rows = await db
            .select({
                pageId: aiUsageLog.pageId,
                pageName: pages.name,
                calls: sql<number>`count(*)`,
                cacheHits: sql<number>`count(*) filter (where ${aiUsageLog.cached} = true)`,
                tokensIn: sql<number>`COALESCE(SUM(${aiUsageLog.tokensIn}), 0)`,
                tokensOut: sql<number>`COALESCE(SUM(${aiUsageLog.tokensOut}), 0)`,
                costUsd: sql<number>`COALESCE(SUM(${aiUsageLog.costUsd}), 0)`,
            })
            .from(aiUsageLog)
            .leftJoin(pages, eq(pages.id, aiUsageLog.pageId))
            .where(and(
                eq(aiUsageLog.userId, userId),
                gte(aiUsageLog.createdAt, rangeStart),
                lt(aiUsageLog.createdAt, rangeEnd),
            ))
            .groupBy(aiUsageLog.pageId, pages.name);

        const roundCost = (v: number) => Math.round(v * 1_000_000) / 1_000_000;
        const totals = { calls: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };

        const byPage = rows.map(row => {
            const calls = Number(row.calls);
            const cacheHits = Number(row.cacheHits);
            const tokensIn = Number(row.tokensIn);
            const tokensOut = Number(row.tokensOut);
            const costUsd = Number(row.costUsd);
            totals.calls += calls;
            totals.cacheHits += cacheHits;
            totals.tokensIn += tokensIn;
            totals.tokensOut += tokensOut;
            totals.costUsd += costUsd;
            return {
                pageId: row.pageId,
                pageName: row.pageName ?? null,
                calls,
                cacheHits,
                tokensIn,
                tokensOut,
                costUsd: roundCost(costUsd),
            };
        }).sort((a, b) => b.costUsd - a.costUsd);

        totals.costUsd = roundCost(totals.costUsd);

        return {
            period,
            rangeStart: rangeStart.toISOString(),
            rangeEnd: rangeEnd.toISOString(),
            totals,
            byPage,
        };
    }

}

export type AdminUserAiCostPeriod = '7d' | '30d' | '90d' | 'this_month' | 'last_month';

export interface AdminUserAiCostReport {
    period: AdminUserAiCostPeriod;
    rangeStart: string;
    rangeEnd: string;
    totals: { calls: number; cacheHits: number; tokensIn: number; tokensOut: number; costUsd: number };
    byPage: Array<{
        pageId: string | null;
        pageName: string | null;
        calls: number;
        cacheHits: number;
        tokensIn: number;
        tokensOut: number;
        costUsd: number;
    }>;
}

function resolvePeriodRange(period: AdminUserAiCostPeriod): { rangeStart: Date; rangeEnd: Date } {
    const now = new Date();
    if (period === 'this_month') {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        return { rangeStart: start, rangeEnd: now };
    }
    if (period === 'last_month') {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        return { rangeStart: start, rangeEnd: end };
    }
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { rangeStart: start, rangeEnd: now };
}

interface AiUsageModelStats {
    calls: number;
    llmCalls: number;
    cacheHits: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
}

interface AiUsageReport {
    period: { from: string; to: string; days: number };
    totals: AiUsageModelStats;
    byModel: Record<string, AiUsageModelStats>;
    byDay: Array<{ date: string; calls: number; tokensIn: number; tokensOut: number; costUsd: number }>;
    /** Aggregation keyed by classified intent (GREETING, COMPLAINT, …). Excludes rows with NULL intent. */
    byIntent: Record<string, AiUsageModelStats>;
}

interface GroupedRow {
    count: number;
    replied_count: number;
    flagged_count: number;
    reply_method: string | null;
    ai_intent: string | null;
    detected_language: string | null;
    flag_reason: string | null;
}

export const analyticsService = new AnalyticsService();
