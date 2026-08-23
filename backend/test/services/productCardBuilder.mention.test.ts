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

// db.select() chain: select → from → where → [orderBy] → limit. The mention
// builder issues up to THREE selects per call (store, catalog titles, then the
// winning product row); `mockLimit` is primed per call, in that order.
const mockLimit = vi.fn();
const defaultSelectChain = () => ({
    from: vi.fn(() => ({
        where: vi.fn(() => ({
            orderBy: vi.fn(() => ({ limit: mockLimit })),
            limit: mockLimit,
        })),
    })),
});
vi.mock('../../src/db', () => ({
    db: { select: vi.fn(() => defaultSelectChain()) },
}));

const mockRedisSet = vi.fn();
const mockRedisMget = vi.fn();
const mockRedisIncr = vi.fn();
const mockPipelineSet = vi.fn();
const mockPipelineExec = vi.fn();
vi.mock('../../src/lib/redis', () => ({
    redis: {
        set: (...args: unknown[]) => mockRedisSet(...args),
        mget: (...args: unknown[]) => mockRedisMget(...args),
        incr: (...args: unknown[]) => mockRedisIncr(...args),
        pipeline: () => ({ set: mockPipelineSet, exec: mockPipelineExec }),
        get: vi.fn(),
        del: vi.fn(),
    },
    redisScanDelete: vi.fn(),
}));

const mockCaptureError = vi.fn();
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

// The URL helpers are production's — imported, not copied (Rule 19.3 / 10.8).
vi.mock('../../src/services/ecommerce', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../src/services/ecommerce')>();
    return { buildProductUrl: real.buildProductUrl, productUrlFor: real.productUrlFor };
});

import {
    buildProductCardsFromReplyText,
    buildProductCardsFromIds,
    filterRecentlySentCards,
    markCardsSent,
} from '../../src/services/reply/productCardBuilder';
import { db } from '../../src/db';
import enMessages from '../../src/i18n/en.json';
import arMessages from '../../src/i18n/ar.json';
import type { ProductCard } from '@jawab24/shared';

const STORE = { platform: 'zid', storeDomain: 'h47p59.zid.store' };

// The live dev-store catalog, as synced 2026-08-22.
const SONY = { id: 'p-sony', title: 'Sony A7S III', handle: 'سونى-a7-الاصدار-التالت', imageUrl: 'https://media.zid.store/sony.jpg', priceRange: '10000 SAR', totalInventory: null };
const GLASSES = { id: 'p-glasses', title: 'نظارة شمسية', handle: 'نظارة-شمسية', imageUrl: 'https://media.zid.store/glasses.jpg', priceRange: '250 SAR', totalInventory: 0 };
const SHOES = { id: 'p-shoes', title: 'Running Shoes', handle: 'حذاء-رياضي', imageUrl: 'https://media.zid.store/shoes.jpg', priceRange: '300 SAR', totalInventory: 0 };
const SHIRT = { id: 'p-shirt', title: 'قميص قطني رجالي', handle: 'قميص-قطني-رجالي', imageUrl: 'https://media.zid.store/shirt.jpg', priceRange: '150 SAR', totalInventory: 7 };
const CATALOG = [SONY, GLASSES, SHOES, SHIRT];

/**
 * Prime the three reads the builder makes. `winner` is the row phase 3 returns;
 * by default the harness resolves it from `products` by the id phase 2 matched,
 * so a test only has to describe the catalog.
 *
 * `null` (not undefined) as the store means "no store row" — an explicit
 * `undefined` would select the default parameter and silently prime the real one.
 */
function primeCatalog(products = CATALOG, store: typeof STORE | null = STORE) {
    mockLimit.mockReset();
    mockLimit
        .mockResolvedValueOnce(store ? [store] : [])
        .mockResolvedValueOnce(products.map(p => ({ id: p.id, title: p.title })))
        // Phase 3 fetches the single winning row. Only reached when exactly one
        // title matched, so returning the first is enough for a one-match test;
        // multi-product catalogs that expect [] never consume this.
        .mockImplementation(async () => products.slice(0, 1));
}

