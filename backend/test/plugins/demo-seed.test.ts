import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db before importing seedData
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        query: {
            pages: { findMany: vi.fn() },
        },
    }
}));

import { db } from '../../src/db';
import { seedDemoData, DEMO_PAGES, DEMO_DISTRIBUTOR_COLLECTIONS } from '../../src/plugins/demo/seedData';

// Helper to build a chainable select mock
function mockSelectChain(result: any[]) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(result),
        }),
    };
}

// Helper to build insert chain
function mockInsertChain(result: any = { id: 'new-id', facebookPageId: 'demo_page' }) {
    return {
        values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([result]),
        }),
    };
}

// Helper to build update chain
function mockUpdateChain() {
    return {
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        }),
    };
}

// Helper to build delete chain
function mockDeleteChain() {
    return {
        where: vi.fn().mockResolvedValue(undefined),
    };
}

describe('seedDemoData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should refresh page names when demo pages already exist', async () => {
        // First call: select existing pages → return pages with old names
        const existingPages = [
            { facebookPageId: 'demo_page_institute', name: 'OLD NAME' },
            { facebookPageId: 'demo_page_school', name: 'OLD SCHOOL NAME' },
            { facebookPageId: 'demo_page_electronics', name: 'OLD STORE' },
            { facebookPageId: 'demo_page_fashion', name: 'OLD FASHION' },
        ];
        vi.mocked(db.select).mockReturnValue(mockSelectChain(existingPages) as any);

        // update() calls for refreshing page data
        vi.mocked(db.update).mockReturnValue(mockUpdateChain() as any);

        // delete() + insert() for refreshing notifications
        vi.mocked(db.delete).mockReturnValue(mockDeleteChain() as any);
        vi.mocked(db.insert).mockReturnValue(mockInsertChain() as any);

        await seedDemoData('user-123', 'ws-123');

        // Derived from the fixture list so adding a demo page doesn't break this
        // test: 1 settings dashboardLanguage refresh + one refresh per DEMO_PAGES
        // entry + 2 e-commerce page link updates (Shopify on electronics, Salla
        // on fashion, both via seedDemoStore).
        const SETTINGS_REFRESH = 1;
        const ECOMMERCE_PAGE_LINKS = 2;
        expect(db.update).toHaveBeenCalledTimes(
            SETTINGS_REFRESH + DEMO_PAGES.length + ECOMMERCE_PAGE_LINKS,
        );
    });

    it('should create pages when no demo data exists', async () => {
        // select existing pages → none
        vi.mocked(db.select).mockReturnValue(mockSelectChain([]) as any);

        // insert for settings, pages, posts, comments, notifications
        vi.mocked(db.insert).mockReturnValue(mockInsertChain() as any);

        // update for settings (may not be called if no existing settings)
        vi.mocked(db.update).mockReturnValue(mockUpdateChain() as any);

        // delete for notifications refresh
        vi.mocked(db.delete).mockReturnValue(mockDeleteChain() as any);

        await seedDemoData('user-123', 'ws-123');

        // Should have called insert multiple times (settings + 3 pages + 6 posts + 10 comments + 7 notifications)
        expect(db.insert).toHaveBeenCalled();
        // Should NOT have called update for pages (they are new)
        // The first select returns [] so no update is triggered for pages
    });

    it('seeds e-commerce stores with platformData.demo so real-API paths skip them', async () => {
        // Regression for JAWAB24-BACKEND-19: the demo stores' placeholder tokens are
        // not real ciphertext; without this marker the sync cron / webhook paths
        // pick them up and fail on decrypt. Store seeding only runs for pages that
        // resolve, so use the refresh path with the store-linked pages present.
        const existingPages = [
            { id: 'page-electronics', facebookPageId: 'demo_page_electronics', name: 'OLD STORE' },
            { id: 'page-fashion', facebookPageId: 'demo_page_fashion', name: 'OLD FASHION' },
        ];
        vi.mocked(db.select).mockReturnValue(mockSelectChain(existingPages) as any);
        const insertChain = mockInsertChain();
        vi.mocked(db.insert).mockReturnValue(insertChain as any);
        vi.mocked(db.update).mockReturnValue(mockUpdateChain() as any);
        vi.mocked(db.delete).mockReturnValue(mockDeleteChain() as any);

        await seedDemoData('user-123', 'ws-123');

        const storeInserts = vi.mocked(insertChain.values).mock.calls
            .map(([values]) => values)
            .filter((values: any) => values?.storeDomain && values?.accessToken);
        expect(storeInserts).toHaveLength(2); // Shopify + Salla
        for (const store of storeInserts) {
            expect(store.platformData.demo).toBe(true);
        }
    });
});


