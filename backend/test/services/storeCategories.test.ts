/**
 * `saveStoreCategories` / `storeCategoriesOf` — the category links a Salla
 * product sync persists on `ecommerce_stores.platform_data` and the catalog
 * block reads back (2026-08-23: the skirts-category link a customer asked for
 * existed in Salla's payload and was discarded).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
    capturedUpdateSet: undefined as Record<string, unknown> | undefined,
    updateCalls: 0,
}));

vi.mock('../../src/config', () => ({
    config: { shopify: { tokenEncryptionKey: 'test-encryption-key-must-be-32-chars-long!!' } },
}));
vi.mock('../../src/lib/redis', () => ({ redis: {}, redisScanDelete: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/customerNotifications', () => ({
    customerNotificationService: { seedDefaults: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));
vi.mock('../../src/db', () => ({
    db: {
        update: vi.fn().mockReturnValue({
            set: vi.fn().mockImplementation((set: Record<string, unknown>) => {
                state.capturedUpdateSet = set;
                state.updateCalls++;
                return { where: vi.fn().mockResolvedValue(undefined) };
            }),
        }),
    },
}));

import { saveStoreCategories, storeCategoriesOf, STORE_CATEGORIES_MAX } from '../../src/services/ecommerce';

/** The jsonb merge is a SQL expression; read the JSON patch parameter back out of it. */
function patchOf(set: Record<string, unknown> | undefined): Record<string, unknown> {
    // drizzle keeps a bound string parameter as a bare string in `queryChunks`
    // (literal SQL pieces are StringChunk objects).
    const expr = set?.platformData as { queryChunks?: unknown[] } | undefined;
    const param = (expr?.queryChunks ?? []).find((c): c is string => typeof c === 'string');
    if (!param) throw new Error('no JSON patch param in the platformData expression');
    return JSON.parse(param) as Record<string, unknown>;
}

describe('saveStoreCategories', () => {
    beforeEach(() => {
        state.capturedUpdateSet = undefined;
        state.updateCalls = 0;
    });

    it('writes ONE atomic merge with the categories de-duplicated, sorted by name and capped', async () => {
        const many = Array.from({ length: STORE_CATEGORIES_MAX + 5 }, (_, i) => ({ name: `قسم ${String(i).padStart(2, '0')}`, url: `https://s.salla.sa/c${i}` }));
        await saveStoreCategories('store-1', [
            { name: 'فساتين', url: 'https://s.salla.sa/c2' },
            { name: 'تنانير', url: 'https://s.salla.sa/c1' },
            { name: 'تنانير', url: 'https://s.salla.sa/c1-dup' }, // same name → first wins
            { name: '   ', url: 'https://s.salla.sa/blank' },      // dropped
            { name: 'بلا رابط', url: '' },                          // dropped
            ...many,
        ]);

        expect(state.updateCalls).toBe(1);
        const patch = patchOf(state.capturedUpdateSet);
        const categories = patch.categories as Array<{ name: string; url: string }>;
        expect(categories).toHaveLength(STORE_CATEGORIES_MAX);
        expect(categories.map(c => c.name)).toEqual([...categories.map(c => c.name)].sort());
        expect(categories.find(c => c.name === 'تنانير')?.url).toBe('https://s.salla.sa/c1');
        expect(categories.some(c => c.name.trim() === '' || c.url === '')).toBe(false);
        // Only the categories key is in the patch — merchantId/webhookStatus/tokenHealth are untouched by construction.
        expect(Object.keys(patch)).toEqual(['categories']);
    });

    it('is a NO-OP for an empty or all-invalid list — never wipes the links a customer was just given', async () => {
        await saveStoreCategories('store-1', []);
        await saveStoreCategories('store-1', [{ name: 'x', url: '' }]);
        expect(state.updateCalls).toBe(0);
    });
});

describe('storeCategoriesOf', () => {
    it('reads a well-formed list back, capped', () => {
        const list = Array.from({ length: STORE_CATEGORIES_MAX + 3 }, (_, i) => ({ name: `c${i}`, url: `https://x/c${i}` }));
        expect(storeCategoriesOf({ merchantId: '1', categories: list })).toHaveLength(STORE_CATEGORIES_MAX);
    });

    it('returns [] for a missing, null or malformed value and drops malformed entries', () => {
        expect(storeCategoriesOf(undefined)).toEqual([]);
        expect(storeCategoriesOf(null)).toEqual([]);
        expect(storeCategoriesOf({ categories: 'nope' })).toEqual([]);
        expect(storeCategoriesOf({ categories: [{ name: 'ok', url: 'https://x/c1' }, { name: 'no-url' }, 42, null] }))
            .toEqual([{ name: 'ok', url: 'https://x/c1' }]);
    });
});
