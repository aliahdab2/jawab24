import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentController } from '../../src/controllers/payment';
import { db } from '../../src/db';
import { subscriptions, plans } from '../../src/db/schema';
import { desc } from 'drizzle-orm';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mock database
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    subscriptions: { id: 'sub_id', userId: 'user_id', createdAt: 'created_at', planId: 'plan_id', status: 'status', currentPeriodStart: 'current_period_start', currentPeriodEnd: 'current_period_end', cancelAtPeriodEnd: 'cancel_at_period_end', trialEndsAt: 'trial_ends_at' },
    plans: { id: 'id', name: 'name' },
    users: { id: 'id' },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((f, v) => ({ f, v, type: 'eq' })),
    desc: vi.fn((f) => ({ f, type: 'desc' })),
}));

describe('Payment Controller - Subscription Status Ordering', () => {
    let paymentController: PaymentController;
    let mockRequest: Partial<FastifyRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(() => {
        vi.clearAllMocks();
        paymentController = new PaymentController();
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
        mockRequest = {
            user: { userId: 'user_123', facebookId: 'fb_123' },
            log: { error: vi.fn() },
        };
    });

    it('should order by newest first to return the upgraded plan', async () => {
        const mockSubscription = {
            id: 'sub_latest',
            status: 'active',
            planId: 'plan_pro',
            planName: 'Pro Plan',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(),
        };

        const limitMock = vi.fn().mockResolvedValue([mockSubscription]);
        const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
        const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
        const innerJoinMock = vi.fn().mockReturnValue({ where: whereMock });
        const fromMock = vi.fn().mockReturnValue({ innerJoin: innerJoinMock });

        vi.mocked(db.select).mockReturnValue({ from: fromMock } as any);

        await paymentController.getSubscriptionStatus(mockRequest as FastifyRequest, mockReply as FastifyReply);

        // Verify it called orderBy(desc(subscriptions.createdAt))
        expect(orderByMock).toHaveBeenCalledWith(desc(subscriptions.createdAt));
        expect(limitMock).toHaveBeenCalledWith(1);
    });
});