/** Prime a catalog whose winner is a specific row (used when the match is not products[0]). */
function primeCatalogWinner(products: typeof CATALOG, winner: typeof SONY) {
    mockLimit.mockReset();
    mockLimit
        .mockResolvedValueOnce([STORE])
        .mockResolvedValueOnce(products.map(p => ({ id: p.id, title: p.title })))
        .mockImplementation(async () => [winner]);
}

describe('buildProductCardsFromReplyText', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // vi.clearAllMocks() clears CALLS, not implementations — a test that
        // overrides db.select would otherwise leak its chain into the next one.
        vi.mocked(db.select).mockImplementation(() => defaultSelectChain() as never);
        mockRedisIncr.mockResolvedValue(1);
    });

    it('builds ONE card for the single in-stock product the reply names — the live purchase turn', async () => {
        primeCatalog();
        // The exact reply the dev store produced for «طيب بدي اشتري الكاميرا، كيف أطلبها؟».
        const cards = await buildProductCardsFromReplyText(
            'store-1',
            'ممتاز! تقدر تطلب كاميرا Sony A7S III مباشرة من متجرنا عبر الرابط: https://h47p59.zid.store/products/سونى-a7-الاصدار-التالت',
            'ar',
        );

        expect(cards).toEqual([{
            title: 'Sony A7S III',
            subtitle: `10000 SAR · ${arMessages.cardInStock}`,
            imageUrl: SONY.imageUrl,
            productUrl: 'https://h47p59.zid.store/products/سونى-a7-الاصدار-التالت',
            buttons: [{ type: 'web_url', title: arMessages.cardViewProduct, url: 'https://h47p59.zid.store/products/سونى-a7-الاصدار-التالت' }],
        }]);
    });

    it('treats null inventory as unlimited (sellable), not as zero — the F1 rule at the card layer', async () => {
        primeCatalog();
        const cards = await buildProductCardsFromReplyText('store-1', 'Yes, the Sony A7S III camera is in stock right now.', 'en');
        expect(cards).toHaveLength(1);
        expect(cards[0].title).toBe('Sony A7S III');
    });

    it('never sends a buy card for an OUT-OF-STOCK product, even when the reply names exactly one', async () => {
        primeCatalog([GLASSES]);
        // The live reply: correct text, must stay text-only.
        const cards = await buildProductCardsFromReplyText('store-1', 'نظارة شمسية سعرها 250 ريال، لكنها حالياً غير متوفرة في المخزون.', 'ar');
        expect(cards).toEqual([]);
    });

    it('treats a NEGATIVE inventory as out of stock, not as in stock', async () => {
        // An oversold row: Shopify/Salla write this when overselling is allowed.
        // `totalInventory === 0` alone waves it straight through as sellable.
        primeCatalog([{ ...SHIRT, totalInventory: -3 }]);
        expect(await buildProductCardsFromReplyText('store-1', 'عندنا قميص قطني رجالي', 'ar')).toEqual([]);
    });

    it('says LOW STOCK, not "in stock", when the synced count is thin', async () => {
        // The mention path reads a SYNC snapshot, not a live tool call, so it uses
        // the same three-way vocabulary as the catalog block the model answered from.
        primeCatalog([{ ...SHIRT, totalInventory: 3 }]);
        const cards = await buildProductCardsFromReplyText('store-1', 'عندنا قميص قطني رجالي', 'ar');
        expect(cards[0].subtitle).toBe(`150 SAR · ${arMessages.cardLowStock}`);
    });

    it('writes the card in the REPLY language — an Arabic reply never carries an English card', async () => {
        primeCatalog();
        const ar = await buildProductCardsFromReplyText('store-1', 'كاميرا Sony A7S III متوفرة', 'ar');
        expect(ar[0].subtitle).toContain(arMessages.cardInStock);
        expect(ar[0].buttons?.[0].title).toBe(arMessages.cardViewProduct);
        // The strings must be genuinely different per locale, or this proves nothing.
        expect(arMessages.cardViewProduct).not.toBe(enMessages.cardViewProduct);

        primeCatalog();
        const en = await buildProductCardsFromReplyText('store-1', 'the Sony A7S III is available', 'en');
        expect(en[0].buttons?.[0].title).toBe(enMessages.cardViewProduct);
    });

    it('matches case-insensitively', async () => {
        primeCatalog();
        // Reply writes the title in lower case; the catalog title is mixed case.
        expect(await buildProductCardsFromReplyText('store-1', 'the sony a7s iii is available', 'en')).toHaveLength(1);
    });

    it('folds Arabic orthography — an alef variant in the reply still hits a bare-alef title', async () => {
        // MUTATION GUARD: the needle must contain a character the haystack spells
        // differently, or `normalizeArabic` is doing no work and deleting it from
        // foldForMatch leaves this green. Title «آلة قهوة إسبريسو» carries آ and إ;
        // the reply writes both as a bare ا, which only the fold reconciles.
        const COFFEE = { ...SONY, id: 'p-coffee', title: 'آلة قهوة إسبريسو' };
        primeCatalog([COFFEE]);
        const cards = await buildProductCardsFromReplyText('store-1', 'عندنا الة قهوة اسبريسو بسعر ممتاز', 'ar');
        expect(cards).toHaveLength(1);
        expect(cards[0].title).toBe('آلة قهوة إسبريسو');
    });

    it('keeps matching across attached Arabic proclitics — «وقميص» still finds «قميص قطني رجالي»', async () => {
        primeCatalog([SHIRT]);
        expect(await buildProductCardsFromReplyText('store-1', 'عندنا وقميص قطني رجالي بـ 150 ريال', 'ar')).toHaveLength(1);
    });

    it('returns [] when the reply names SEVERAL products — a comparison gets no card', async () => {
        primeCatalog();
        const cards = await buildProductCardsFromReplyText(
            'store-1',
            'عندنا Sony A7S III بـ 10000 ريال وقميص قطني رجالي بـ 150 ريال',
            'ar',
        );
        expect(cards).toEqual([]);
    });

    it('returns [] when the reply names no catalog product', async () => {
        primeCatalog();
        expect(await buildProductCardsFromReplyText('store-1', 'حالياً ما عندي معلومات مؤكدة عن التوصيل للدمام.', 'ar')).toEqual([]);
    });

    it('returns [] for a product with no image or no handle — a card needs both', async () => {
        primeCatalog([{ ...SONY, imageUrl: null }]);
        expect(await buildProductCardsFromReplyText('store-1', 'Sony A7S III is in stock', 'en')).toEqual([]);
        primeCatalog([{ ...SONY, handle: null }]);
        expect(await buildProductCardsFromReplyText('store-1', 'Sony A7S III is in stock', 'en')).toEqual([]);
    });

    it('returns [] when the store row is missing or has no domain', async () => {
        primeCatalog(CATALOG, null);
        expect(await buildProductCardsFromReplyText('store-1', 'Sony A7S III is in stock', 'en')).toEqual([]);
    });

    it('returns [] on an empty reply without touching the DB', async () => {
        expect(await buildProductCardsFromReplyText('store-1', '   ', 'ar')).toEqual([]);
        expect(mockLimit).not.toHaveBeenCalled();
    });

    it('degrades to text-only (never throws) when the DB read fails', async () => {
        mockLimit.mockReset();
        mockLimit.mockRejectedValueOnce(new Error('db down'));
        expect(await buildProductCardsFromReplyText('store-1', 'Sony A7S III is in stock', 'en')).toEqual([]);
    });

    it('ignores titles shorter than 3 characters — too many false positives', async () => {
        primeCatalog([{ ...SONY, title: 'A7' }]);
        expect(await buildProductCardsFromReplyText('store-1', 'the a7 is great', 'en')).toEqual([]);
    });

    it('ignores a SHORT single-word title — a «شحن» line item must not card on «الشحن مجاني»', async () => {
        // Exactly one match, and exactly wrong: the store lists shipping as a
        // sellable product, and every delivery answer would carry its buy card.
        primeCatalog([{ ...SHIRT, id: 'p-ship', title: 'شحن' }]);
        expect(await buildProductCardsFromReplyText('store-1', 'الشحن مجاني للطلبات فوق 200 ريال', 'ar')).toEqual([]);
    });

    it('still cards a LONG single-word title — the floor targets generic words, not one-word products', async () => {
        primeCatalogWinner([{ ...SHIRT, id: 'p-glass', title: 'نظارات' }], { ...SHIRT, id: 'p-glass', title: 'نظارات' } as typeof SONY);
        expect(await buildProductCardsFromReplyText('store-1', 'عندنا نظارات بسعر ممتاز', 'ar')).toHaveLength(1);
    });

    it('does not match a title glued to the END of a longer Latin word', async () => {
        // «Charger» is 7 chars and single-token, so it clears the token floor —
        // this is the case only the LEADING boundary check can reject.
        primeCatalog([{ ...SHIRT, id: 'p-charger', title: 'Charger' }]);
        expect(await buildProductCardsFromReplyText('store-1', 'we fitted a supercharger to it', 'en')).toEqual([]);
    });

    it('still matches an English PLURAL — the boundary is leading-only on purpose', async () => {
        // A trailing boundary check would read this as "names no product". Plurals
        // are how a reply normally names a product; blocking them costs far more
        // real cards than the mid-word collision above.
        const CHARGER = { ...SHIRT, id: 'p-charger', title: 'Charger' };
        primeCatalogWinner([CHARGER], CHARGER as typeof SONY);
        expect(await buildProductCardsFromReplyText('store-1', 'yes, we sell chargers', 'en')).toHaveLength(1);
    });

    it('returns [] rather than deciding "exactly one" over a TRUNCATED catalog', async () => {
        // The scan is capped. A catalog bigger than the cap may hide a SECOND
        // match outside the slice, which is precisely when the "several → none"
        // rule stops holding — so a capped scan must card nothing at all.
        const huge = Array.from({ length: 2001 }, (_, i) => ({ id: `p-${i}`, title: `Product Number ${i}` }));
        mockLimit.mockReset();
        mockLimit
            .mockResolvedValueOnce([STORE])
            .mockResolvedValueOnce(huge);

        expect(await buildProductCardsFromReplyText('store-1', 'Product Number 7 is available', 'en')).toEqual([]);
        // Phase 3 must never run — we bailed before choosing a winner.
        expect(mockLimit).toHaveBeenCalledTimes(2);
    });

    it('orders the catalog scan deterministically so the same reply always decides the same way', async () => {
        // An unordered LIMIT can return a different subset after a VACUUM or a
        // plan flip, which makes a wrong card unreproducible. Assert the ORDER BY
        // link is actually taken rather than the bare `.limit` on `.where`.
        const orderByLimit = vi.fn().mockResolvedValue([]);
        const orderBy = vi.fn(() => ({ limit: orderByLimit }));
        const bareLimit = vi.fn().mockResolvedValue([STORE]);
        vi.mocked(db.select).mockImplementation(() => ({
            from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy, limit: bareLimit })) })),
        }) as never);

        await buildProductCardsFromReplyText('store-1', 'Sony A7S III', 'en');
        expect(orderBy).toHaveBeenCalledTimes(1);
    });

    it('counts every outcome so the feature is measurable in production', async () => {
        primeCatalog();
        await buildProductCardsFromReplyText('store-1', 'Sony A7S III is available', 'en');
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:product_card:mention:fired');

        mockRedisIncr.mockClear();
        primeCatalog();
        await buildProductCardsFromReplyText('store-1', 'nothing relevant here', 'en');
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:product_card:mention:no_match');
    });
});

