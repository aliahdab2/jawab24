/**
 * catalogScan unit tests — the orchestration rules that make the unified page
 * scan (D-059: recent posts + configured Post Replies in ONE scan) safe to
 * re-run: bookmark only advances on success, image budget is bounded and spent
 * only where OCR is still needed, only Meta CDN images are fetched, a Graph
 * failure degrades honestly (never "up to date"), a blocked page still scans
 * its replies, and the page's vertical + framing reach the extractor. Fixture
 * is the car-dealer archetype (the "علق بنقطة" merchants) — the segment this
 * flow must serve best.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
    pageRow: undefined as Record<string, unknown> | undefined,
    /** Rows the catalog-existence probe returns — [] = empty catalog (bookmark
     *  ignored), non-empty = an established catalog (bookmark respected). */
    catalogRows: [] as Record<string, unknown>[],
    /** Configured Post Reply rows per channel (fetchPostReplies). */
    fbReplyRows: [] as Record<string, unknown>[],
    igReplyRows: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
};

vi.mock('../../src/db', () => ({
    db: {
        // Three select shapes run, routed by projection so order can't confuse
        // them: the page load (has `encryptedAccessToken`), the two Post Reply
        // queries (have `triggerReply`; the FB one also has `facebookPostId` and
        // both end in .orderBy().limit()), and the catalog-existence probe
        // (everything else, plain .where().limit()).
        select: (cols?: Record<string, unknown>) => ({
            from: () => ({
                where: () => ({
                    limit: async () =>
                        cols && 'encryptedAccessToken' in cols ? (state.pageRow ? [state.pageRow] : []) : state.catalogRows,
                    orderBy: () => ({
                        limit: async () =>
                            cols && 'facebookPostId' in cols ? state.fbReplyRows : state.igReplyRows,
                    }),
                }),
            }),
        }),
        update: () => ({ set: (values: Record<string, unknown>) => ({ where: async () => { state.updates.push(values); } }) }),
    },
}));
vi.mock('../../src/services/facebook', () => ({
    facebookService: { getPagePosts: vi.fn() },
}));
vi.mock('../../src/services/kb/file-extractor', () => ({
    extractFromImage: vi.fn(),
}));
vi.mock('../../src/services/catalogExtractor', () => ({
    catalogExtractor: { extract: vi.fn() },
}));
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));
// Model the real storage shape: `pages.access_token` holds AES ciphertext that the
// Graph API cannot use. A fixture that pretended the column was plaintext is why
// "ciphertext sent to Graph" shipped and no scan ever succeeded in production.
const CIPHERTEXT = 'enc:tok';
const PLAINTEXT = 'tok';
const CORRUPT_CIPHERTEXT = 'enc:corrupt';
vi.mock('../../src/services/facebookCrypto', () => ({
    // Mirrors safeDecryptToken: '' for an absent OR undecryptable token.
    safeDecryptToken: (stored?: string | null) => {
        if (!stored || stored === 'enc:corrupt') return '';
        return String(stored).replace('enc:', '');
    },
}));
// `create` returns undefined on purpose — fbAxios has an explicit guard for
// auto-mocked axios and falls back to the default export (also a mock here).
vi.mock('axios', () => ({ default: { get: vi.fn(), create: vi.fn() }, isAxiosError: () => false }));

import axios from 'axios';
import { catalogScanService, CatalogScanUnavailableError, MAX_SCAN_IMAGES, MAX_IMAGES_PER_POST } from '../../src/services/catalogScan';
import { CatalogStoreConflictError } from '../../src/services/catalog';
import { facebookService } from '../../src/services/facebook';
import { catalogExtractor } from '../../src/services/catalogExtractor';
import { extractFromImage } from '../../src/services/kb/file-extractor';

const WS = 'ws-1';
const PAGE = 'page-1';
const CTX = { userId: 'user-1' };

const dealerPage = (overrides: Record<string, unknown> = {}) => ({
    id: PAGE,
    facebookPageId: 'fb-dealer',
    encryptedAccessToken: CIPHERTEXT,
    ecommerceStoreId: null,
    catalogVertical: null,
    catalogScanLastPostTime: null,
    businessProfile: { merchant: {}, suggestions: { category: 'Car dealership' } },
    ...overrides,
});

const post = (overrides: Record<string, unknown> = {}) => ({
    id: 'post-1',
    message: 'كيا ريو 2018 ممشى 60 ألف — علق بنقطة ليوصلك السعر',
    imageUrl: null,
    imageUrls: [] as string[],
    createdTime: '2026-07-10T10:00:00+0000',
    commentsCount: 3,
    ...overrides,
});

