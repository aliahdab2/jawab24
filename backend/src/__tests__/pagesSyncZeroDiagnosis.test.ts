import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * syncFromFacebook zero-page branch — when /me/accounts is empty for a
 * workspace with nothing connected, the sync must classify WHY (via
 * facebookService.diagnoseNoPages), record it on the no_fb_pages activation
 * milestone, and hand the diagnosis back to the caller. Established
 * workspaces (existing pages) must get neither the classification call nor
 * the event: their empty re-sync is a token incident, not a prospect.
 */

const { mockGetUserPages, mockDiagnoseNoPages, mockRecordActivationEvent } = vi.hoisted(() => ({
    mockGetUserPages: vi.fn(),
    mockDiagnoseNoPages: vi.fn(),
    mockRecordActivationEvent: vi.fn(),
}));

vi.mock('../services/facebook', () => ({
    facebookService: {
        setLogger: vi.fn(),
        getUserPages: mockGetUserPages,
        diagnoseNoPages: mockDiagnoseNoPages,
    },
}));
vi.mock('../services/activation', () => ({
    recordActivationEvent: mockRecordActivationEvent,
}));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../lib/redis', () => ({ redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));

import { pagesService } from '../services/pages';

const DIAGNOSIS = {
    reason: 'instagram_only' as const,
    igTargetCount: 2,
    pageTargetCount: 0,
    grantedScopes: ['email', 'pages_show_list', 'instagram_basic'],
};

describe('syncFromFacebook — zero pages from Facebook', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUserPages.mockResolvedValue({ data: [] });
        mockDiagnoseNoPages.mockResolvedValue(DIAGNOSIS);
    });

    it('diagnoses, records no_fb_pages with the classification, and returns the diagnosis', async () => {
        vi.spyOn(pagesService, 'getPages').mockResolvedValue([]);

        const result = await pagesService.syncFromFacebook('ws-1', 'user-1', 'user-token');

        expect(mockDiagnoseNoPages).toHaveBeenCalledWith('user-token');
        expect(mockRecordActivationEvent).toHaveBeenCalledWith('user-1', 'no_fb_pages', {
            reason: 'instagram_only',
            igTargetCount: 2,
            pageTargetCount: 0,
            grantedScopes: ['email', 'pages_show_list', 'instagram_basic'],
        });
        expect(result.syncedPages).toEqual([]);
        expect(result.noPagesDiagnosis).toEqual(DIAGNOSIS);
    });

    it('skips classification and the event for an established workspace', async () => {
        vi.spyOn(pagesService, 'getPages').mockResolvedValue([
            { id: 'page-1', facebookPageId: 'fb-1' } as never,
        ]);

        const result = await pagesService.syncFromFacebook('ws-1', 'user-1', 'user-token');

        expect(mockDiagnoseNoPages).not.toHaveBeenCalled();
        expect(mockRecordActivationEvent).not.toHaveBeenCalled();
        expect(result.noPagesDiagnosis).toBeNull();
    });
});