/**
 * Link cards — the reply's own storefront URL is an exact product identity.
 *
 * PROD 2026-08-23, Salla demo store («Jawab24 Salla Test»): the catalog holds
 * 9 × «فستان» and 5 × «تنورة», so every reply about a skirt was `several_matches`
 * and text-only — while the reply itself linked one specific row
 * (`…/تنورة/p812874023`) whose image and URL were both synced. The customer
 * asked «بدي صورة» and got a markdown "image" of a product page instead of the
 * card that carries the real picture.
 *
 * Salla rows are shaped like the real sync: `handle: null`, canonical
 * `productUrl` (D-097). The builder reads: store → catalog scan → linked rows.
 */
describe('buildProductCardsFromReplyText — link cards', () => {
    const SALLA = { platform: 'salla', storeDomain: 'demostore.salla.sa/dev-jkgsyu3w6pzzfrzw' };
    const SKIRT_79 = { id: 'p-812874023', title: 'تنورة', handle: null, productUrl: 'https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/تنورة/p812874023', imageUrl: 'https://salla-dev.s3.eu-central-1.amazonaws.com/nWzD/a.jpg', priceRange: '79 SAR', totalInventory: 2 };
    const SKIRT_83 = { id: 'p-1437926444', title: 'تنورة', handle: null, productUrl: 'https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/تنورة/p1437926444', imageUrl: 'https://salla-dev.s3.eu-central-1.amazonaws.com/nWzD/b.jpg', priceRange: '83 SAR', totalInventory: 4 };
    const SKIRT_SOLD_OUT = { id: 'p-771999266', title: 'تنورة', handle: null, productUrl: 'https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/تنورة/p771999266', imageUrl: 'https://salla-dev.s3.eu-central-1.amazonaws.com/nWzD/c.jpg', priceRange: '124 SAR', totalInventory: 0 };
    const DRESS = { id: 'p-348732197', title: 'فستان', handle: null, productUrl: 'https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/فستان/p348732197', imageUrl: 'https://salla-dev.s3.eu-central-1.amazonaws.com/nWzD/d.jpg', priceRange: '83 SAR', totalInventory: 7 };
    const SALLA_CATALOG = [SKIRT_79, SKIRT_83, SKIRT_SOLD_OUT, DRESS];

    /** store → scan (id/title/handle/productUrl) → the linked rows, by id. */
    function primeSalla(products = SALLA_CATALOG) {
        mockLimit.mockReset();
        mockLimit
            .mockResolvedValueOnce([SALLA])
            .mockResolvedValueOnce(products.map(p => ({ id: p.id, title: p.title, handle: p.handle, productUrl: p.productUrl })))
            .mockImplementation(async () => products);
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(db.select).mockImplementation(() => defaultSelectChain() as never);
        mockRedisIncr.mockResolvedValue(1);
    });

    it('PROD 2026-08-23: a reply that links one of five same-titled products cards THAT one', async () => {
        primeSalla();
        const cards = await buildProductCardsFromReplyText(
            'store-1',
            'عذرًا على الخطأ، التنورة المتوفرة عندنا بسعر 79 ريال ومقاسات من XS إلى XL، مع مخزون قليل. هذا رابطها: https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/تنورة/p812874023',
            'ar',
        );
        expect(cards).toEqual([{
            title: 'تنورة',
            subtitle: `79 SAR · ${arMessages.cardLowStock}`,
            imageUrl: SKIRT_79.imageUrl,
            productUrl: SKIRT_79.productUrl,
            buttons: [{ type: 'web_url', title: arMessages.cardViewProduct, url: SKIRT_79.productUrl }],
        }]);
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:product_card:link:fired');
        expect(mockRedisIncr).not.toHaveBeenCalledWith('metrics:product_card:mention:several_matches');
    });

    it('two linked products → two cards, in the order the reply links them (a carousel)', async () => {
        primeSalla();
        const cards = await buildProductCardsFromReplyText(
            'store-1',
            'أكيد، هذي التنانير اللي ذكرتها:\nتنورة 83 ريال: https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/تنورة/p1437926444\nتنورة 79 ريال: https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/تنورة/p812874023',
            'ar',
        );
        expect(cards.map(c => c.productUrl)).toEqual([SKIRT_83.productUrl, SKIRT_79.productUrl]);
    });

    it('matches the percent-encoded form of an Arabic path the model sometimes emits', async () => {
        primeSalla();
        const cards = await buildProductCardsFromReplyText(
            'store-1',
            'رابط الفستان: https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/%D9%81%D8%B3%D8%AA%D8%A7%D9%86/p348732197.',
            'ar',
        );
        expect(cards.map(c => c.productUrl)).toEqual([DRESS.productUrl]);
    });

    it('never cards a linked product that is sold out', async () => {
        primeSalla();
        const cards = await buildProductCardsFromReplyText(
            'store-1',
            'هذه التنورة حالياً غير متوفرة: https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/تنورة/p771999266',
            'ar',
        );
        expect(cards).toEqual([]);
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:product_card:link:out_of_stock');
    });

    it('a link that is not a catalog product leaves the title rule in charge (here: «تنورة» is under the single-token floor → no card)', async () => {
        primeSalla();
        const cards = await buildProductCardsFromReplyText(
            'store-1',
            'عندنا تنانير كثيرة، تقدر تشوفها هنا: https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/search?q=تنورة',
            'ar',
        );
        expect(cards).toEqual([]);
        expect(mockRedisIncr).not.toHaveBeenCalledWith('metrics:product_card:link:fired');
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:product_card:mention:no_match');
    });
});

