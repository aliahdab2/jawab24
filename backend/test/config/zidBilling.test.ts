import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/index', () => ({
    config: { zid: { appId: '7367', appMarketUrl: '' } },
}));

import { config } from '../../src/config/index';
import { buildZidManageUrl, buildZidDashboardAppUrl } from '../../src/config/zidBilling';

/**
 * The merchant-dashboard deep link, observed live 2026-08-30 on the dev store:
 * `dashboard.zid.sa/{ar-sa|en-sa}/stores/{merchantId}/apps/7367/plans` is where
 * the app's Overview page sends "Upgrade plan" / "Manage". Until then the Zid
 * pricing banner suppressed Stripe with nothing to click (D-073 forbids guessing).
 */
describe('buildZidDashboardAppUrl', () => {
    it('builds the observed shape, Arabic dashboard by default', () => {
        expect(buildZidDashboardAppUrl('3195980', 'plans'))
            .toBe('https://dashboard.zid.sa/ar-sa/stores/3195980/apps/7367/plans');
        expect(buildZidDashboardAppUrl('3195980', 'embedded', 'en'))
            .toBe('https://dashboard.zid.sa/en-sa/stores/3195980/apps/7367/embedded');
    });

    it('URL-encodes the identifiers it is handed', () => {
        expect(buildZidDashboardAppUrl('a b/c', 'plans')).toContain('/stores/a%20b%2Fc/');
    });
});

describe('buildZidManageUrl', () => {
    beforeEach(() => {
        config.zid.appMarketUrl = '';
        config.zid.appId = '7367';
    });

    it('is the plans page of our app inside the merchant\'s dashboard', () => {
        expect(buildZidManageUrl('3195980')).toBe('https://dashboard.zid.sa/ar-sa/stores/3195980/apps/7367/plans');
        expect(buildZidManageUrl('3195980', 'en')).toBe('https://dashboard.zid.sa/en-sa/stores/3195980/apps/7367/plans');
    });

    // Absent must mean "suppress Stripe, show no link" — never a guessed link.
    it('is undefined without a merchant id (a store row that predates the capture)', () => {
        expect(buildZidManageUrl(undefined)).toBeUndefined();
        expect(buildZidManageUrl(null)).toBeUndefined();
        expect(buildZidManageUrl('   ')).toBeUndefined();
    });

    it('is undefined without an app id — nothing to point at', () => {
        config.zid.appId = '';
        expect(buildZidManageUrl('3195980')).toBeUndefined();
    });

    it('lets ZID_APP_MARKET_URL override the built link wholesale', () => {
        config.zid.appMarketUrl = 'https://apps.zid.sa/jawab24';
        expect(buildZidManageUrl('3195980')).toBe('https://apps.zid.sa/jawab24');
        expect(buildZidManageUrl(undefined)).toBe('https://apps.zid.sa/jawab24');
    });
});
