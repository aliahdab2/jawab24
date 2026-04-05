import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../../src/db', () => ({
    db: {
        delete: vi.fn(),
        select: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    aiCache: { id: 'ai_cache.id', lastUsedAt: 'ai_cache.last_used_at', createdAt: 'ai_cache.created_at' },
    logs: { id: 'logs.id', createdAt: 'logs.created_at' },
    usageLogs: { id: 'usage_logs.id', createdAt: 'usage_logs.created_at' },
    refreshTokens: { id: 'refresh_tokens.id', expiresAt: 'refresh_tokens.expires_at', revokedAt: 'refresh_tokens.revoked_at' },
    otpCodes: { id: 'otp_codes.id', expiresAt: 'otp_codes.expires_at' },
    semanticCache: { id: 'semantic_cache.id', createdAt: 'semantic_cache.created_at' },
}));

vi.mock('drizzle-orm', () => ({
    lt: vi.fn((a: any, b: any) => ({ op: 'lt', field: a, value: b })),
    sql: vi.fn((strings: TemplateStringsArray, ...values: any[]) => ({ strings, values })),
}));

import { cleanupAiCache, cleanupLogs, cleanupUsageLogs, cleanupRefreshTokens, runAllCleanupTasks, getAiCacheStats } from '../../src/utils/cleanup';
import { db } from '../../src/db';

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

    describe('runAllCleanupTasks', () => {
        it('should run all cleanup tasks and log results', async () => {
            mockDeleteChain([[]]);
            const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as any;

            const results = await runAllCleanupTasks(undefined, logger);

            expect(results).toHaveLength(6); // aiCache, semanticCache, logs, usageLogs, refreshTokens, otpCodes
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Starting'));
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
            const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as any;

            await runAllCleanupTasks({ aiCacheDays: 7, logsDays: 14, usageLogsDays: 30 }, logger);

            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Starting'));
        });
    });

    describe('getAiCacheStats', () => {
        it('should return cache statistics', async () => {
            const mockFrom = vi.fn().mockResolvedValue([{
                count: 42,
                totalHits: 1500,
                oldest: new Date('2024-01-01'),
                newest: new Date('2024-06-01'),
            }]);
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            const stats = await getAiCacheStats();

            expect(stats.totalEntries).toBe(42);
            expect(stats.totalHits).toBe(1500);
            expect(stats.oldestEntry).toEqual(new Date('2024-01-01'));
            expect(stats.newestEntry).toEqual(new Date('2024-06-01'));
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
