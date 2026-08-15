import { describe, it, expect, vi } from 'vitest';

/**
 * Regression: listAuditLogs must order DESCENDING. Its docblock always said
 * "most recent 100", but the query said `.orderBy(adminAuditLogs.createdAt)` —
 * Drizzle's default is ASCENDING — so once the table passed 100 rows the
 * endpoint served the 100 OLDEST admin actions forever, silently hiding every
 * recent one (merchant emails included) behind the earliest manual upgrades.
 * Found during the PR #757 review; the audit trail that PR leans on is only
 * readable if this ordering is right.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-jwt-secret';

const { mockOrderBy } = vi.hoisted(() => ({ mockOrderBy: vi.fn() }));

vi.mock('../db', () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
        from: vi.fn(),
        leftJoin: vi.fn(),
        orderBy: mockOrderBy,
        limit: vi.fn().mockResolvedValue([]),
    };
    chain.from.mockReturnValue(chain);
    chain.leftJoin.mockReturnValue(chain);
    mockOrderBy.mockReturnValue(chain);
    return { db: { select: vi.fn().mockReturnValue(chain) } };
});

vi.mock('../services/analytics', () => ({ analyticsService: {}, AI_COST_PERIODS: [] }));
vi.mock('../services/aiCostSnapshots', () => ({ getBilling: vi.fn(), getReconciliation: vi.fn() }));

import { adminMetricsService } from '../services/admin/metrics';
import { adminAuditLogs } from '../db/schema';

describe('adminMetricsService.listAuditLogs', () => {
    it('orders by createdAt DESCENDING — the docblock says "most recent 100" and must mean it', async () => {
        await adminMetricsService.listAuditLogs();

        expect(mockOrderBy).toHaveBeenCalledTimes(1);
        const arg = mockOrderBy.mock.calls[0][0];
        // A bare column (the ascending-default bug) would BE the column object;
        // desc(column) wraps it in an SQL fragment whose string chunks carry
        // ' desc'. (No JSON.stringify — column chunks are circular.)
        expect(arg).not.toBe(adminAuditLogs.createdAt);
        const chunks = (arg as { queryChunks?: Array<{ value?: unknown }> }).queryChunks ?? [];
        const hasDesc = chunks.some((c) => Array.isArray(c.value) && c.value.join('').includes('desc'));
        expect(hasDesc).toBe(true);
    });
});
