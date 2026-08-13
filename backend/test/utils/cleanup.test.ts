import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../../src/db', () => ({
    db: {
        delete: vi.fn(),
        select: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    aiCache: { id: 'ai_cache.id', lastUsedAt: 'ai_cache.last_used_at', createdAt: 'ai_cache.created_at' },
    logs: { id: 'logs.id', createdAt: 'logs.created_at' },
    usageLogs: { id: 'usage_logs.id', createdAt: 'usage_logs.created_at' },
    refreshTokens: { id: 'refresh_tokens.id', expiresAt: 'refresh_tokens.expires_at', revokedAt: 'refresh_tokens.revoked_at' },
    otpCodes: { id: 'otp_codes.id', expiresAt: 'otp_codes.expires_at' },
    semanticCache: { id: 'semantic_cache.id', createdAt: 'semantic_cache.created_at' },
    ecommerceStores: { id: 'ecommerce_stores.id', isActive: 'ecommerce_stores.is_active', uninstalledAt: 'ecommerce_stores.uninstalled_at' },
    customerNotificationsLog: { id: 'customer_notifications_log.id', createdAt: 'customer_notifications_log.created_at' },
    emailSends: { id: 'email_sends.id', createdAt: 'email_sends.created_at', htmlBody: 'email_sends.html_body' },
    messages: { id: 'messages.id', createdAt: 'messages.created_at', needsAttention: 'messages.needs_attention', resolved: 'messages.resolved' },
    comments: { id: 'comments.id', createdAt: 'comments.created_at', needsAttention: 'comments.needs_attention', resolved: 'comments.resolved' },
    instagramComments: { id: 'ig_comments.id', createdAt: 'ig_comments.created_at', needsAttention: 'ig_comments.needs_attention', resolved: 'ig_comments.resolved' },
}));

vi.mock('../../src/services/statsCache', () => ({
    invalidateEndpointStatsCaches: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
    lt: vi.fn((a: any, b: any) => ({ op: 'lt', field: a, value: b })),
    eq: vi.fn((a: any, b: any) => ({ op: 'eq', field: a, value: b })),
    ne: vi.fn((a: any, b: any) => ({ op: 'ne', field: a, value: b })),
    and: vi.fn((...conds: any[]) => ({ op: 'and', conds })),
    sql: vi.fn((strings: TemplateStringsArray, ...values: any[]) => ({ strings, values })),
}));

import { cleanupAiCache, cleanupLogs, cleanupUsageLogs, cleanupRefreshTokens, cleanupSemanticCache, cleanupInactiveEcommerceStores, cleanupCustomerNotificationLogs, cleanupEmailBodies, expireStaleAttentionItems, ATTENTION_QUEUE_RETENTION_DAYS, runAllCleanupTasks, getAiCacheStats } from '../../src/utils/cleanup';
import { db } from '../../src/db';
import { invalidateEndpointStatsCaches } from '../../src/services/statsCache';
import { lt, ne, eq } from 'drizzle-orm';
import { SEMANTIC_CACHE_TTL_DAYS } from '../../src/services/kb/semantic-cache';

function mockDeleteChain(batches: Array<Array<{ id: string }>>) {
    let callCount = 0;
    const mockReturning = vi.fn(() => {
        const batch = batches[callCount] || [];
        callCount++;
        return Promise.resolve(batch);
    });
    const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
    vi.mocked(db.delete).mockReturnValue({ where: mockWhere } as any);
    return { mockWhere, mockReturning };
}

// db.update(...).set(...).where(...).returning() — used by cleanupEmailBodies.
function mockUpdateChain(rows: Array<{ id: string }>) {
    const mockReturning = vi.fn(() => Promise.resolve(rows));
    const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);
    return { mockSet, mockWhere };
}