const okExtraction = {
    items: [{ name: 'كيا ريو 2018', type: 'vehicle' }],
    dropped: 0, truncated: false, failed: false,
};

function mockPosts(posts: unknown[], failed = false) {
    vi.mocked(facebookService.getPagePosts).mockResolvedValue({ posts, nextCursor: null, failed } as never);
}

const extractorInput = () => vi.mocked(catalogExtractor.extract).mock.calls[0][0] as string;

// One reset for all three suites — the fixture state is identical everywhere,
// and three hand-copied beforeEach blocks is exactly how one of them drifts.
beforeEach(() => {
    vi.clearAllMocks();
    state.pageRow = dealerPage();
    state.catalogRows = [];
    state.fbReplyRows = [];
    state.igReplyRows = [];
    state.updates = [];
    vi.mocked(catalogExtractor.extract).mockResolvedValue(okExtraction as never);
});

describe('catalogScanService.scanPage', () => {
    it('returns null for a page outside the workspace (controller → 404)', async () => {
        state.pageRow = undefined;
        expect(await catalogScanService.scanPage(WS, PAGE, CTX)).toBeNull();
    });

    it('throws the store conflict for store-linked pages', async () => {
        state.pageRow = dealerPage({ ecommerceStoreId: 'store-1' });
        await expect(catalogScanService.scanPage(WS, PAGE, CTX)).rejects.toBeInstanceOf(CatalogStoreConflictError);
    });

    // "Nothing scannable" = posts unreadable AND no configured Post Reply. Each
    // blocked-posts shape alone no longer kills the scan (see the replies-only
    // suite below) — only the combination does.
    it('throws CatalogScanUnavailableError for a disconnected page with no Post Reply (blank token)', async () => {
        state.pageRow = dealerPage({ encryptedAccessToken: '' });
        await expect(catalogScanService.scanPage(WS, PAGE, CTX)).rejects.toBeInstanceOf(CatalogScanUnavailableError);
    });

    it('throws CatalogScanUnavailableError for a WhatsApp-only page with no Post Reply (no Facebook identity)', async () => {
        state.pageRow = dealerPage({ facebookPageId: null });
        await expect(catalogScanService.scanPage(WS, PAGE, CTX)).rejects.toBeInstanceOf(CatalogScanUnavailableError);
    });

    // A token that fails to decrypt is as unusable as an absent one — sending it to
    // Graph would burn the merchant's daily scan cap on a call that cannot work.
    it('throws CatalogScanUnavailableError when the stored token cannot be decrypted and no Post Reply exists', async () => {
        state.pageRow = dealerPage({ encryptedAccessToken: CORRUPT_CIPHERTEXT });
        await expect(catalogScanService.scanPage(WS, PAGE, CTX)).rejects.toBeInstanceOf(CatalogScanUnavailableError);
    });

    // THE regression: `pages.access_token` holds ciphertext, so passing the column
    // value straight to Graph made every scan fail (0 of 110 prod pages had ever
    // bookmarked a scan). Assert the DECRYPTED token reaches the Graph call.
    it('sends the decrypted token to Graph, never the stored ciphertext', async () => {
        mockPosts([post()]);

        await catalogScanService.scanPage(WS, PAGE, CTX);

        const [, tokenArg] = vi.mocked(facebookService.getPagePosts).mock.calls[0];
        expect(tokenArg).toBe(PLAINTEXT);
        expect(tokenArg).not.toBe(CIPHERTEXT);
    });

    it('feeds the post text to the extractor with the derived vertical + page framing, and bookmarks the newest post', async () => {
        mockPosts([post()]);

        const result = await catalogScanService.scanPage(WS, PAGE, CTX);

        expect(extractorInput()).toContain('كيا ريو 2018');
        expect(vi.mocked(catalogExtractor.extract).mock.calls[0][1]).toMatchObject({
            userId: 'user-1', pageId: PAGE, vertical: 'vehicles', source: 'page',
        });
        expect(result).toMatchObject({
            postsScanned: 1, repliesScanned: 0, upToDate: false, postsUnavailable: null, items: okExtraction.items,
        });
        expect(state.updates).toHaveLength(1);
        expect(state.updates[0].catalogScanLastPostTime).toEqual(new Date('2026-07-10T10:00:00+0000'));
    });

    it('is idempotent once a catalog exists: posts at/older than the bookmark are skipped → upToDate, no spend, no bookmark write', async () => {
        state.catalogRows = [{ id: 'item-1' }]; // established catalog → bookmark is honored
        state.pageRow = dealerPage({ catalogScanLastPostTime: new Date('2026-07-11T00:00:00Z') });
        mockPosts([post({ createdTime: '2026-07-10T10:00:00+0000' })]);

        const result = await catalogScanService.scanPage(WS, PAGE, CTX);

        expect(result).toMatchObject({ upToDate: true, postsScanned: 0, repliesScanned: 0, items: [] });
        expect(catalogExtractor.extract).not.toHaveBeenCalled();
        expect(state.updates).toHaveLength(0);
    });

    it('EMPTY catalog ignores the bookmark: a first scan that once advanced it can still re-scan the full window', async () => {
        // The deadlock this fixes: a first scan proposed 0 items but advanced the
        // bookmark; with the old logic every later scan returned upToDate forever,
        // stranding the merchant with an empty catalog and no way to re-scan.
        state.catalogRows = []; // still empty
        state.pageRow = dealerPage({ catalogScanLastPostTime: new Date('2026-07-11T00:00:00Z') });
        mockPosts([post({ createdTime: '2026-07-10T10:00:00+0000' })]); // older than the bookmark

        const result = await catalogScanService.scanPage(WS, PAGE, CTX);

        expect(result).toMatchObject({ upToDate: false, postsScanned: 1, items: okExtraction.items });
        expect(catalogExtractor.extract).toHaveBeenCalledTimes(1);
    });

    it('does NOT advance the bookmark when the AI call failed — the posts stay re-scannable', async () => {
        mockPosts([post()]);
        vi.mocked(catalogExtractor.extract).mockResolvedValue({ items: [], dropped: 0, truncated: false, failed: true } as never);

        const result = await catalogScanService.scanPage(WS, PAGE, CTX);

        expect(result).toMatchObject({ failed: true, postsScanned: 1 });
        expect(state.updates).toHaveLength(0);
    });

    it('OCRs Meta-CDN images through the catalog_extraction pipeline and skips foreign URLs', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: new ArrayBuffer(8), headers: { 'content-type': 'image/jpeg' } } as never);
        vi.mocked(extractFromImage).mockResolvedValue({ text: 'تويوتا كورولا 2020', method: 'gpt-vision' } as never);
        mockPosts([post({
            message: null,
            imageUrls: ['https://scontent.xx.fbcdn.net/v/car.jpg', 'https://evil.example.com/car.jpg'],
        })]);

        await catalogScanService.scanPage(WS, PAGE, CTX);

        expect(axios.get).toHaveBeenCalledTimes(1);
        expect(vi.mocked(axios.get).mock.calls[0][0]).toContain('fbcdn.net');
        expect(vi.mocked(extractFromImage).mock.calls[0][2]).toMatchObject({ pipeline: 'catalog_extraction' });
        expect(extractorInput()).toContain('تويوتا كورولا 2020');
    });

    it('bounds Vision spend: at most MAX_IMAGES_PER_POST per post and MAX_SCAN_IMAGES per scan, newest posts first', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: new ArrayBuffer(8), headers: { 'content-type': 'image/jpeg' } } as never);
        vi.mocked(extractFromImage).mockResolvedValue({ text: 'x', method: 'gpt-vision' } as never);
        const manyImages = (n: number, prefix: string) =>
            Array.from({ length: n }, (_, i) => `https://scontent.xx.fbcdn.net/${prefix}-${i}.jpg`);
        mockPosts([
            post({ id: 'p1', createdTime: '2026-07-10T10:00:00+0000', imageUrls: manyImages(8, 'a') }),
            post({ id: 'p2', createdTime: '2026-07-09T10:00:00+0000', imageUrls: manyImages(8, 'b') }),
            post({ id: 'p3', createdTime: '2026-07-08T10:00:00+0000', imageUrls: manyImages(8, 'c') }),
        ]);

        await catalogScanService.scanPage(WS, PAGE, CTX);

        const fetched = vi.mocked(axios.get).mock.calls.map((c) => String(c[0]));
        expect(fetched).toHaveLength(MAX_SCAN_IMAGES);
        expect(fetched.filter((u) => u.includes('/a-'))).toHaveLength(MAX_IMAGES_PER_POST);
        expect(fetched.filter((u) => u.includes('/b-'))).toHaveLength(MAX_IMAGES_PER_POST);
        expect(fetched.filter((u) => u.includes('/c-'))).toHaveLength(MAX_SCAN_IMAGES - 2 * MAX_IMAGES_PER_POST);
    });

    it('a window of unreadable posts (reels/links, no text) still advances the bookmark — nothing was lost', async () => {
        mockPosts([post({ message: null, imageUrls: [] })]);

        const result = await catalogScanService.scanPage(WS, PAGE, CTX);

        expect(result).toMatchObject({ postsScanned: 1, upToDate: false, items: [], failed: false });
        expect(catalogExtractor.extract).not.toHaveBeenCalled();
        expect(state.updates).toHaveLength(1);
    });

    it('a broken image download degrades to text-only, never fails the scan', async () => {
        vi.mocked(axios.get).mockRejectedValue(new Error('CDN 403'));
        mockPosts([post({ imageUrls: ['https://scontent.xx.fbcdn.net/v/car.jpg'] })]);

        const result = await catalogScanService.scanPage(WS, PAGE, CTX);

        expect(result).toMatchObject({ postsScanned: 1, items: okExtraction.items });
        expect(extractorInput()).toContain('كيا ريو');
    });
});

