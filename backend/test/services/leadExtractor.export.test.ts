import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the db module before importing the service so its top-level
// imports don't try to connect to a real database.
vi.mock('../../src/db', () => ({ db: {} }));
vi.mock('../../src/lib/redis', () => ({ redis: {} }));
vi.mock('../../src/lib/eventBus', () => ({ publishSSEEvent: vi.fn() }));
vi.mock('../../src/services/messages', () => ({ messagesService: {} }));
vi.mock('../../src/services/aiUsageLog', () => ({ logAiUsage: vi.fn() }));

import { leadExtractorService } from '../../src/services/leadExtractor';

describe('leadExtractorService.getAllLeadsForExport', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('returns every row by iterating in 500-row chunks until a short page is seen', async () => {
        // Simulate 1234 leads total. Service should issue 3 calls: 500 + 500 + 234.
        const makeRow = (i: number) => ({ id: `lead_${i}` }) as any;
        const spy = vi.spyOn(leadExtractorService, 'getLeadsByPage').mockImplementation(
            async (_pageId, { limit = 500, offset = 0 } = {}) => {
                const total = 1234;
                const start = offset;
                const end = Math.min(offset + limit, total);
                return { data: Array.from({ length: Math.max(0, end - start) }, (_, k) => makeRow(start + k)), total };
            },
        );

        const result = await leadExtractorService.getAllLeadsForExport('page_1');

        expect(result).toHaveLength(1234);
        expect(spy).toHaveBeenCalledTimes(3);
        expect(spy.mock.calls[0][1]).toMatchObject({ limit: 500, offset: 0 });
        expect(spy.mock.calls[1][1]).toMatchObject({ limit: 500, offset: 500 });
        expect(spy.mock.calls[2][1]).toMatchObject({ limit: 500, offset: 1000 });
    });

    it('stops after a single call when the first page is shorter than the chunk size', async () => {
        const spy = vi.spyOn(leadExtractorService, 'getLeadsByPage').mockResolvedValue({
            data: [{ id: 'lead_1' } as any],
            total: 1,
        });

        const result = await leadExtractorService.getAllLeadsForExport('page_1');

        expect(result).toHaveLength(1);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('forwards the status filter to every chunk call', async () => {
        const spy = vi.spyOn(leadExtractorService, 'getLeadsByPage').mockResolvedValue({ data: [], total: 0 });

        await leadExtractorService.getAllLeadsForExport('page_1', { status: 'converted' });

        expect(spy).toHaveBeenCalledWith('page_1', expect.objectContaining({ status: 'converted' }));
    });
});
