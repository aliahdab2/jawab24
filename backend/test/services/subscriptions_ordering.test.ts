import { describe, it, expect, vi, beforeEach } from 'vitest';
import { subscriptionsService } from '../../src/services/subscriptions';
import { db } from '../../src/db';
import { subscriptions, plans } from '../../src/db/schema';
import { desc, sql } from 'drizzle-orm';
// Mock specific parts of the database
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    subscriptions: { id: 'sub_id', userId: 'user_id', createdAt: 'created_at' },
    plans: { id: 'plan_id' },
    usage: {},
    usageLogs: {},
    pages: {},
    templates: {},
    rules: {},
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((f, v) => ({ f, v, type: 'eq' })),
    desc: vi.fn((f) => ({ f, type: 'desc' })),
    sql: vi.fn((strings) => ({ type: 'sql', content: strings[0] })),
    and: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
}));

describe('Subscriptions Service - Ordering Logic', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should order subscriptions by newest first when fetching user subscription', async () => {
        const userId = 'user_123';
        const mockPlan = { id: 'plan_1', name: 'Premium' };
        const mockSub = { id: 'sub_latest', userId, planId: 'plan_1', createdAt: new Date() };

        // Setup the chain of mocks
        const limitMock = vi.fn().mockResolvedValue([{
            subscription: mockSub,
            plan: mockPlan
        }]);
        const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
        const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
        const innerJoinMock = vi.fn().mockReturnValue({ where: whereMock });
        const fromMock = vi.fn().mockReturnValue({ innerJoin: innerJoinMock });

        vi.mocked(db.select).mockReturnValue({ from: fromMock } as any);

        await subscriptionsService.getUserSubscription(userId);

        // Verify it called orderBy(SQL_OBJECT, desc(subscriptions.createdAt))
        expect(orderByMock).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'sql' }),
            desc(subscriptions.createdAt)
        );
        expect(limitMock).toHaveBeenCalledWith(1);
    });
});
