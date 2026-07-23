/**
 * scanPostReplies unit tests — the presence-gated Post Reply source (owner
 * decision 2026-07-24). Asserts: the gate closes cleanly with no paid call when
 * a page has no Post Reply; when replies exist, the post text + reply are paired
 * and handed to the extractor under source:'post_reply'; store pages are
 * rejected; nothing is persisted. DB + extractor are mocked at their boundaries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
    pageRow: undefined as Record<string, unknown> | undefined,
    postRows: [] as Record<string, unknown>[],
};

vi.mock('../../src/db', () => ({
    db: {
        // Page load ends in .limit; the post-replies query ends in .orderBy —
        // one `where` object exposes both so cols/order can't confuse them.
        select: () => ({
            from: () => ({
                where: () => ({
                    // page load: .where().limit(1)
                    limit: async () => (state.pageRow ? [state.pageRow] : []),
                    // post-replies: .where().orderBy(...).limit(MAX)
                    orderBy: () => ({ limit: async () => state.postRows }),
                }),
            }),
        }),
    },
}));
// catalogScan imports these at module load; stub so the module resolves.
vi.mock('../../src/services/facebook', () => ({ facebookService: { getPagePosts: vi.fn() } }));
vi.mock('../../src/services/kb/file-extractor', () => ({ extractFromImage: vi.fn() }));
vi.mock('../../src/services/catalogExtractor', () => ({ catalogExtractor: { extract: vi.fn() } }));
vi.mock('../../src/services/catalog', () => {
    class CatalogStoreConflictError extends Error {}
    return {
        CatalogStoreConflictError,
        resolveCatalogVertical: () => ({ effective: 'courses', source: 'override' }),
    };
});
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));

import { catalogScanService } from '../../src/services/catalogScan';
import { CatalogStoreConflictError } from '../../src/services/catalog';
import { catalogExtractor } from '../../src/services/catalogExtractor';

const WS = 'ws-1';
const PAGE = 'page-1';
const CTX = { userId: 'user-1' };

const page = (overrides: Record<string, unknown> = {}) => ({
    id: PAGE,
    ecommerceStoreId: null,
    catalogVertical: null,
    businessProfile: { merchant: {}, suggestions: {} },
    ...overrides,
});

beforeEach(() => {
    vi.clearAllMocks();
    state.pageRow = page();
    state.postRows = [];
    (catalogExtractor.extract as ReturnType<typeof vi.fn>).mockResolvedValue({
        items: [], dropped: 0, truncated: false, failed: false,
    });
});

describe('scanPostReplies', () => {
    it('returns null when the page is not in the workspace', async () => {
        state.pageRow = undefined;
        const result = await catalogScanService.scanPostReplies(WS, PAGE, CTX);
        expect(result).toBeNull();
        expect(catalogExtractor.extract).not.toHaveBeenCalled();
    });

    it('rejects a store-linked page (catalog comes from the sync)', async () => {
        state.pageRow = page({ ecommerceStoreId: 'store-9' });
        await expect(catalogScanService.scanPostReplies(WS, PAGE, CTX)).rejects.toBeInstanceOf(CatalogStoreConflictError);
        expect(catalogExtractor.extract).not.toHaveBeenCalled();
    });

    it('closes the presence gate with no paid call when the page has no Post Reply', async () => {
        state.postRows = [];
        const result = await catalogScanService.scanPostReplies(WS, PAGE, CTX);
        expect(result).toEqual({ items: [], dropped: 0, truncated: false, failed: false, repliesScanned: 0, noPostReplies: true });
        expect(catalogExtractor.extract).not.toHaveBeenCalled();
    });

    it('pairs each post with its reply and extracts under source:post_reply', async () => {
        state.postRows = [
            { message: 'كورس المكياج المبتدئ', triggerReply: 'الكلفة 25 ألف ل.س بالعملة القديمة', createdTime: new Date('2026-07-20T00:00:00Z') },
            { message: null, triggerReply: 'دورة ICDL الكلفة 25 ألف', createdTime: null },
        ];
        (catalogExtractor.extract as ReturnType<typeof vi.fn>).mockResolvedValue({
            items: [{ name: 'كورس المكياج المبتدئ', price: 25000, currency: 'ل.س', type: 'course', description: null, isAvailable: true, startsAt: null, endsAt: null, attributes: null }],
            dropped: 0, truncated: false, failed: false,
        });

        const result = await catalogScanService.scanPostReplies(WS, PAGE, CTX);

        expect(catalogExtractor.extract).toHaveBeenCalledTimes(1);
        const [text, ctx] = (catalogExtractor.extract as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(ctx).toMatchObject({ userId: 'user-1', pageId: PAGE, source: 'post_reply', vertical: 'courses' });
        // reply text is present; the post supplies the product-name context
        expect(text).toContain('REPLY: الكلفة 25 ألف ل.س بالعملة القديمة');
        expect(text).toContain('POST: كورس المكياج المبتدئ');
        // a reply with no post still contributes (no POST line, but a REPLY line)
        expect(text).toContain('REPLY: دورة ICDL الكلفة 25 ألف');

        expect(result).toMatchObject({ repliesScanned: 2, noPostReplies: false });
        expect(result!.items).toHaveLength(1);
    });
});