describe('scanPage — configured Post Replies (the merged source, D-059)', () => {
    it('merges a fresh post with ITS configured reply into one block — and spends no image budget on it', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: new ArrayBuffer(8), headers: { 'content-type': 'image/jpeg' } } as never);
        vi.mocked(extractFromImage).mockResolvedValue({ text: 'x', method: 'gpt-vision' } as never);
        state.fbReplyRows = [{
            facebookPostId: 'post-1',
            text: 'كيا ريو 2018',
            triggerReply: 'السعر 90 مليون — والسيارة فحص كامل',
            createdTime: new Date('2026-07-10T10:00:00Z'),
        }];
        mockPosts([post({ imageUrls: ['https://scontent.xx.fbcdn.net/v/car.jpg'] })]);

        const result = await catalogScanService.scanPage(WS, PAGE, CTX);

        const input = extractorInput();
        // ONE block: the post's text and its reply's price together.
        expect(input).toContain('CONFIGURED REPLY: السعر 90 مليون — والسيارة فحص كامل');
        // The reply is merged, not duplicated as a standalone POST REPLY block.
        expect(input).not.toContain('POST REPLY (');
        // The post is already complete (name + price) — its images are skipped.
        expect(axios.get).not.toHaveBeenCalled();
        expect(result).toMatchObject({ postsScanned: 1, repliesScanned: 1, postsUnavailable: null });
    });

    it('a TEXT-LESS post keeps its images even with a reply — the name may only exist in the photo', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: new ArrayBuffer(8), headers: { 'content-type': 'image/jpeg' } } as never);
        vi.mocked(extractFromImage).mockResolvedValue({ text: 'لوحة أسعار الدورات', method: 'gpt-vision' } as never);
        state.fbReplyRows = [{
            facebookPostId: 'post-1', text: null, triggerReply: 'الكلفة 25 ألف', createdTime: new Date('2026-07-10T10:00:00Z'),
        }];
        mockPosts([post({ message: null, imageUrls: ['https://scontent.xx.fbcdn.net/v/board.jpg'] })]);

        await catalogScanService.scanPage(WS, PAGE, CTX);

        expect(axios.get).toHaveBeenCalledTimes(1);
        const input = extractorInput();
        expect(input).toContain('CONFIGURED REPLY: الكلفة 25 ألف');
        expect(input).toContain('لوحة أسعار الدورات');
    });

    it('replies on posts OUTSIDE the window (older than the bookmark) are still scanned — ageless, as standalone blocks', async () => {
        state.catalogRows = [{ id: 'item-1' }];
        state.pageRow = dealerPage({ catalogScanLastPostTime: new Date('2026-07-11T00:00:00Z') });
        state.fbReplyRows = [{
            facebookPostId: 'post-old',
            text: 'كورس المكياج المبتدئ',
            triggerReply: 'الكلفة 25 ألف ل.س',
            createdTime: new Date('2026-06-01T00:00:00Z'),
        }];
        mockPosts([post({ createdTime: '2026-07-10T10:00:00+0000' })]); // older than bookmark → no fresh posts

        const result = await catalogScanService.scanPage(WS, PAGE, CTX);

        // Not "up to date": the replies were (re-)scanned even with no new posts.
        expect(result).toMatchObject({ upToDate: false, postsScanned: 0, repliesScanned: 1 });
        const input = extractorInput();
        expect(input).toContain('POST REPLY (2026-06-01)');
        expect(input).toContain('POST: كورس المكياج المبتدئ');
        expect(input).toContain('REPLY: الكلفة 25 ألف ل.س');
        // No fresh posts consumed → the bookmark must not move.
        expect(state.updates).toHaveLength(0);
    });

    it('includes INSTAGRAM post-replies — an IG-only merchant is not left out', async () => {
        state.igReplyRows = [{
            text: 'كورس التصوير', triggerReply: 'دورة التصوير 75 ألف', createdTime: new Date('2026-07-22T00:00:00Z'),
        }];
        mockPosts([]);

        const result = await catalogScanService.scanPage(WS, PAGE, CTX);

        expect(result).toMatchObject({ repliesScanned: 1, upToDate: false });
        expect(extractorInput()).toContain('REPLY: دورة التصوير 75 ألف');
    });

    it('merges FB + IG newest-first (IG reply dated later leads)', async () => {
        state.fbReplyRows = [{ facebookPostId: 'p-fb', text: 'FB منتج', triggerReply: 'FB سعر 10', createdTime: new Date('2026-07-10T00:00:00Z') }];
        state.igReplyRows = [{ text: 'IG منتج', triggerReply: 'IG سعر 20', createdTime: new Date('2026-07-25T00:00:00Z') }];
        mockPosts([]);

        await catalogScanService.scanPage(WS, PAGE, CTX);

        const input = extractorInput();
        expect(input.indexOf('IG سعر 20')).toBeLessThan(input.indexOf('FB سعر 10'));
    });

    it('a BLOCKED page with replies degrades to a replies-only scan instead of a dead 409', async () => {
        state.pageRow = dealerPage({ encryptedAccessToken: '' }); // disconnected
        state.fbReplyRows = [{ facebookPostId: 'p1', text: 'كورس', triggerReply: 'الكلفة 25 ألف', createdTime: new Date('2026-07-20T00:00:00Z') }];

        const result = await catalogScanService.scanPage(WS, PAGE, CTX);

        expect(facebookService.getPagePosts).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            postsScanned: 0, repliesScanned: 1, upToDate: false, postsUnavailable: 'disconnected', items: okExtraction.items,
        });
        expect(state.updates).toHaveLength(0);
    });

    it('a WhatsApp-only page with IG replies reports noFacebook and still scans them', async () => {
        state.pageRow = dealerPage({ facebookPageId: null });
        state.igReplyRows = [{ text: null, triggerReply: 'السعر 30', createdTime: null }];

        const result = await catalogScanService.scanPage(WS, PAGE, CTX);

        expect(result).toMatchObject({ postsScanned: 0, repliesScanned: 1, postsUnavailable: 'noFacebook' });
    });
});

