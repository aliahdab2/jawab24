/**
 * catalogScan unit tests — the orchestration rules that make the posts-scan
 * safe to re-run: bookmark only advances on success, image budget is bounded,
 * only Meta CDN images are fetched, and the page's vertical + posts framing
 * reach the extractor. Fixture is the car-dealer archetype (the "علق بنقطة"
 * merchants) — the segment this flow must serve best.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
    pageRow: undefined as Record<string, unknown> | undefined,
    /** Rows the catalog-existence probe returns — [] = empty catalog (bookmark
     *  ignored), non-empty = an established catalog (bookmark respected). */
    catalogRows: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
};

vi.mock('../../src/db', () => ({
    db: {
        // Two selects run: the page load (projection has `facebookPageId`) and the
        // catalog-existence probe. Route by projection so order can't confuse them.
        select: (cols?: Record<string, unknown>) => ({
            from: () => ({ where: () => ({ limit: async () =>
                cols && 'facebookPageId' in cols ? (state.pageRow ? [state.pageRow] : []) : state.catalogRows,
            }) }),
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

function mockPosts(posts: unknown[]) {
    vi.mocked(facebookService.getPagePosts).mockResolvedValue({ posts, nextCursor: null } as never);
}

describe('catalogScanService.scanPosts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.pageRow = dealerPage();
        state.catalogRows = [];
        state.updates = [];
        vi.mocked(catalogExtractor.extract).mockResolvedValue(okExtraction as never);
    });

    it('returns null for a page outside the workspace (controller → 404)', async () => {
        state.pageRow = undefined;
        expect(await catalogScanService.scanPosts(WS, PAGE, CTX)).toBeNull();
    });

    it('throws the store conflict for store-linked pages', async () => {
        state.pageRow = dealerPage({ ecommerceStoreId: 'store-1' });
        await expect(catalogScanService.scanPosts(WS, PAGE, CTX)).rejects.toBeInstanceOf(CatalogStoreConflictError);
    });

    it('throws CatalogScanUnavailableError for a disconnected page (blank token)', async () => {
        state.pageRow = dealerPage({ encryptedAccessToken: '' });
        await expect(catalogScanService.scanPosts(WS, PAGE, CTX)).rejects.toBeInstanceOf(CatalogScanUnavailableError);
    });

    it('throws CatalogScanUnavailableError for a WhatsApp-only page (no Facebook identity)', async () => {
        state.pageRow = dealerPage({ facebookPageId: null });
        await expect(catalogScanService.scanPosts(WS, PAGE, CTX)).rejects.toBeInstanceOf(CatalogScanUnavailableError);
    });

    // A token that fails to decrypt is as unusable as an absent one — sending it to
    // Graph would burn the merchant's daily scan cap on a call that cannot work.
    it('throws CatalogScanUnavailableError when the stored token cannot be decrypted', async () => {
        state.pageRow = dealerPage({ encryptedAccessToken: CORRUPT_CIPHERTEXT });
        await expect(catalogScanService.scanPosts(WS, PAGE, CTX)).rejects.toBeInstanceOf(CatalogScanUnavailableError);
    });

    // THE regression: `pages.access_token` holds ciphertext, so passing the column
    // value straight to Graph made every scan fail (0 of 110 prod pages had ever
    // bookmarked a scan). Assert the DECRYPTED token reaches the Graph call.
    it('sends the decrypted token to Graph, never the stored ciphertext', async () => {
        mockPosts([post()]);

        await catalogScanService.scanPosts(WS, PAGE, CTX);

        const [, tokenArg] = vi.mocked(facebookService.getPagePosts).mock.calls[0];
        expect(tokenArg).toBe(PLAINTEXT);
        expect(tokenArg).not.toBe(CIPHERTEXT);
    });

    it('feeds the post text to the extractor with the derived vertical + posts framing, and bookmarks the newest post', async () => {
        mockPosts([post()]);

        const result = await catalogScanService.scanPosts(WS, PAGE, CTX);

        expect(vi.mocked(catalogExtractor.extract).mock.calls[0][0]).toContain('كيا ريو 2018');
        expect(vi.mocked(catalogExtractor.extract).mock.calls[0][1]).toMatchObject({
            userId: 'user-1', pageId: PAGE, vertical: 'vehicles', source: 'posts',
        });
        expect(result).toMatchObject({ postsScanned: 1, upToDate: false, items: okExtraction.items });
        expect(state.updates).toHaveLength(1);
        expect(state.updates[0].catalogScanLastPostTime).toEqual(new Date('2026-07-10T10:00:00+0000'));
    });

    it('is idempotent once a catalog exists: posts at/older than the bookmark are skipped → upToDate, no spend, no bookmark write', async () => {
        state.catalogRows = [{ id: 'item-1' }]; // established catalog → bookmark is honored
        state.pageRow = dealerPage({ catalogScanLastPostTime: new Date('2026-07-11T00:00:00Z') });
        mockPosts([post({ createdTime: '2026-07-10T10:00:00+0000' })]);

        const result = await catalogScanService.scanPosts(WS, PAGE, CTX);

        expect(result).toMatchObject({ upToDate: true, postsScanned: 0, items: [] });
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

        const result = await catalogScanService.scanPosts(WS, PAGE, CTX);

        expect(result).toMatchObject({ upToDate: false, postsScanned: 1, items: okExtraction.items });
        expect(catalogExtractor.extract).toHaveBeenCalledTimes(1);
    });

    it('does NOT advance the bookmark when the AI call failed — the posts stay re-scannable', async () => {
        mockPosts([post()]);
        vi.mocked(catalogExtractor.extract).mockResolvedValue({ items: [], dropped: 0, truncated: false, failed: true } as never);

        const result = await catalogScanService.scanPosts(WS, PAGE, CTX);

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

        await catalogScanService.scanPosts(WS, PAGE, CTX);

        expect(axios.get).toHaveBeenCalledTimes(1);
        expect(vi.mocked(axios.get).mock.calls[0][0]).toContain('fbcdn.net');
        expect(vi.mocked(extractFromImage).mock.calls[0][2]).toMatchObject({ pipeline: 'catalog_extraction' });
        expect(vi.mocked(catalogExtractor.extract).mock.calls[0][0]).toContain('تويوتا كورولا 2020');
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

        await catalogScanService.scanPosts(WS, PAGE, CTX);

        const fetched = vi.mocked(axios.get).mock.calls.map((c) => String(c[0]));
        expect(fetched).toHaveLength(MAX_SCAN_IMAGES);
        expect(fetched.filter((u) => u.includes('/a-'))).toHaveLength(MAX_IMAGES_PER_POST);
        expect(fetched.filter((u) => u.includes('/b-'))).toHaveLength(MAX_IMAGES_PER_POST);
        expect(fetched.filter((u) => u.includes('/c-'))).toHaveLength(MAX_SCAN_IMAGES - 2 * MAX_IMAGES_PER_POST);
    });

    it('a window of unreadable posts (reels/links, no text) still advances the bookmark — nothing was lost', async () => {
        mockPosts([post({ message: null, imageUrls: [] })]);

        const result = await catalogScanService.scanPosts(WS, PAGE, CTX);

        expect(result).toMatchObject({ postsScanned: 1, upToDate: false, items: [], failed: false });
        expect(catalogExtractor.extract).not.toHaveBeenCalled();
        expect(state.updates).toHaveLength(1);
    });

    it('a broken image download degrades to text-only, never fails the scan', async () => {
        vi.mocked(axios.get).mockRejectedValue(new Error('CDN 403'));
        mockPosts([post({ imageUrls: ['https://scontent.xx.fbcdn.net/v/car.jpg'] })]);

        const result = await catalogScanService.scanPosts(WS, PAGE, CTX);

        expect(result).toMatchObject({ postsScanned: 1, items: okExtraction.items });
        expect(vi.mocked(catalogExtractor.extract).mock.calls[0][0]).toContain('كيا ريو');
    });
});
