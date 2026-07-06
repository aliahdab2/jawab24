/**
 * Admin AI-cost reports — reply-scoped cache hit rate (real Postgres).
 *
 * Regression guard for the "12% cache hit rate" misread (2026-07-04): the
 * blended internalCacheHitRate divides hits by ALL ai_usage_log rows, including
 * pipelines that can never produce a cached=true row (embeddings, translation,
 * lead extraction, …), so a healthy reply cache read as broken. The headline
 * metric is now replyCacheHitRate, scoped to REPLY_PIPELINES
 * (comment_reply + dm_reply).
 *
 * Fixture is shaped so the two rates diverge decisively: blended = 12%
 * (the prod symptom) while the reply-scoped rate = 30%.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestUser, testDb } from './setup';
import * as schema from '../../src/db/schema';
import { analyticsService } from '../../src/services/analytics';

// Stamp fixtures an hour in the past. The reports filter `createdAt < rangeEnd`
// where rangeEnd = now() computed in JS at query time; a row defaulted to the
// DB's now() sits on that exact boundary, and under deploy-time contention
// (integration tests run WHILE Docker images build) clock skew between Postgres
// and Node can push it just past rangeEnd → excluded → flaky zero counts. An
// hour's headroom keeps every fixture unambiguously inside the 7d window.
const FIXTURE_CREATED_AT = new Date(Date.now() - 60 * 60 * 1000);

async function seedUsage(userId: string, pipeline: string, calls: number, cachedCalls: number) {
    const rows = Array.from({ length: calls }, (_, i) => ({
        userId,
        model: 'gpt-4.1-mini',
        pipeline,
        cached: i < cachedCalls,
        tokensIn: i < cachedCalls ? 0 : 1000,
        tokensOut: i < cachedCalls ? 0 : 100,
        costUsd: i < cachedCalls ? 0 : 0.002,
        createdAt: FIXTURE_CREATED_AT,
    }));
    await testDb.insert(schema.aiUsageLog).values(rows);
}

describe('AI cost reports — reply-scoped cache hit rate (integration)', () => {
    let userId: string;

    beforeEach(async () => {
        const user = await createTestUser({ facebookId: 'fb-ai-cost', email: 'ai-cost@test.com' });
        userId = user.id;
        // 25 calls total, 3 cached — all 3 hits inside the reply pipelines (10 calls).
        await seedUsage(userId, 'comment_reply', 4, 2);
        await seedUsage(userId, 'dm_reply', 6, 1);
        await seedUsage(userId, 'embedding_cache', 10, 0); // never cacheable
        await seedUsage(userId, 'translation', 2, 0);      // never cacheable
        await seedUsage(userId, 'lead_extraction', 3, 0);  // never cacheable
    });

    it('global report: replyCacheHitRate counts only reply pipelines; blended rate stays diluted', async () => {
        const report = await analyticsService.getGlobalAiCostByPipeline('7d');

        expect(report.totals.calls).toBe(25);
        expect(report.totals.cacheHits).toBe(3);
        // The old headline number — diluted by 15 never-cacheable calls.
        expect(report.totals.internalCacheHitRate).toBeCloseTo(3 / 25, 5);
        // The meaningful number — hits over comment_reply + dm_reply only.
        expect(report.totals.replyCalls).toBe(10);
        expect(report.totals.replyCacheHits).toBe(3);
        expect(report.totals.replyCacheHitRate).toBeCloseTo(3 / 10, 5);
    });

    it('global report: per-pipeline rows expose the split the UI hit-rate column renders', async () => {
        const report = await analyticsService.getGlobalAiCostByPipeline('7d');
        const byPipeline = Object.fromEntries(report.byPipeline.map(p => [p.pipeline, p]));

        expect(byPipeline.comment_reply).toMatchObject({ calls: 4, cacheHits: 2, billedCalls: 2 });
        expect(byPipeline.dm_reply).toMatchObject({ calls: 6, cacheHits: 1, billedCalls: 5 });
        expect(byPipeline.embedding_cache).toMatchObject({ calls: 10, cacheHits: 0 });
    });

    it('per-user report: totals carry the same reply-scoped fields', async () => {
        const report = await analyticsService.getUserAiCostByPage(userId, '7d');

        expect(report.totals.calls).toBe(25);
        expect(report.totals.replyCalls).toBe(10);
        expect(report.totals.replyCacheHits).toBe(3);
        expect(report.totals.replyCacheHitRate).toBeCloseTo(3 / 10, 5);
    });

    it('reports zero (not NaN) for a user with only never-cacheable traffic', async () => {
        const other = await createTestUser({ facebookId: 'fb-ai-cost-2', email: 'ai-cost-2@test.com' });
        await seedUsage(other.id, 'translation', 3, 0);

        const report = await analyticsService.getUserAiCostByPage(other.id, '7d');

        expect(report.totals.calls).toBe(3);
        expect(report.totals.replyCalls).toBe(0);
        expect(report.totals.replyCacheHitRate).toBe(0);
    });
});