describe('scanPage — Graph failure honesty (the "up to date" masking regression)', () => {
    // THE regression this suite exists for: getPagePosts is fail-soft (an API
    // error returns an empty page), and the old scan read that emptiness as
    // "no new posts → all up to date" — telling the merchant to go post
    // something new while their token was the thing that broke.
    it('a Graph error is NEVER reported as upToDate — it comes back as postsUnavailable: graph_error', async () => {
        mockPosts([], true);

        const result = await catalogScanService.scanPage(WS, PAGE, CTX);

        expect(result).toMatchObject({
            upToDate: false, postsUnavailable: 'graph_error', postsScanned: 0, repliesScanned: 0, items: [], failed: false,
        });
        expect(catalogExtractor.extract).not.toHaveBeenCalled();
        expect(state.updates).toHaveLength(0);
    });

    it('a Graph error still scans the configured replies (degraded, not dead)', async () => {
        mockPosts([], true);
        state.fbReplyRows = [{ facebookPostId: 'p1', text: 'كورس', triggerReply: 'الكلفة 25 ألف', createdTime: new Date('2026-07-20T00:00:00Z') }];

        const result = await catalogScanService.scanPage(WS, PAGE, CTX);

        expect(result).toMatchObject({
            postsUnavailable: 'graph_error', repliesScanned: 1, upToDate: false, items: okExtraction.items,
        });
        // The window was NOT read — the bookmark must not move.
        expect(state.updates).toHaveLength(0);
    });

    it('an honest upToDate still exists: posts READ successfully, nothing new, no replies', async () => {
        state.catalogRows = [{ id: 'item-1' }];
        state.pageRow = dealerPage({ catalogScanLastPostTime: new Date('2026-07-11T00:00:00Z') });
        mockPosts([post({ createdTime: '2026-07-10T10:00:00+0000' })]);

        const result = await catalogScanService.scanPage(WS, PAGE, CTX);

        expect(result).toMatchObject({ upToDate: true, postsUnavailable: null });
    });
});
