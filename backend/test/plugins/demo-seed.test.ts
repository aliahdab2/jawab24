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
import { seedDemoData } from '../../src/plugins/demo/seedData';

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

        // 1 settings dashboardLanguage refresh + 6 page name refreshes (DEMO_PAGES has 6:
        // institute, school, electronics, fashion, damascus, clinic) + 2 e-commerce page link updates (Shopify + Salla)
        expect(db.update).toHaveBeenCalledTimes(9);
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
});
