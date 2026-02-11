import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db before importing the module under test
vi.mock('../../../src/db', () => ({
    db: {
        execute: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        select: vi.fn(),
    },
}));

// Mock notifications service
vi.mock('../../../src/services/notifications', () => ({
    notificationService: {
        sendTemplateNotification: vi.fn().mockResolvedValue('notif-1'),
    },
}));

// Mock normalizeArabic
vi.mock('@jawab24/shared', () => ({
    normalizeArabic: vi.fn((text: string) => text.toLowerCase()),
}));

// Mock intent detector
vi.mock('../../../src/services/kb/intent-detector', () => ({
    detectIntent: vi.fn().mockReturnValue('PRICE'),
}));

import { db } from '../../../src/db';
import { notificationService } from '../../../src/services/notifications';
import { detectIntent } from '../../../src/services/kb/intent-detector';

let gapDetectorService: typeof import('../../../src/services/kb/gap-detector').gapDetectorService;

/** Helper to create a mock existing gap row (snake_case, as returned from raw SQL) */
function mockGapRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id: 'gap-1',
        page_id: 'page-1',
        query_text: 'What is the price?',
        query_normalized: 'what is the price?',
        detected_intent: 'PRICE',
        occurrence_count: 3,
        first_seen_at: '2026-02-01T00:00:00Z',
        last_seen_at: '2026-02-09T00:00:00Z',
        resolved: false,
        ...overrides,
    };
}

/** Helper to mock db.execute for sequential calls:
 *  1st call = findSimilarGap, 2nd call = atomic increment RETURNING */
function mockExecuteForIncrement(existingGap: Record<string, unknown>, newCount: number) {
    (db.execute as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([existingGap])                      // findSimilarGap
        .mockResolvedValueOnce([{ occurrence_count: newCount }]);   // atomic UPDATE RETURNING
}

/** Helper to mock db.select for page lookup (userId resolution) */
function mockPageLookup(userId: string | null, pageName: string | null = 'My Shop') {
    const selectLimitChain = {
        limit: vi.fn().mockResolvedValue(userId ? [{ userId, name: pageName }] : []),
    };
    const selectWhereChain = {
        where: vi.fn().mockReturnValue(selectLimitChain),
    };
    const selectFromChain = {
        from: vi.fn().mockReturnValue(selectWhereChain),
    };
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectFromChain);
}

beforeEach(async () => {
    vi.clearAllMocks();

    // Setup chainable mock for db.insert
    const insertChain = {
        values: vi.fn().mockResolvedValue([]),
    };
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(insertChain);

    // Setup chainable mock for db.update (used by resolveGap/resolveAllForPage)
    const updateWhereChain = {
        where: vi.fn().mockResolvedValue([]),
    };
    const updateSetChain = {
        set: vi.fn().mockReturnValue(updateWhereChain),
    };
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(updateSetChain);

    // Setup chainable mock for db.select (default: empty result)
    const selectLimitChain = {
        limit: vi.fn().mockResolvedValue([]),
    };
    const selectWhereChain = {
        where: vi.fn().mockReturnValue(selectLimitChain),
        orderBy: vi.fn().mockReturnValue(selectLimitChain),
    };
    const selectFromChain = {
        from: vi.fn().mockReturnValue(selectWhereChain),
    };
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectFromChain);

    // Import service after mocks
    const mod = await import('../../../src/services/kb/gap-detector');
    gapDetectorService = mod.gapDetectorService;
});

