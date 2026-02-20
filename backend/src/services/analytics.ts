import { db } from '../db';
import { comments, posts, instagramComments, instagramMedia, messages, pages, aiUsageLog } from '../db/schema';
import { eq, and, gte, sql } from 'drizzle-orm';

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
    async getOverview(userId: string, days: number = 30, pageId?: string): Promise<AnalyticsOverview> {
        const now = new Date();
        const since = new Date(now);
        since.setDate(since.getDate() - days);

        const [fbComments, igComments, msgRows, responseTimes] = await Promise.all([
            this.queryFbComments(userId, since, pageId),
            this.queryIgComments(userId, since, pageId),
            this.queryMessages(userId, since, pageId),
            this.queryResponseTimes(userId, since, pageId),
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

        // Response times
        const { avg, p50, p95 } = this.computePercentiles(responseTimes);

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

    private async queryFbComments(userId: string, since: Date, pageId?: string): Promise<GroupedRow[]> {
        const conditions = [
            eq(pages.userId, userId),
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

    private async queryIgComments(userId: string, since: Date, pageId?: string): Promise<GroupedRow[]> {
        const conditions = [
            eq(pages.userId, userId),
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

    private async queryMessages(userId: string, since: Date, pageId?: string): Promise<(GroupedRow & { platform?: string | null })[]> {
        const conditions = [
            eq(pages.userId, userId),
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

    private async queryResponseTimes(userId: string, since: Date, pageId?: string): Promise<number[]> {
        // Collect response times from all three tables in parallel
        const conditions = (table: typeof comments | typeof instagramComments | typeof messages) => {
            const conds = [
                eq(pages.userId, userId),
                eq(table.replied, true),
                gte(table.createdTime, since),
            ];
            if (pageId) conds.push(eq(pages.id, pageId));
            return conds;
        };

        const [fbTimes, igTimes, msgTimes] = await Promise.all([
            db.select({
                seconds: sql<number>`extract(epoch from (${comments.repliedAt} - ${comments.createdTime}))`,
            })
                .from(comments)
                .innerJoin(posts, eq(comments.postId, posts.id))
                .innerJoin(pages, eq(posts.pageId, pages.id))
                .where(and(...conditions(comments))),

            db.select({
                seconds: sql<number>`extract(epoch from (${instagramComments.repliedAt} - ${instagramComments.createdTime}))`,
            })
                .from(instagramComments)
                .innerJoin(instagramMedia, eq(instagramComments.mediaId, instagramMedia.id))
                .innerJoin(pages, eq(instagramMedia.pageId, pages.id))
                .where(and(...conditions(instagramComments))),

            db.select({
                seconds: sql<number>`extract(epoch from (${messages.repliedAt} - ${messages.createdTime}))`,
            })
                .from(messages)
                .innerJoin(pages, eq(messages.pageId, pages.id))
                .where(and(...conditions(messages), eq(messages.direction, 'incoming'))),
        ]);

        return [...fbTimes, ...igTimes, ...msgTimes]
            .map(r => Number(r.seconds))
            .filter(s => s > 0 && isFinite(s));
    }

    async getAiUsage(userId: string, days: number = 30): Promise<AiUsageReport> {
        const now = new Date();
        const since = new Date(now);
        since.setDate(since.getDate() - days);

        const rows = await db
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
            .orderBy(sql`DATE(${aiUsageLog.createdAt})`);

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

        return {
            period: {
                from: since.toISOString().split('T')[0],
                to: now.toISOString().split('T')[0],
                days,
            },
            totals,
            byModel,
            byDay,
        };
    }

    private computePercentiles(times: number[]): { avg: number | null; p50: number | null; p95: number | null } {
        if (times.length === 0) {
            return { avg: null, p50: null, p95: null };
        }

        const sorted = [...times].sort((a, b) => a - b);
        const avg = Math.round((sorted.reduce((s, v) => s + v, 0) / sorted.length) * 10) / 10;
        const p50 = Math.round(sorted[Math.floor(sorted.length * 0.5)] * 10) / 10;
        const p95 = Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10;

        return { avg, p50, p95 };
    }
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
