import { describe, it, expect, vi, afterEach } from 'vitest';
import { facebookService } from '../services/facebook';

/**
 * diagnoseNoPages — classifies WHY /me/accounts came back empty, so the
 * zero-page cohort is segmentable (Instagram-only merchant vs declined
 * permission vs personal account managing nothing). One /debug_token call,
 * never throws.
 */

type TokenInfo = Awaited<ReturnType<typeof facebookService.verifyAccessToken>>;

function tokenInfo(overrides: Partial<TokenInfo>): TokenInfo {
    return {
        isValid: true,
        userId: 'fb-user-1',
        expiresAt: 0,
        scopes: ['email', 'pages_show_list', 'pages_messaging', 'instagram_basic'],
        granularScopes: [],
        ...overrides,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('facebookService.diagnoseNoPages', () => {
    it('classifies a declined pages permission as permissions_declined', async () => {
        vi.spyOn(facebookService, 'verifyAccessToken').mockResolvedValue(
            tokenInfo({ scopes: ['email', 'instagram_basic'] }),
        );

        const result = await facebookService.diagnoseNoPages('tok');

        expect(result.reason).toBe('permissions_declined');
        expect(result.grantedScopes).toEqual(['email', 'instagram_basic']);
    });

    it('classifies authorized-but-unfetchable pages as pages_unreachable', async () => {
        vi.spyOn(facebookService, 'verifyAccessToken').mockResolvedValue(
            tokenInfo({
                granularScopes: [
                    { scope: 'pages_show_list', target_ids: ['page-1', 'page-2'] },
                    { scope: 'pages_messaging', target_ids: ['page-1'] },
                ],
            }),
        );

        const result = await facebookService.diagnoseNoPages('tok');

        expect(result.reason).toBe('pages_unreachable');
        // Deduped across pages_* scopes — page-1 appears twice above.
        expect(result.pageTargetCount).toBe(2);
    });

    it('classifies authorized IG accounts with zero pages as instagram_only', async () => {
        vi.spyOn(facebookService, 'verifyAccessToken').mockResolvedValue(
            tokenInfo({
                granularScopes: [{ scope: 'instagram_basic', target_ids: ['ig-1'] }],
            }),
        );

        const result = await facebookService.diagnoseNoPages('tok');

        expect(result.reason).toBe('instagram_only');
        expect(result.igTargetCount).toBe(1);
    });

    it('classifies full grants with no targets at all as no_pages', async () => {
        vi.spyOn(facebookService, 'verifyAccessToken').mockResolvedValue(tokenInfo({}));

        const result = await facebookService.diagnoseNoPages('tok');

        expect(result.reason).toBe('no_pages');
        expect(result.igTargetCount).toBe(0);
        expect(result.pageTargetCount).toBe(0);
    });

    it('never throws — a failed /debug_token classifies as unknown', async () => {
        vi.spyOn(facebookService, 'verifyAccessToken').mockRejectedValue(
            new Error('Invalid access token'),
        );

        const result = await facebookService.diagnoseNoPages('tok');

        expect(result.reason).toBe('unknown');
        expect(result.grantedScopes).toEqual([]);
    });

    it('prefers pages_unreachable over instagram_only when both targets exist', async () => {
        // A page IS authorized — "your page could not be reached" is the
        // actionable message, not "you look Instagram-only".
        vi.spyOn(facebookService, 'verifyAccessToken').mockResolvedValue(
            tokenInfo({
                granularScopes: [
                    { scope: 'pages_show_list', target_ids: ['page-1'] },
                    { scope: 'instagram_basic', target_ids: ['ig-1'] },
                ],
            }),
        );

        const result = await facebookService.diagnoseNoPages('tok');

        expect(result.reason).toBe('pages_unreachable');
    });
});