describe('GapDetectorService', () => {
    describe('recordGap', () => {
        it('inserts a new gap when no similar gap exists', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            await gapDetectorService.recordGap('page-1', 'How much is the cake?');

            expect(detectIntent).toHaveBeenCalledWith('How much is the cake?');
            expect(db.execute).toHaveBeenCalledTimes(1); // findSimilarGap only
            expect(db.insert).toHaveBeenCalledTimes(1); // insert new gap
        });

        it('increments occurrence count atomically when similar gap exists', async () => {
            mockExecuteForIncrement(mockGapRow({ occurrence_count: 3 }), 4);

            await gapDetectorService.recordGap('page-1', 'How much is the cake?');

            // 2 execute calls: findSimilarGap + atomic UPDATE RETURNING
            expect(db.execute).toHaveBeenCalledTimes(2);
            // No Drizzle update — uses raw SQL for atomic increment
            expect(db.update).not.toHaveBeenCalled();
            expect(db.insert).not.toHaveBeenCalled();
        });

        it('sends notification via template when threshold is reached (count = 5)', async () => {
            mockExecuteForIncrement(mockGapRow({ occurrence_count: 4 }), 5);
            mockPageLookup('user-1', 'My Shop');

            await gapDetectorService.recordGap('page-1', 'How much is the cake?');

            expect(notificationService.sendTemplateNotification).toHaveBeenCalledTimes(1);
            expect(notificationService.sendTemplateNotification).toHaveBeenCalledWith(
                'user-1',
                'kb_gap',
                { pageName: 'My Shop', topic: 'What is the price?' },
                expect.objectContaining({ pageId: 'page-1', intent: 'PRICE', occurrenceCount: 5 }),
            );
        });

        it('does NOT send notification when count < threshold', async () => {
            mockExecuteForIncrement(mockGapRow({ occurrence_count: 2 }), 3);

            await gapDetectorService.recordGap('page-1', 'How much is the cake?');

            expect(notificationService.sendTemplateNotification).not.toHaveBeenCalled();
        });

        it('does NOT send notification when count > threshold (already sent)', async () => {
            mockExecuteForIncrement(mockGapRow({ occurrence_count: 6 }), 7);

            await gapDetectorService.recordGap('page-1', 'How much is the cake?');

            expect(notificationService.sendTemplateNotification).not.toHaveBeenCalled();
        });

        it('does not throw when db fails (non-blocking)', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB down'));

            await expect(
                gapDetectorService.recordGap('page-1', 'test query')
            ).resolves.not.toThrow();
        });

        it('skips empty/whitespace-only queries', async () => {
            await gapDetectorService.recordGap('page-1', '   ');

            expect(db.execute).not.toHaveBeenCalled();
            expect(db.insert).not.toHaveBeenCalled();
        });

        it('uses detectIntent for intent classification', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            await gapDetectorService.recordGap('page-1', 'Where is your store?');

            expect(detectIntent).toHaveBeenCalledWith('Where is your store?');
        });

        it('truncates long queries in notification variables', async () => {
            const longQuery = 'A'.repeat(200);
            mockExecuteForIncrement(mockGapRow({ query_text: longQuery, occurrence_count: 4 }), 5);
            mockPageLookup('user-1', 'Shop');

            await gapDetectorService.recordGap('page-1', 'Another price query');

            const call = (notificationService.sendTemplateNotification as ReturnType<typeof vi.fn>).mock.calls[0];
            const variables = call[2]; // { pageName, topic }
            // topic should be truncated to 77 chars + "..."
            expect(variables.topic).toContain('...');
            expect(variables.topic.length).toBeLessThanOrEqual(80);
        });

        it('skips notification when page has no userId', async () => {
            mockExecuteForIncrement(mockGapRow({ occurrence_count: 4 }), 5);
            // Page lookup returns no user
            mockPageLookup(null);

            await gapDetectorService.recordGap('page-1', 'How much is this?');

            // Should NOT send notification — no userId to send to
            expect(notificationService.sendTemplateNotification).not.toHaveBeenCalled();
        });

        it('does not throw when notification service fails', async () => {
            mockExecuteForIncrement(mockGapRow({ occurrence_count: 4 }), 5);
            mockPageLookup('user-1', 'My Shop');
            (notificationService.sendTemplateNotification as ReturnType<typeof vi.fn>)
                .mockRejectedValue(new Error('FCM unavailable'));

            // Should not throw — notification failure is caught
            await expect(
                gapDetectorService.recordGap('page-1', 'How much?')
            ).resolves.not.toThrow();
        });

        it('uses page name fallback when page name is null', async () => {
            mockExecuteForIncrement(mockGapRow({ occurrence_count: 4 }), 5);
            mockPageLookup('user-1', null);

            await gapDetectorService.recordGap('page-1', 'How much?');

            const call = (notificationService.sendTemplateNotification as ReturnType<typeof vi.fn>).mock.calls[0];
            const variables = call[2];
            expect(variables.pageName).toBe('your page');
        });
    });

    describe('resolveGap', () => {
        it('marks a gap as resolved', async () => {
            await gapDetectorService.resolveGap('gap-1');

            expect(db.update).toHaveBeenCalledTimes(1);
        });
    });

    describe('resolveAllForPage', () => {
        it('marks all unresolved gaps for a page as resolved', async () => {
            await gapDetectorService.resolveAllForPage('page-1');

            expect(db.update).toHaveBeenCalledTimes(1);
        });
    });

    describe('getUnresolvedGaps', () => {
        it('returns unresolved gaps ordered by occurrence count', async () => {
            const selectLimitChain = {
                limit: vi.fn().mockResolvedValue([
                    {
                        id: 'gap-1',
                        pageId: 'page-1',
                        queryText: 'What is the price?',
                        queryNormalized: 'what is the price?',
                        detectedIntent: 'PRICE',
                        occurrenceCount: 8,
                        firstSeenAt: new Date('2026-02-01'),
                        lastSeenAt: new Date('2026-02-10'),
                        resolved: false,
                    },
                    {
                        id: 'gap-2',
                        pageId: 'page-1',
                        queryText: 'Where are you?',
                        queryNormalized: 'where are you?',
                        detectedIntent: 'LOCATION',
                        occurrenceCount: 3,
                        firstSeenAt: new Date('2026-02-05'),
                        lastSeenAt: new Date('2026-02-09'),
                        resolved: false,
                    },
                ]),
            };
            const selectOrderByChain = {
                orderBy: vi.fn().mockReturnValue(selectLimitChain),
            };
            const selectWhereChain = {
                where: vi.fn().mockReturnValue(selectOrderByChain),
            };
            const selectFromChain = {
                from: vi.fn().mockReturnValue(selectWhereChain),
            };
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectFromChain);

            const gaps = await gapDetectorService.getUnresolvedGaps('page-1');

            expect(gaps).toHaveLength(2);
            expect(gaps[0].id).toBe('gap-1');
            expect(gaps[0].occurrenceCount).toBe(8);
            expect(gaps[1].id).toBe('gap-2');
            expect(gaps[1].occurrenceCount).toBe(3);
        });

        it('passes custom limit to the query', async () => {
            const mockLimit = vi.fn().mockResolvedValue([]);
            const selectOrderByChain = {
                orderBy: vi.fn().mockReturnValue({ limit: mockLimit }),
            };
            const selectWhereChain = {
                where: vi.fn().mockReturnValue(selectOrderByChain),
            };
            const selectFromChain = {
                from: vi.fn().mockReturnValue(selectWhereChain),
            };
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectFromChain);

            await gapDetectorService.getUnresolvedGaps('page-1', 5);

            expect(mockLimit).toHaveBeenCalledWith(5);
        });
    });
});