/**
 * G1a fixture integrity. The distributor fixture's 236 outlets moved out of KB
 * prose into fact rows, and every eval case in Cat 69 now depends on properties of
 * that data rather than of a paragraph. These assertions machine-check the traps the
 * fixture comment documents — a silent edit to the list would otherwise turn #728 /
 * #737 green without fixing anything.
 */
describe('distributor fact-collections fixture (G1a)', () => {
    const CITY = DEMO_DISTRIBUTOR_COLLECTIONS[0];
    const WEST = DEMO_DISTRIBUTOR_COLLECTIONS[1];
    const keyValues = (c: typeof CITY) => c.rows.map(r => r.slice(r.lastIndexOf(' - ') + 3).trim());
    const allRows = DEMO_DISTRIBUTOR_COLLECTIONS.flatMap(c => c.rows);

    it('keeps the prod-scale directory: 236 entries across two keyed collections', () => {
        expect(allRows).toHaveLength(236);
        expect(CITY.keyAttr).toBe('المنطقة');
        expect(WEST.keyAttr).toBe('المدينة');
        expect(new Set(keyValues(CITY)).size).toBe(22);
        expect(new Set(keyValues(WEST)).size).toBe(3);
    });

    // H2 (the review's dangerous finding): a row with no key value is invisible to
    // the coverage index, and the renderer then refuses to present the index as a
    // boundary at all — silently dropping the mechanism these cases measure.
    it('gives EVERY row a key value, so the coverage index stays a boundary', () => {
        for (const line of allRows) {
            expect(line, `row must be «name - key»: ${line}`).toContain(' - ');
            expect(line.slice(line.lastIndexOf(' - ') + 3).trim().length).toBeGreaterThan(0);
        }
    });

    it('keeps العجيلات out of both collections (#728 / #737 depend on its absence)', () => {
        for (const line of allRows) expect(line).not.toContain('العجيلات');
    });

    it('keeps عين الدالية listed (#729 green guard: a listed area must still be answered)', () => {
        expect(keyValues(CITY)).toContain('عين الدالية');
    });

    // Trap 5: the near-miss pair that reproduces the probe battery's worst class —
    // the business's own address answered as an outlet location.
    it('lists سوق الخميس but never the page own address سوق الثلاثاء', () => {
        expect(keyValues(CITY)).toContain('سوق الخميس');
        expect(keyValues(CITY)).not.toContain('سوق الثلاثاء');
    });

    // #720: the same facts in prose AND rows is the contradiction factory. Prose
    // also carries no boundary, so a restored copy brings the fabrication straight
    // back while the rows make it look fixed.
    it('leaves neither an outlet directory NOR a prose price table in the fixture KB text', () => {
        const distributor = DEMO_PAGES.find(p => p.facebookPageId === 'demo_page_distributor');
        expect(distributor).toBeDefined();
        const kb = distributor?.suggestedKnowledgeBase ?? '';
        expect(kb).not.toContain('صيدلية');
        expect(kb).not.toContain('حي الرمال');
        // The prose price tail used to be asserted PRESENT here. `eaa9c0d4`
        // ("sizes/prices as the second list KIND — un-keyed, and the prose
        // table retires") deliberately moved it to fact rows but did not
        // update this test, leaving main red and blocking every deploy
        // (2026-07-31). Prices now belong to the same #720 rule as the outlet
        // directory — prose alongside rows is the contradiction factory — so
        // the assertion flips from present to absent rather than being dropped.
        expect(kb).not.toContain('45د');
        expect(kb).not.toContain('54 دينار');
    });
});
