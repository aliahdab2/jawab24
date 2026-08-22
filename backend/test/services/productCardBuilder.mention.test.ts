/**
 * Mention cards + the per-customer card cooldown.
 *
 * WHY THESE EXIST: tool-result cards only fire when the model calls
 * `check_inventory`. A small catalog is inlined in the prompt whole, so the
 * model answers directly and never calls a tool — every new marketplace
 * merchant. Live on the Zid dev store (2026-08-22) the purchase turn got a
 * correct text reply and no card while image, URL and stock all sat in the DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// db.select() chain: select → from → where → limit. The builder issues TWO
// selects per call (store, then products); `mockLimit` is primed per call.
const mockLimit = vi.fn();
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: mockLimit,
                })),
            })),
        })),
    },
}));

const mockRedisSet = vi.fn();
vi.mock('../../src/lib/redis', () => ({
    redis: { set: (...args: unknown[]) => mockRedisSet(...args), get: vi.fn(), del: vi.fn() },
    redisScanDelete: vi.fn(),
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

// The URL builder is production's — imported, not copied (Rule 19.3 / 10.8).
vi.mock('../../src/services/ecommerce', () => ({
    buildProductUrl: (platform: string, domain: string, handle: string) =>
        platform === 'salla' ? `https://${domain}/p/${handle}` : `https://${domain}/products/${handle}`,
}));

import {
    buildProductCardsFromReplyText,
    filterRecentlySentCards,
} from '../../src/services/reply/productCardBuilder';
import type { ProductCard } from '@jawab24/shared';

const STORE = { platform: 'zid', storeDomain: 'h47p59.zid.store' };

// The live dev-store catalog, as synced 2026-08-22.
const SONY = { title: 'Sony A7S III', handle: 'سونى-a7-الاصدار-التالت', imageUrl: 'https://media.zid.store/sony.jpg', priceRange: '10000 SAR', totalInventory: null };
const GLASSES = { title: 'نظارة شمسية', handle: 'نظارة-شمسية', imageUrl: 'https://media.zid.store/glasses.jpg', priceRange: '250 SAR', totalInventory: 0 };
const SHOES = { title: 'Running Shoes', handle: 'حذاء-رياضي', imageUrl: 'https://media.zid.store/shoes.jpg', priceRange: '300 SAR', totalInventory: 0 };
const SHIRT = { title: 'قميص قطني رجالي', handle: 'قميص-قطني-رجالي', imageUrl: 'https://media.zid.store/shirt.jpg', priceRange: '150 SAR', totalInventory: 7 };
const CATALOG = [SONY, GLASSES, SHOES, SHIRT];

// `null` (not undefined) means "no store row" — an explicit `undefined` would
// select the default parameter and silently prime the real store.
function primeCatalog(products = CATALOG, store: typeof STORE | null = STORE) {
    mockLimit.mockReset();
    mockLimit.mockResolvedValueOnce(store ? [store] : []).mockResolvedValueOnce(products);
}

describe('buildProductCardsFromReplyText', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('builds ONE card for the single in-stock product the reply names — the live purchase turn', async () => {
        primeCatalog();
        // The exact reply the dev store produced for «طيب بدي اشتري الكاميرا، كيف أطلبها؟».
        const cards = await buildProductCardsFromReplyText(
            'store-1',
            'ممتاز! تقدر تطلب كاميرا Sony A7S III مباشرة من متجرنا عبر الرابط: https://h47p59.zid.store/products/سونى-a7-الاصدار-التالت',
        );

        expect(cards).toEqual([{
            title: 'Sony A7S III',
            subtitle: '10000 SAR · In stock',
            imageUrl: SONY.imageUrl,
            productUrl: 'https://h47p59.zid.store/products/سونى-a7-الاصدار-التالت',
            buttons: [{ type: 'web_url', title: 'View product', url: 'https://h47p59.zid.store/products/سونى-a7-الاصدار-التالت' }],
        }]);
    });

    it('treats null inventory as unlimited (sellable), not as zero — the F1 rule at the card layer', async () => {
        primeCatalog();
        const cards = await buildProductCardsFromReplyText('store-1', 'Yes, the Sony A7S III camera is in stock right now.');
        expect(cards).toHaveLength(1);
        expect(cards[0].title).toBe('Sony A7S III');
    });

    it('never sends a buy card for an OUT-OF-STOCK product, even when the reply names exactly one', async () => {
        primeCatalog();
        // The live reply: correct text, must stay text-only.
        const cards = await buildProductCardsFromReplyText('store-1', 'نظارة شمسية سعرها 250 ريال، لكنها حالياً غير متوفرة في المخزون.');
        expect(cards).toEqual([]);
    });

    it('matches case-insensitively and with Arabic folding', async () => {
        primeCatalog();
        // Reply writes the title in lower case; the catalog title is mixed case.
        expect(await buildProductCardsFromReplyText('store-1', 'the sony a7s iii is available')).toHaveLength(1);
        // Alef variant drift (أ vs ا) in the reply must still hit the Arabic title.
        primeCatalog();
        expect(await buildProductCardsFromReplyText('store-1', 'عندنا قميص قطني رجالي بـ 150 ريال')).toHaveLength(1);
    });

    it('returns [] when the reply names SEVERAL products — a comparison gets no card', async () => {
        primeCatalog();
        const cards = await buildProductCardsFromReplyText(
            'store-1',
            'عندنا Sony A7S III بـ 10000 ريال وقميص قطني رجالي بـ 150 ريال',
        );
        expect(cards).toEqual([]);
    });

    it('returns [] when the reply names no catalog product', async () => {
        primeCatalog();
        expect(await buildProductCardsFromReplyText('store-1', 'حالياً ما عندي معلومات مؤكدة عن التوصيل للدمام.')).toEqual([]);
    });

    it('returns [] for a product with no image or no handle — a card needs both', async () => {
        primeCatalog([{ ...SONY, imageUrl: null }]);
        expect(await buildProductCardsFromReplyText('store-1', 'Sony A7S III is in stock')).toEqual([]);
        primeCatalog([{ ...SONY, handle: null }]);
        expect(await buildProductCardsFromReplyText('store-1', 'Sony A7S III is in stock')).toEqual([]);
    });

    it('returns [] when the store row is missing or has no domain', async () => {
        primeCatalog(CATALOG, null);
        expect(await buildProductCardsFromReplyText('store-1', 'Sony A7S III is in stock')).toEqual([]);
    });

    it('returns [] on an empty reply without touching the DB', async () => {
        expect(await buildProductCardsFromReplyText('store-1', '   ')).toEqual([]);
        expect(mockLimit).not.toHaveBeenCalled();
    });

    it('degrades to text-only (never throws) when the DB read fails', async () => {
        mockLimit.mockReset();
        mockLimit.mockRejectedValueOnce(new Error('db down'));
        expect(await buildProductCardsFromReplyText('store-1', 'Sony A7S III is in stock')).toEqual([]);
    });

    it('ignores titles shorter than 3 characters — too many false positives', async () => {
        primeCatalog([{ ...SONY, title: 'A7' }]);
        expect(await buildProductCardsFromReplyText('store-1', 'the a7 is great')).toEqual([]);
    });

    it('uses the platform-correct URL shape', async () => {
        primeCatalog([SHIRT], { platform: 'salla', storeDomain: 'demo.salla.sa' });
        const cards = await buildProductCardsFromReplyText('store-1', 'عندنا قميص قطني رجالي');
        expect(cards[0].productUrl).toBe('https://demo.salla.sa/p/قميص-قطني-رجالي');
    });
});

describe('filterRecentlySentCards', () => {
    const card = (url: string): ProductCard => ({ title: 't', subtitle: 's', imageUrl: 'i', productUrl: url });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('keeps a card the first time and drops it within the cooldown', async () => {
        mockRedisSet.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

        const first = await filterRecentlySentCards('page-1', 'psid-1', [card('u1')]);
        const second = await filterRecentlySentCards('page-1', 'psid-1', [card('u1')]);

        expect(first).toHaveLength(1);
        expect(second).toEqual([]);
        // SET NX EX, keyed by page + customer + product — the away-message shape.
        expect(mockRedisSet).toHaveBeenCalledWith('product_card:page-1:psid-1:u1', '1', 'EX', 86400, 'NX');
    });

    it('scopes the cooldown per customer — another customer still gets the card', async () => {
        mockRedisSet.mockResolvedValue('OK');
        const other = await filterRecentlySentCards('page-1', 'psid-2', [card('u1')]);
        expect(other).toHaveLength(1);
        expect(mockRedisSet).toHaveBeenCalledWith('product_card:page-1:psid-2:u1', '1', 'EX', 86400, 'NX');
    });

    it('fails OPEN — a Redis failure keeps the card rather than losing the sales moment', async () => {
        mockRedisSet.mockRejectedValue(new Error('redis down'));
        expect(await filterRecentlySentCards('page-1', 'psid-1', [card('u1')])).toHaveLength(1);
    });

    it('is a no-op on an empty list without touching Redis', async () => {
        expect(await filterRecentlySentCards('page-1', 'psid-1', [])).toEqual([]);
        expect(mockRedisSet).not.toHaveBeenCalled();
    });
});
