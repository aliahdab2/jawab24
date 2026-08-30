import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the store predicate so no DB is touched; assert the exact call it makes.
const mockHasActiveStore = vi.fn();
vi.mock('../../src/services/ecommerce', () => ({
    hasActiveStoreForBillingSubject: (...args: unknown[]) => mockHasActiveStore(...args),
}));

// Keep the real config (other modules read redis/db at import) but pin the one
// flag this suite flips.
vi.mock('../../src/config', async () => {
    const actual = await vi.importActual<typeof import('../../src/config')>('../../src/config');
    return { config: { ...actual.config, whatsappZidBlock: true } };
});

import { getWhatsAppUnavailableReason, WHATSAPP_MARKETPLACE_BLOCKED_RESPONSE } from '../../src/services/whatsappAvailability';
import { config } from '../../src/config';

describe('getWhatsAppUnavailableReason', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (config as { whatsappZidBlock: boolean }).whatsappZidBlock = true;
    });

    it('returns zid_marketplace when the billing subject has an active Zid store', async () => {
        mockHasActiveStore.mockResolvedValue(true);
        expect(await getWhatsAppUnavailableReason('owner-1')).toBe('zid_marketplace');
        // Keyed on the billing SUBJECT and the 'zid' platform — the same subject
        // rule hasWhatsAppPlanAccess uses (mutation: swap the platform/arg → fails).
        expect(mockHasActiveStore).toHaveBeenCalledWith('zid', 'owner-1');
    });

    it('returns null when the account has no active Zid store', async () => {
        mockHasActiveStore.mockResolvedValue(false);
        expect(await getWhatsAppUnavailableReason('owner-1')).toBeNull();
    });

    it('returns null and does not even query when WHATSAPP_ZID_BLOCK is off', async () => {
        // Mutation: delete the `if (!config.whatsappZidBlock) return null` guard and
        // this fails — the store is queried and the reason comes back.
        (config as { whatsappZidBlock: boolean }).whatsappZidBlock = false;
        mockHasActiveStore.mockResolvedValue(true);
        expect(await getWhatsAppUnavailableReason('owner-1')).toBeNull();
        expect(mockHasActiveStore).not.toHaveBeenCalled();
    });

    it('the 403 body carries the stable code and marketplace the frontend maps on', () => {
        expect(WHATSAPP_MARKETPLACE_BLOCKED_RESPONSE.code).toBe('WHATSAPP_UNAVAILABLE_FOR_MARKETPLACE');
        expect(WHATSAPP_MARKETPLACE_BLOCKED_RESPONSE.marketplace).toBe('zid');
    });
});
