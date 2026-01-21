import { describe, it, expect, vi, beforeEach } from 'vitest';
import { messagesService } from '../../src/services/messages';
import { db } from '../../src/db';

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
    }
}));

describe('MessagesService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getStats', () => {
        it('should return correct stats from aggregated query', async () => {
            // Mock total count query
            const mockTotalQuery = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([{ count: 50 }])
                    })
                })
            };

            // Mock replied count query
            const mockRepliedQuery = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([{ count: 30 }])
                    })
                })
            };

            // Sequence of calls matching service implementation
            vi.mocked(db.select)
                .mockReturnValueOnce(mockTotalQuery as any)
                .mockReturnValueOnce(mockRepliedQuery as any);

            const stats = await messagesService.getStats('user-123');

            expect(stats).toEqual({
                total: 50,
                replied: 30,
                pending: 20
            });
        });

        it('should handle zero messages', async () => {
             // Mock total count query returning 0
             const mockTotalQuery = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([{ count: 0 }])
                    })
                })
            };

            vi.mocked(db.select).mockReturnValue(mockTotalQuery as any);

            const stats = await messagesService.getStats('user-empty');

            expect(stats).toEqual({
                total: 0,
                replied: 0,
                pending: 0
            });
        });
    });
});
