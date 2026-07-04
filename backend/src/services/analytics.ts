import { db } from '../db';
import { comments, posts, instagramComments, instagramMedia, messages, pages, aiUsageLog } from '../db/schema';
import { eq, and, gte, lt, isNotNull, sql } from 'drizzle-orm';
import { cacheSavingsUsd } from '../config/aiPricing';
import { isReplyPipeline } from '../types/aiPipeline';

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
        return this.queryAiUsage(days, userId);
    }

    private async queryAiUsage(days: number, userId: string): Promise<AiUsageReport> {
        const now = new Date();
        const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

        const userFilter = eq(aiUsageLog.userId, userId);

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
                    userFilter,
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
                    userFilter,
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

        // One scan grouped by (page, pipeline). We fold it into two breakdowns in JS:
        //   - byPage:     "which page costs the most" (sum over pipelines)
        //   - byPipeline: "what is the cost — replies vs lead extraction vs embeddings"
        //                 (sum over pages) — answers the recurring "this number can't be
        //                 right" confusion where a page's cost silently blends Smart Reply
        //                 with lead extraction, translation, and RAG embeddings.
        const rows = await db
            .select({
                pageId: aiUsageLog.pageId,
                pageName: pages.name,
                pipeline: aiUsageLog.pipeline,
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
            .groupBy(aiUsageLog.pageId, pages.name, aiUsageLog.pipeline);

        const roundCost = (v: number) => Math.round(v * 1_000_000) / 1_000_000;

        // billedCalls = real OpenAI calls (cache hits cost $0 but still count as calls,
        // so a high call count with a tiny cost is correct, not a bug — surface the split).
        const totals = { calls: 0, billedCalls: 0, cacheHits: 0, replyCalls: 0, replyCacheHits: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
        const pageMap = new Map<string, AdminUserAiCostPageRow>();
        const pipelineMap = new Map<string, AdminUserAiCostPipelineRow>();

        for (const row of rows) {
            const calls = Number(row.calls);
            const cacheHits = Number(row.cacheHits);
            const billedCalls = calls - cacheHits;
            const tokensIn = Number(row.tokensIn);
            const tokensOut = Number(row.tokensOut);
            const costUsd = Number(row.costUsd);

            totals.calls += calls;
            totals.billedCalls += billedCalls;
            totals.cacheHits += cacheHits;
            totals.tokensIn += tokensIn;
            totals.tokensOut += tokensOut;
            totals.costUsd += costUsd;
            if (isReplyPipeline(row.pipeline)) {
                totals.replyCalls += calls;
                totals.replyCacheHits += cacheHits;
            }

            const pageKey = row.pageId ?? '__no_page__';
            const page = pageMap.get(pageKey);
            if (page) {
                page.calls += calls;
                page.billedCalls += billedCalls;
                page.cacheHits += cacheHits;
                page.tokensIn += tokensIn;
                page.tokensOut += tokensOut;
                page.costUsd += costUsd;
            } else {
                pageMap.set(pageKey, {
                    pageId: row.pageId,
                    pageName: row.pageName ?? null,
                    calls, billedCalls, cacheHits, tokensIn, tokensOut, costUsd,
                });
            }

            // pipeline is nullable on legacy rows — bucket those under 'unknown' so cost
            // still reconciles with the totals instead of vanishing.
            const pipelineKey = row.pipeline ?? 'unknown';
            const pipe = pipelineMap.get(pipelineKey);
            if (pipe) {
                pipe.calls += calls;
                pipe.billedCalls += billedCalls;
                pipe.cacheHits += cacheHits;
                pipe.costUsd += costUsd;
            } else {
                pipelineMap.set(pipelineKey, {
                    pipeline: pipelineKey,
                    calls, billedCalls, cacheHits, costUsd,
                });
            }
        }

        const byPage = Array.from(pageMap.values())
            .map(p => ({ ...p, costUsd: roundCost(p.costUsd) }))
            .sort((a, b) => b.costUsd - a.costUsd);
        const byPipeline = Array.from(pipelineMap.values())
            .map(p => ({ ...p, costUsd: roundCost(p.costUsd) }))
            .sort((a, b) => b.costUsd - a.costUsd);

        totals.costUsd = roundCost(totals.costUsd);
        const replyCacheHitRate = totals.replyCalls > 0 ? totals.replyCacheHits / totals.replyCalls : 0;

        return {
            period,
            rangeStart: rangeStart.toISOString(),
            rangeEnd: rangeEnd.toISOString(),
            totals: { ...totals, replyCacheHitRate },
            byPage,
            byPipeline,
        };
    }

    /**
     * Global (all-workspace) AI consumption for a period, grouped by pipeline and
     * model — powers the admin AI Cost panel's "consumption + caching" view.
     *
     * Distinct from getUserAiCostByPage (per-user) and getAiUsage (model+day). Adds
     * the caching dimension the panel needs:
     *   - internalCacheHits: our exact/semantic cache hits (cached=true rows, $0 cost)
     *   - promptCacheSavingsUsd: $ saved by OpenAI prompt caching (cached_input_tokens
     *     billed at the discounted rate) — see cacheSavingsUsd() in aiPricing.ts
     *
     * NOTE: this reads `ai_usage_log`, which only captures *our* (prod) traffic and
     * has no api_key_id — so it is NOT the OpenAI authoritative bill (that comes from
     * the Costs API / snapshots) and excludes eval/dev. Reconciliation is shown
     * separately in the panel.
     */
    async getGlobalAiCostByPipeline(period: AdminUserAiCostPeriod = '30d'): Promise<AdminGlobalAiCostReport> {
        const { rangeStart, rangeEnd } = resolvePeriodRange(period);
        const inRange = and(gte(aiUsageLog.createdAt, rangeStart), lt(aiUsageLog.createdAt, rangeEnd));

        // Three grouped scans in parallel: (pipeline, model) for the by-feature/by-model
        // rollups + totals, by-intent, and by-day (the daily-spend trend). All from the
        // same ai_usage_log window so /admin/ai-cost is the single home for cost analytics.
        const [rows, intentRows, dayRows] = await Promise.all([
            db.select({
                pipeline: aiUsageLog.pipeline,
                model: aiUsageLog.model,
                calls: sql<number>`count(*)`,
                cacheHits: sql<number>`count(*) filter (where ${aiUsageLog.cached} = true)`,
                tokensIn: sql<number>`COALESCE(SUM(${aiUsageLog.tokensIn}), 0)`,
                cachedInputTokens: sql<number>`COALESCE(SUM(${aiUsageLog.cachedInputTokens}), 0)`,
                tokensOut: sql<number>`COALESCE(SUM(${aiUsageLog.tokensOut}), 0)`,
                costUsd: sql<number>`COALESCE(SUM(${aiUsageLog.costUsd}), 0)`,
            }).from(aiUsageLog).where(inRange).groupBy(aiUsageLog.pipeline, aiUsageLog.model),
            db.select({
                intent: aiUsageLog.intent,
                calls: sql<number>`count(*)`,
                cacheHits: sql<number>`count(*) filter (where ${aiUsageLog.cached} = true)`,
                costUsd: sql<number>`COALESCE(SUM(${aiUsageLog.costUsd}), 0)`,
            }).from(aiUsageLog).where(inRange).groupBy(aiUsageLog.intent),
            db.select({
                day: sql<string>`DATE(${aiUsageLog.createdAt})::text`,
                calls: sql<number>`count(*)`,
                costUsd: sql<number>`COALESCE(SUM(${aiUsageLog.costUsd}), 0)`,
            }).from(aiUsageLog).where(inRange).groupBy(sql`DATE(${aiUsageLog.createdAt})`),
        ]);

        const roundCost = (v: number) => Math.round(v * 1_000_000) / 1_000_000;
        const totals = {
            calls: 0, billedCalls: 0, cacheHits: 0,
            replyCalls: 0, replyCacheHits: 0,
            tokensIn: 0, cachedInputTokens: 0, tokensOut: 0,
            costUsd: 0, promptCacheSavingsUsd: 0,
        };
        const pipelineMap = new Map<string, AdminGlobalAiCostPipelineRow>();
        const modelMap = new Map<string, AdminGlobalAiCostModelRow>();

        for (const row of rows) {
            const calls = Number(row.calls);
            const cacheHits = Number(row.cacheHits);
            const billedCalls = calls - cacheHits;
            const tokensIn = Number(row.tokensIn);
            const cachedInputTokens = Number(row.cachedInputTokens);
            const tokensOut = Number(row.tokensOut);
            const costUsd = Number(row.costUsd);
            // model is NOT NULL in the schema, but guard anyway; pipeline is nullable.
            const model = row.model ?? 'unknown';
            const savings = cacheSavingsUsd(model, cachedInputTokens);

            totals.calls += calls;
            totals.billedCalls += billedCalls;
            totals.cacheHits += cacheHits;
            totals.tokensIn += tokensIn;
            totals.cachedInputTokens += cachedInputTokens;
            totals.tokensOut += tokensOut;
            totals.costUsd += costUsd;
            totals.promptCacheSavingsUsd += savings;
            if (isReplyPipeline(row.pipeline)) {
                totals.replyCalls += calls;
                totals.replyCacheHits += cacheHits;
            }

            const pipelineKey = row.pipeline ?? 'unknown';
            const pipe = pipelineMap.get(pipelineKey);
            if (pipe) {
                pipe.calls += calls; pipe.billedCalls += billedCalls;
                pipe.cacheHits += cacheHits; pipe.costUsd += costUsd;
            } else {
                pipelineMap.set(pipelineKey, { pipeline: pipelineKey, calls, billedCalls, cacheHits, costUsd });
            }

            const mdl = modelMap.get(model);
            if (mdl) {
                mdl.calls += calls; mdl.billedCalls += billedCalls; mdl.cacheHits += cacheHits;
                mdl.tokensIn += tokensIn; mdl.cachedInputTokens += cachedInputTokens;
                mdl.tokensOut += tokensOut; mdl.costUsd += costUsd; mdl.promptCacheSavingsUsd += savings;
            } else {
                modelMap.set(model, {
                    model, calls, billedCalls, cacheHits,
                    tokensIn, cachedInputTokens, tokensOut, costUsd, promptCacheSavingsUsd: savings,
                });
            }
        }

        const byPipeline = Array.from(pipelineMap.values())
            .map(p => ({ ...p, costUsd: roundCost(p.costUsd) }))
            .sort((a, b) => b.costUsd - a.costUsd);
        const byModel = Array.from(modelMap.values())
            .map(m => ({ ...m, costUsd: roundCost(m.costUsd), promptCacheSavingsUsd: roundCost(m.promptCacheSavingsUsd) }))
            .sort((a, b) => b.costUsd - a.costUsd);

        totals.costUsd = roundCost(totals.costUsd);
        totals.promptCacheSavingsUsd = roundCost(totals.promptCacheSavingsUsd);
        const internalCacheHitRate = totals.calls > 0 ? totals.cacheHits / totals.calls : 0;
        const replyCacheHitRate = totals.replyCalls > 0 ? totals.replyCacheHits / totals.replyCalls : 0;

        const byIntent = intentRows.map(r => {
            const calls = Number(r.calls);
            const costUsd = Number(r.costUsd);
            return {
                intent: r.intent ?? 'unknown',
                calls,
                cacheHits: Number(r.cacheHits),
                costUsd: roundCost(costUsd),
                avgCostPerCallUsd: calls > 0 ? roundCost(costUsd / calls) : 0,
            };
        }).sort((a, b) => b.costUsd - a.costUsd);

        const byDay = dayRows.map(r => ({
            date: r.day,
            calls: Number(r.calls),
            costUsd: roundCost(Number(r.costUsd)),
        })).sort((a, b) => a.date.localeCompare(b.date));

        return {
            period,
            rangeStart: rangeStart.toISOString(),
            rangeEnd: rangeEnd.toISOString(),
            totals: { ...totals, internalCacheHitRate, replyCacheHitRate },
            byPipeline,
            byModel,
            byIntent,
            byDay,
        };
    }

}

export type AdminUserAiCostPeriod = '7d' | '30d' | '90d' | 'this_month' | 'last_month';

export interface AdminUserAiCostPageRow {
    pageId: string | null;
    pageName: string | null;
    calls: number;
    /** Real OpenAI calls (calls − cacheHits); cache hits are billed at $0. */
    billedCalls: number;
    cacheHits: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
}

export interface AdminUserAiCostPipelineRow {
    /** AiPipeline tag, or 'unknown' for legacy untagged rows. */
    pipeline: string;
    calls: number;
    billedCalls: number;
    cacheHits: number;
    costUsd: number;
}

export interface AdminUserAiCostReport {
    period: AdminUserAiCostPeriod;
    rangeStart: string;
    rangeEnd: string;
    totals: {
        calls: number; billedCalls: number; cacheHits: number;
        /** Calls / hits / rate scoped to REPLY_PIPELINES — see AdminGlobalAiCostReport.totals. */
        replyCalls: number; replyCacheHits: number; replyCacheHitRate: number;
        tokensIn: number; tokensOut: number; costUsd: number;
    };
    byPage: AdminUserAiCostPageRow[];
    /** Cost split by source pipeline (Smart Reply vs lead extraction vs embeddings …). */
    byPipeline: AdminUserAiCostPipelineRow[];
}

export interface AdminGlobalAiCostPipelineRow {
    pipeline: string;
    calls: number;
    billedCalls: number;
    cacheHits: number;
    costUsd: number;
}

export interface AdminGlobalAiCostModelRow {
    model: string;
    calls: number;
    billedCalls: number;
    cacheHits: number;
    tokensIn: number;
    cachedInputTokens: number;
    tokensOut: number;
    costUsd: number;
    /** USD saved by OpenAI prompt caching on this model's cached input tokens. */
    promptCacheSavingsUsd: number;
}

export interface AdminGlobalAiCostReport {
    period: AdminUserAiCostPeriod;
    rangeStart: string;
    rangeEnd: string;
    totals: {
        calls: number;
        /** Real OpenAI calls (calls − internal cache hits). */
        billedCalls: number;
        cacheHits: number;
        /**
         * cacheHits / calls (0..1) — blended across ALL pipelines, including
         * ones that can never hit the cache (embeddings, translation, …), so it
         * understates cache effectiveness. Kept for context; the headline
         * cache metric is replyCacheHitRate.
         */
        internalCacheHitRate: number;
        /** Calls in REPLY_PIPELINES (comment_reply + dm_reply) — the only cacheable traffic. */
        replyCalls: number;
        /** Internal cache hits within REPLY_PIPELINES. */
        replyCacheHits: number;
        /** replyCacheHits / replyCalls (0..1) — the meaningful reply-cache hit rate. */
        replyCacheHitRate: number;
        tokensIn: number;
        cachedInputTokens: number;
        tokensOut: number;
        /** Our estimated cost (prod traffic only — NOT the OpenAI authoritative bill). */
        costUsd: number;
        /** USD saved by OpenAI prompt caching across all models. */
        promptCacheSavingsUsd: number;
    };
    byPipeline: AdminGlobalAiCostPipelineRow[];
    byModel: AdminGlobalAiCostModelRow[];
    /** Cost by classified intent (GREETING, COMPLAINT, …) — informs cheaper-model routing. */
    byIntent: Array<{ intent: string; calls: number; cacheHits: number; costUsd: number; avgCostPerCallUsd: number }>;
    /** Daily spend trend over the period (ascending by date). */
    byDay: Array<{ date: string; calls: number; costUsd: number }>;
}

export function resolvePeriodRange(period: AdminUserAiCostPeriod): { rangeStart: Date; rangeEnd: Date } {
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
