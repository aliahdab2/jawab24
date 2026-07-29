import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The auto-reply readiness gate.
 *
 * Regression intent: a page with NOTHING for the model to answer from must not
 * be allowed to switch auto-reply on, and a page with ANYTHING must not be
 * blocked. The second half matters as much as the first — the obvious wrong
 * implementation here is to reuse `isBusinessInfoProvided` (the activation
 * milestone), which would have refused 14 of the 39 pages that had auto-reply
 * enabled in production on 2026-07-29.
 */

const hoisted = vi.hoisted(() => ({
    catalogRows: [] as Array<{ id: string }>,
    storeContext: {} as { productCatalog?: string; storePolicies?: string },
}));

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(() => ({
            from: () => ({
                where: () => ({
                    limit: () => Promise.resolve(hoisted.catalogRows),
                }),
            }),
        })),
    },
}));

vi.mock('../../src/db/schema', () => ({
    catalogItems: { id: 'id', pageId: 'page_id' },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn(() => 'eq'),
}));

vi.mock('../../src/services/ecommerce', () => ({
    getStoreContextForAI: vi.fn(async () => hoisted.storeContext),
}));

import { findGroundingSource, businessInfoGate } from '../../src/services/businessReadiness';
import { getStoreContextForAI } from '../../src/services/ecommerce';

const page = (overrides: Record<string, unknown> = {}) => ({
    id: 'page-1',
    knowledgeBase: null,
    businessProfile: {},
    ecommerceStoreId: null,
    ...overrides,
});

beforeEach(() => {
    hoisted.catalogRows = [];
    hoisted.storeContext = {};
    vi.clearAllMocks();
});

describe('findGroundingSource — refuses only the genuinely empty page', () => {
    it('returns null for a page with no grounding at all (the WhatsApp-only connect state)', async () => {
        // Exactly what createWhatsAppOnlyPage inserts: no KB, no profile, no
        // store, no catalog. This is the case the gate exists for.
        expect(await findGroundingSource(page())).toBeNull();
    });

    it('treats a null business profile the same as an empty one', async () => {
        expect(await findGroundingSource(page({ businessProfile: null }))).toBeNull();
    });

    it('does not count whitespace-only Business Info as grounding', async () => {
        expect(await findGroundingSource(page({ knowledgeBase: '   \n\t  ' }))).toBeNull();
    });
});

describe('findGroundingSource — every real source counts', () => {
    it('counts merchant-authored Business Info text', async () => {
        expect(await findGroundingSource(page({ knowledgeBase: 'We sell shoes.' })))
            .toBe('knowledge_base');
    });

    it('counts SHORT Business Info text that the activation milestone would reject', async () => {
        // `isBusinessInfoProvided` demands >= 80 chars AND divergence from the FB
        // snapshot. Ten characters still reach `<business_knowledge>` and still
        // let the model answer, so the gate must let this page through. This is
        // the assertion that fails if someone "unifies" the two predicates.
        const short = 'Open 9-5.';
        expect(short.length).toBeLessThan(80);
        expect(await findGroundingSource(page({ knowledgeBase: short }))).toBe('knowledge_base');
    });

    it('counts confirmed structured facts (the BUSINESS_INFO block)', async () => {
        const profile = { merchant: { phones: ['0912345678'] } };
        expect(await findGroundingSource(page({ businessProfile: profile })))
            .toBe('business_info_block');
    });

    it('counts a descriptive Facebook suggestion via the narrative block', async () => {
        // merchant half is empty, so the BUSINESS_INFO block yields nothing — but
        // formatBusinessProfile reads the MERGED half and emits About/Website.
        // A page grounded only this way must still be allowed on.
        const profile = { merchant: {}, suggestions: { about: 'Family bakery in Tripoli' } };
        expect(await findGroundingSource(page({ businessProfile: profile })))
            .toBe('profile_narrative');
    });

    it('counts a live connected store', async () => {
        hoisted.storeContext = { productCatalog: '3 products' };
        expect(await findGroundingSource(page({ ecommerceStoreId: 'store-1' }))).toBe('store');
    });

    it('counts catalog items', async () => {
        hoisted.catalogRows = [{ id: 'item-1' }];
        expect(await findGroundingSource(page())).toBe('catalog');
    });
});

describe('findGroundingSource — a store id alone is not proof', () => {
    it('does not count a store that contributes nothing to the prompt', async () => {
        // The id survives a platform-side uninstall and is set on a live store
        // that synced no summary. getStoreContextForAI returning {} is the
        // pipeline's own answer to "does this store reach the model?".
        hoisted.storeContext = {};
        expect(await findGroundingSource(page({ ecommerceStoreId: 'store-1' }))).toBeNull();
    });
});

describe('businessInfoGate — the shared enable-time guard', () => {
    // The three channel toggles mock this function out, so these are the only
    // tests that exercise its decisions. Keep them here.

    it('refuses a page with nothing to answer from, as a 409', async () => {
        const gate = await businessInfoGate(page());
        expect(gate).toEqual({
            status: 409,
            body: expect.objectContaining({ code: 'BUSINESS_INFO_REQUIRED' }),
        });
    });

    it('allows a grounded page', async () => {
        expect(await businessInfoGate(page({ knowledgeBase: 'We sell shoes.' }))).toBeNull();
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
    ])('skips the gate entirely for a %s page', async (_label, missing) => {
        // A missing page belongs to the caller's own 404 path. Answering 409 here
        // would tell a merchant to fix Business Info on a page that does not
        // exist. Two of the three handlers used to guard this inline and one did
        // not — that inconsistency is why the decision lives in one place now.
        expect(await businessInfoGate(missing)).toBeNull();
    });
});

describe('findGroundingSource — cost', () => {
    it('does not touch the store or catalog when a local source already grounds the page', async () => {
        hoisted.catalogRows = [{ id: 'item-1' }];
        await findGroundingSource(page({ knowledgeBase: 'We sell shoes.', ecommerceStoreId: 'store-1' }));
        // The common path is a grounded page; it must cost zero DB round-trips.
        expect(getStoreContextForAI).not.toHaveBeenCalled();
    });
});