describe('cleanup utilities', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('cleanupAiCache', () => {
        it('should delete old cache entries and return count', async () => {
            mockDeleteChain([[{ id: '1' }, { id: '2' }], []]);

            const result = await cleanupAiCache(30);

            expect(db.delete).toHaveBeenCalled();
            expect(result.table).toBe('ai_cache');
            expect(result.deletedCount).toBe(2);
            expect(result.error).toBeUndefined();
        });

        it('should return 0 when no old entries exist', async () => {
            mockDeleteChain([[]]);

            const result = await cleanupAiCache(30);
            expect(result.deletedCount).toBe(0);
        });

        it('should catch errors and return them in result', async () => {
            vi.mocked(db.delete).mockImplementation(() => {
                throw new Error('DB connection lost');
            });

            const result = await cleanupAiCache(30);
            expect(result.error).toBe('DB connection lost');
            expect(result.deletedCount).toBe(0);
        });
    });

    describe('cleanupLogs', () => {
        it('should delete old log entries', async () => {
            mockDeleteChain([[{ id: 'log-1' }], []]);

            const result = await cleanupLogs(90);
            expect(result.table).toBe('logs');
            expect(result.deletedCount).toBe(1);
        });
    });

    describe('cleanupUsageLogs', () => {
        it('should delete old usage log entries', async () => {
            mockDeleteChain([[{ id: 'ul-1' }, { id: 'ul-2' }, { id: 'ul-3' }], []]);

            const result = await cleanupUsageLogs(180);
            expect(result.table).toBe('usage_logs');
            expect(result.deletedCount).toBe(3);
        });
    });

    describe('cleanupRefreshTokens', () => {
        it('should delete expired and revoked tokens', async () => {
            mockDeleteChain([[{ id: 'rt-1' }], []]);

            const result = await cleanupRefreshTokens();
            expect(result.table).toBe('refresh_tokens');
            expect(result.deletedCount).toBe(1);
        });

        it('should handle errors gracefully', async () => {
            vi.mocked(db.delete).mockImplementation(() => {
                throw new Error('connection refused');
            });

            const result = await cleanupRefreshTokens();
            expect(result.error).toBe('connection refused');
            expect(result.deletedCount).toBe(0);
        });
    });

    describe('cleanupSemanticCache', () => {
        // Regression: the age backstop must stay aligned with SEMANTIC_CACHE_TTL_DAYS —
        // a longer TTL in the read query is silently undone if cleanup purges earlier.
        it('purges by age using SEMANTIC_CACHE_TTL_DAYS (30 days)', async () => {
            (db as unknown as { execute: ReturnType<typeof vi.fn> }).execute =
                vi.fn().mockResolvedValue([]);
            mockDeleteChain([[]]);

            const result = await cleanupSemanticCache();

            expect(result.error).toBeUndefined();
            expect(SEMANTIC_CACHE_TTL_DAYS).toBe(30);
            const ageCall = vi.mocked(lt).mock.calls.find(
                (c) => c[0] === 'semantic_cache.created_at',
            );
            expect(ageCall).toBeDefined();
            const cutoff = (ageCall![1] as Date).getTime();
            const daysBack = (Date.now() - cutoff) / 86_400_000;
            expect(daysBack).toBeCloseTo(SEMANTIC_CACHE_TTL_DAYS, 1);
        });
    });

    describe('cleanupInactiveEcommerceStores', () => {
        it('hard-deletes stores inactive past the retention window and returns count', async () => {
            mockDeleteChain([[{ id: 'store-1' }, { id: 'store-2' }], []]);

            const result = await cleanupInactiveEcommerceStores(30);

            expect(db.delete).toHaveBeenCalled();
            expect(result.table).toBe('ecommerce_stores');
            expect(result.deletedCount).toBe(2);
            // Cutoff must be ~30 days back, matched against uninstalled_at (not e.g. created_at).
            const cutoffCall = vi.mocked(lt).mock.calls.find(c => c[0] === 'ecommerce_stores.uninstalled_at');
            expect(cutoffCall).toBeDefined();
            const daysBack = (Date.now() - (cutoffCall![1] as Date).getTime()) / 86_400_000;
            expect(daysBack).toBeCloseTo(30, 1);
        });

        it('returns 0 when no inactive stores are past the window', async () => {
            mockDeleteChain([[]]);
            const result = await cleanupInactiveEcommerceStores(30);
            expect(result.deletedCount).toBe(0);
            expect(result.error).toBeUndefined();
        });
    });

    describe('cleanupCustomerNotificationLogs', () => {
        it('hard-deletes notification-log rows older than the retention window, keyed on created_at', async () => {
            mockDeleteChain([[{ id: 'n-1' }, { id: 'n-2' }], []]);

            const result = await cleanupCustomerNotificationLogs(90);

            expect(db.delete).toHaveBeenCalled();
            expect(result.table).toBe('customer_notifications_log');
            expect(result.deletedCount).toBe(2);
            const cutoffCall = vi.mocked(lt).mock.calls.find(c => c[0] === 'customer_notifications_log.created_at');
            expect(cutoffCall).toBeDefined();
            const daysBack = (Date.now() - (cutoffCall![1] as Date).getTime()) / 86_400_000;
            expect(daysBack).toBeCloseTo(90, 1);
        });

        it('surfaces DB errors in the result', async () => {
            vi.mocked(db.delete).mockImplementation(() => { throw new Error('boom'); });
            const result = await cleanupCustomerNotificationLogs(90);
            expect(result.error).toBe('boom');
            expect(result.deletedCount).toBe(0);
        });
    });

    describe('cleanupEmailBodies', () => {
        it('blanks html_body older than the window (only non-empty rows) and returns the count', async () => {
            const { mockSet } = mockUpdateChain([{ id: 'e-1' }, { id: 'e-2' }]);

            const result = await cleanupEmailBodies(30);

            expect(db.update).toHaveBeenCalled();
            // html_body is NOT NULL → blanked to '' (not NULL).
            expect(mockSet).toHaveBeenCalledWith({ htmlBody: '' });
            expect(result.table).toBe('email_sends');
            expect(result.deletedCount).toBe(2);
            // Cutoff ~30 days back on created_at; guarded so already-blanked rows are skipped.
            const cutoffCall = vi.mocked(lt).mock.calls.find(c => c[0] === 'email_sends.created_at');
            expect(cutoffCall).toBeDefined();
            const daysBack = (Date.now() - (cutoffCall![1] as Date).getTime()) / 86_400_000;
            expect(daysBack).toBeCloseTo(30, 1);
            expect(vi.mocked(ne)).toHaveBeenCalledWith('email_sends.html_body', '');
        });

        it('surfaces DB errors in the result', async () => {
            vi.mocked(db.update).mockImplementation(() => { throw new Error('update failed'); });
            const result = await cleanupEmailBodies(30);
            expect(result.error).toBe('update failed');
            expect(result.deletedCount).toBe(0);
        });
    });

    describe('expireStaleAttentionItems', () => {
        function mockAttentionUpdate(rows: Array<{ workspaceId: string | null }>) {
            const sets: unknown[] = [];
            const mockReturning = vi.fn(() => Promise.resolve(rows));
            const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
            const mockSet = vi.fn((v: unknown) => { sets.push(v); return { where: mockWhere }; });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);
            return { sets };
        }

        it('sweeps all three queues and sums them', async () => {
            mockAttentionUpdate([{ workspaceId: 'w1' }, { workspaceId: 'w1' }]);

            const result = await expireStaleAttentionItems(7);

            expect(db.update).toHaveBeenCalledTimes(3);
            expect(result.table).toBe('attention_queue');
            expect(result.deletedCount).toBe(6);   // 2 rows × 3 tables
            expect(result.error).toBeUndefined();
        });

        it('isolates each queue — one table failing must not skip the others', async () => {
            // The first release shared one try/catch across all three, so a messages error
            // silently skipped comments (57% of the volume) on every run, forever.
            let call = 0;
            const mockReturning = vi.fn(() => Promise.resolve([{ workspaceId: 'w9' }]));
            const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
            const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.update).mockImplementation(() => {
                if (call++ === 0) throw new Error('messages exploded');
                return { set: mockSet } as any;
            });

            const result = await expireStaleAttentionItems(7);

            expect(db.update).toHaveBeenCalledTimes(3);       // it kept going
            expect(result.deletedCount).toBe(2);              // the other two queues swept
            expect(result.error).toContain('messages: messages exploded');
            expect(result.workspaceIds).toEqual(['w9']);
        });

        it('never clears the flag AND never writes updated_at', async () => {
            const { sets } = mockAttentionUpdate([]);

            await expireStaleAttentionItems(7);

            for (const s of sets) {
                expect(s).toHaveProperty('resolved', true);
                // The evidence (flags + flag_meta questions) is what reply quality is
                // measured from; emptying the queue must not cost us it.
                expect(s).not.toHaveProperty('needsAttention');
                expect(s).not.toHaveProperty('flagReason');
                // updated_at is the schema's ONLY proxy for "resolved at". Stamping it
                // made sweep-resolved rows indistinguishable from merchant-resolved ones
                // and destroyed the measurement D-078 promised to repeat.
                expect(s).not.toHaveProperty('updatedAt');
            }
        });

        it('ages from created_at, defaults to the 7-day window, and skips already-resolved rows', async () => {
            mockAttentionUpdate([]);

            await expireStaleAttentionItems();

            expect(ATTENTION_QUEUE_RETENTION_DAYS).toBe(7);
            // A flag ages from when the CUSTOMER wrote, not from the last unrelated row write.
            const cutoff = vi.mocked(lt).mock.calls.find(c => c[0] === 'messages.created_at');
            expect(cutoff).toBeDefined();
            const daysBack = (Date.now() - (cutoff![1] as Date).getTime()) / 86_400_000;
            expect(daysBack).toBeCloseTo(ATTENTION_QUEUE_RETENTION_DAYS, 1);
            expect(vi.mocked(eq)).toHaveBeenCalledWith('messages.needs_attention', true);
            expect(vi.mocked(eq)).toHaveBeenCalledWith('messages.resolved', false);
        });

        it('returns the affected workspaces, deduped across queues, for cache invalidation', async () => {
            mockAttentionUpdate([
                { workspaceId: 'w1' }, { workspaceId: 'w2' }, { workspaceId: 'w1' }, { workspaceId: null },
            ]);

            const result = await expireStaleAttentionItems(7);

            expect(result.workspaceIds.sort()).toEqual(['w1', 'w2']);
        });

        it('reports every queue that failed, and claims no rows it never resolved', async () => {
            vi.mocked(db.update).mockImplementation(() => { throw new Error('update failed'); });

            const result = await expireStaleAttentionItems(7);

            expect(result.error).toContain('messages: update failed');
            expect(result.error).toContain('comments: update failed');
            expect(result.error).toContain('instagram_comments: update failed');
            expect(result.deletedCount).toBe(0);
            expect(result.workspaceIds).toEqual([]);
        });
    });

    describe('runAllCleanupTasks', () => {
        it('should run all cleanup tasks and log results', async () => {
            mockDeleteChain([[]]);
            mockUpdateChain([]);
            const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as any;

            const results = await runAllCleanupTasks(undefined, logger);

            // aiCache, semanticCache, logs, usageLogs, refreshTokens, otpCodes,
            // ecommerceStores, customerNotificationsLog, emailSends, attentionQueue
            expect(results).toHaveLength(10);
            expect(results.map(r => r.table)).toContain('attention_queue');
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Starting'));
        });

        it('invalidates the stats caches of every workspace the sweep touched', async () => {
            mockDeleteChain([[]]);
            // The last task in the Promise.all is the attention sweep; its rows carry the
            // workspace ids. Without this the Needs-Attention chip keeps a stale count over
            // an emptied list, and that chip has no polling fallback to self-heal.
            mockUpdateChain([{ workspaceId: 'w1' }, { workspaceId: 'w2' }, { workspaceId: 'w1' }] as any);

            await runAllCleanupTasks(undefined, { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as any);

            expect(vi.mocked(invalidateEndpointStatsCaches)).toHaveBeenCalledWith('w1');
            expect(vi.mocked(invalidateEndpointStatsCaches)).toHaveBeenCalledWith('w2');
            expect(vi.mocked(invalidateEndpointStatsCaches)).toHaveBeenCalledTimes(2);
        });

        it('on a PARTIAL sweep failure it logs the error AND the rows it did resolve', async () => {
            // Per-queue isolation makes "failed on one table, resolved thousands on the
            // others" a legitimate outcome. An if/else would report only the failure and
            // hide the work — which is exactly the observability the sweep is judged by.
            mockDeleteChain([[]]);
            let call = 0;
            const mockReturning = vi.fn(() => Promise.resolve([{ workspaceId: 'w1' }]));
            const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
            const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.update).mockImplementation(() => {
                if (call++ === 0) throw new Error('messages exploded');
                return { set: mockSet } as any;
            });
            const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as any;

            await runAllCleanupTasks(undefined, logger);

            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('messages: messages exploded'));
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('rows from attention_queue'));
        });

        it('should log errors for failed tasks', async () => {
            vi.mocked(db.delete).mockImplementation(() => {
                throw new Error('disk full');
            });
            const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as any;

            const results = await runAllCleanupTasks(undefined, logger);

            const errorCalls = logger.error.mock.calls;
            expect(errorCalls.length).toBeGreaterThan(0);
            expect(errorCalls[0][0]).toContain('disk full');
        });

        it('should accept custom retention days', async () => {
            mockDeleteChain([[]]);
            mockUpdateChain([]);
            const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as any;

            await runAllCleanupTasks({ aiCacheDays: 7, logsDays: 14, usageLogsDays: 30 }, logger);

            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Starting'));
        });
    });

    describe('getAiCacheStats', () => {
        it('should return cache statistics', async () => {
            // Raw sql<> aggregates come back as Postgres TEXT under drizzle >=0.30
            // (identity parsers + noopDecoder) — the mock must mirror that shape,
            // or the Date re-hydration in getAiCacheStats goes untested.
            const mockFrom = vi.fn().mockResolvedValue([{
                count: 42,
                totalHits: 1500,
                oldest: '2024-01-01 00:00:00+00',
                newest: '2024-06-01 00:00:00+00',
            }]);
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            const stats = await getAiCacheStats();

            expect(stats.totalEntries).toBe(42);
            expect(stats.totalHits).toBe(1500);
            expect(stats.oldestEntry).toEqual(new Date('2024-01-01T00:00:00Z'));
            expect(stats.newestEntry).toEqual(new Date('2024-06-01T00:00:00Z'));
        });

        it('should return zeros when cache is empty', async () => {
            const mockFrom = vi.fn().mockResolvedValue([{
                count: 0,
                totalHits: 0,
                oldest: null,
                newest: null,
            }]);
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            const stats = await getAiCacheStats();

            expect(stats.totalEntries).toBe(0);
            expect(stats.totalHits).toBe(0);
            expect(stats.oldestEntry).toBeNull();
            expect(stats.newestEntry).toBeNull();
        });
    });
});