describe('card cooldown', () => {
    const card = (url: string): ProductCard => ({ title: 't', subtitle: 's', imageUrl: 'i', productUrl: url });

    beforeEach(() => {
        vi.clearAllMocks();
        mockPipelineExec.mockResolvedValue([]);
    });

    it('keeps a card whose window is not open, drops one whose window is', async () => {
        mockRedisMget.mockResolvedValue([null, '1']);

        const kept = await filterRecentlySentCards('page-1', 'psid-1', [card('u1'), card('u2')]);

        expect(kept.map(c => c.productUrl)).toEqual(['u1']);
        expect(mockRedisMget).toHaveBeenCalledWith('product_card:page-1:psid-1:u1', 'product_card:page-1:psid-1:u2');
    });

    it('does NOT open the window — filtering is a read, so a card that never ships is not suppressed', async () => {
        // The whole point of splitting read from write: claiming the key up front
        // meant a failed send silenced the card for 24h, which is the one outcome
        // the "fails open" contract exists to prevent.
        mockRedisMget.mockResolvedValue([null]);
        await filterRecentlySentCards('page-1', 'psid-1', [card('u1')]);
        expect(mockPipelineSet).not.toHaveBeenCalled();
        expect(mockRedisSet).not.toHaveBeenCalled();
    });

    it('opens a 24h window per (page, customer, product) once the send succeeded', async () => {
        await markCardsSent('page-1', 'psid-1', [card('u1')]);
        expect(mockPipelineSet).toHaveBeenCalledWith('product_card:page-1:psid-1:u1', '1', 'EX', 86400);
        expect(mockPipelineExec).toHaveBeenCalled();
    });

    it('scopes the cooldown per customer — another customer still gets the card', async () => {
        mockRedisMget.mockResolvedValue([null]);
        const other = await filterRecentlySentCards('page-1', 'psid-2', [card('u1')]);
        expect(other).toHaveLength(1);
        expect(mockRedisMget).toHaveBeenCalledWith('product_card:page-1:psid-2:u1');
    });

    it('fails OPEN and REPORTS — a Redis failure keeps the card but never goes silent', async () => {
        mockRedisMget.mockRejectedValue(new Error('redis down'));
        expect(await filterRecentlySentCards('page-1', 'psid-1', [card('u1')])).toHaveLength(1);
        // A silently broken cooldown looks exactly like "merchants report card
        // spam" with nothing in Sentry to connect it to.
        expect(mockCaptureError).toHaveBeenCalled();
    });

    it('reports a failed cooldown WRITE instead of swallowing it', async () => {
        mockPipelineExec.mockRejectedValue(new Error('redis down'));
        await expect(markCardsSent('page-1', 'psid-1', [card('u1')])).resolves.toBeUndefined();
        expect(mockCaptureError).toHaveBeenCalled();
    });

    it('is a no-op on an empty list without touching Redis', async () => {
        expect(await filterRecentlySentCards('page-1', 'psid-1', [])).toEqual([]);
        await markCardsSent('page-1', 'psid-1', []);
        expect(mockRedisMget).not.toHaveBeenCalled();
        expect(mockPipelineSet).not.toHaveBeenCalled();
    });
});

/**
 * Model-named cards (D-099 `respond.product_ids`) — keyed on the platform
 * product id the catalog block prints as `(ID: …)`. Reads: store → the rows
 * for those ids (one query). Order is the model's; unknown ids are counted.
 */
describe('buildProductCardsFromIds', () => {
    const SALLA = { platform: 'salla', storeDomain: 'demostore.salla.sa/dev-jkgsyu3w6pzzfrzw' };
    const SKIRT = { id: 'p-1', platformProductId: '812874023', title: 'تنورة', handle: null, productUrl: 'https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/تنورة/p812874023', imageUrl: 'https://cdn/a.jpg', priceRange: '79 SAR', totalInventory: 2 };
    const DRESS = { id: 'p-2', platformProductId: '348732197', title: 'فستان', handle: null, productUrl: 'https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/فستان/p348732197', imageUrl: 'https://cdn/d.jpg', priceRange: '83 SAR', totalInventory: 7 };
    const SOLD_OUT = { id: 'p-3', platformProductId: '771999266', title: 'تنورة', handle: null, productUrl: 'https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/تنورة/p771999266', imageUrl: 'https://cdn/c.jpg', priceRange: '124 SAR', totalInventory: 0 };

    function primeRows(rows: Array<typeof SKIRT>) {
        mockLimit.mockReset();
        mockLimit.mockResolvedValueOnce([SALLA]).mockResolvedValueOnce(rows);
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(db.select).mockImplementation(() => defaultSelectChain() as never);
        mockRedisIncr.mockResolvedValue(1);
    });

    it('cards the named products in the MODEL\'s order, whatever order the rows came back in', async () => {
        primeRows([SKIRT, DRESS]);
        const cards = await buildProductCardsFromIds('store-1', ['348732197', '812874023'], 'ar');
        expect(cards.map(c => c.productUrl)).toEqual([DRESS.productUrl, SKIRT.productUrl]);
        expect(cards[0].subtitle).toBe(`83 SAR · ${arMessages.cardInStock}`);
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:product_card:model:fired');
    });

    it('an id the catalog does not hold is counted and skipped — never guessed', async () => {
        primeRows([SKIRT]);
        const cards = await buildProductCardsFromIds('store-1', ['nope', '812874023'], 'ar');
        expect(cards.map(c => c.productUrl)).toEqual([SKIRT.productUrl]);
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:product_card:model:unknown_id');
    });

    it('never cards a named product that is sold out', async () => {
        primeRows([SOLD_OUT]);
        expect(await buildProductCardsFromIds('store-1', ['771999266'], 'ar')).toEqual([]);
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:product_card:model:out_of_stock');
    });

    it('no ids → no reads, no cards', async () => {
        expect(await buildProductCardsFromIds('store-1', [], 'ar')).toEqual([]);
        expect(db.select).not.toHaveBeenCalled();
    });
});
