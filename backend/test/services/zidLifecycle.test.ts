import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocked deps: this suite pins the lifecycle RULES; the wiring from the
// webhook handler is pinned in test/controllers/zid.test.ts.
const mockResolveZidCredentials = vi.fn();
const mockProbeZidToken = vi.fn();
const mockDeleteEmbeddedToken = vi.fn();
vi.mock('../../src/services/zid', () => ({
    resolveZidCredentials: (...args: unknown[]) => mockResolveZidCredentials(...args),
    probeZidToken: (...args: unknown[]) => mockProbeZidToken(...args),
    deleteEmbeddedToken: (...args: unknown[]) => mockDeleteEmbeddedToken(...args),
}));

const mockApplySyncedStoreInfo = vi.fn().mockResolvedValue(undefined);
const mockDeactivateStore = vi.fn().mockResolvedValue(undefined);
const mockSetEmbeddedTokenHash = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services/ecommerce', () => ({
    applySyncedStoreInfo: (...args: unknown[]) => mockApplySyncedStoreInfo(...args),
    deactivateStore: (...args: unknown[]) => mockDeactivateStore(...args),
    setEmbeddedTokenHash: (...args: unknown[]) => mockSetEmbeddedTokenHash(...args),
}));

const mockCancelZidSubscriptionLocal = vi.fn().mockResolvedValue(true);
vi.mock('../../src/services/zidBilling', () => ({
    cancelZidSubscriptionLocal: (...args: unknown[]) => mockCancelZidSubscriptionLocal(...args),
}));

const mockCaptureError = vi.fn();
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

// The sweep's one query: active zid stores. Rows are staged per test.
let storeRows: Array<{ id: string; storeDomain: string; platformData: unknown }> = [];
vi.mock('../../src/db', () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => Promise.resolve(storeRows),
            }),
        }),
    },
}));

vi.mock('../../src/services/demoStore', () => ({
    isDemoStore: (store: { platformData?: unknown }) =>
        Boolean((store.platformData as { demo?: boolean } | null | undefined)?.demo),
}));

import {
    verifyZidUninstall,
    finalizeZidUninstall,
    revokeEmbeddedToken,
    sweepZidUninstallSignals,
    readZidUninstallSignal,
    ZID_UNINSTALL_SIGNAL_TTL_MS,
} from '../../src/services/zidLifecycle';

const CREDS = { managerToken: 'm', authorizationToken: 'a', storeId: '3195980' };
const log = { info: vi.fn(), warn: vi.fn() };

describe('zidLifecycle (D-114)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockResolveZidCredentials.mockResolvedValue(CREDS);
        mockProbeZidToken.mockResolvedValue('revoked');
        storeRows = [];
    });

    describe('verifyZidUninstall — the delivery is the claim, Zid\'s dead token is the proof', () => {
        it('is confirmed when Zid rejects our token', async () => {
            expect(await verifyZidUninstall('store-1', log)).toBe('confirmed');
            expect(mockProbeZidToken).toHaveBeenCalledWith(CREDS);
        });

        it('is token_still_valid when Zid still honours the token', async () => {
            mockProbeZidToken.mockResolvedValue('valid');
            expect(await verifyZidUninstall('store-1', log)).toBe('token_still_valid');
        });

        it('is unverifiable when Zid cannot be reached', async () => {
            mockProbeZidToken.mockResolvedValue('unreachable');
            expect(await verifyZidUninstall('store-1', log)).toBe('unverifiable');
        });

        it('is unverifiable, without probing, when the store has no active credential', async () => {
            mockResolveZidCredentials.mockResolvedValue(null);
            expect(await verifyZidUninstall('store-1', log)).toBe('unverifiable');
            expect(mockProbeZidToken).not.toHaveBeenCalled();
        });

        it('is unverifiable, not an error, for a pre-dual-token row whose credential cannot be loaded', async () => {
            mockResolveZidCredentials.mockRejectedValue(new Error('Zid store store-1 has no Authorization token'));
            expect(await verifyZidUninstall('store-1', log)).toBe('unverifiable');
            expect(log.warn).toHaveBeenCalledWith(
                expect.objectContaining({ storeId: 'store-1' }),
                expect.stringContaining('cannot be verified'),
            );
        });
    });

    describe('finalizeZidUninstall', () => {
        it('revokes at Zid, clears the hash, cancels the mirror, then deactivates — in that order', async () => {
            const order: string[] = [];
            mockDeleteEmbeddedToken.mockImplementationOnce(async () => { order.push('delete-at-zid'); });
            mockSetEmbeddedTokenHash.mockImplementationOnce(async () => { order.push('clear-hash'); });
            mockCancelZidSubscriptionLocal.mockImplementationOnce(async () => { order.push('cancel-billing'); return true; });
            mockDeactivateStore.mockImplementationOnce(async () => { order.push('deactivate'); });

            await finalizeZidUninstall({ id: 'store-1', storeDomain: 'shop.zid.store' }, log);

            expect(order).toEqual(['delete-at-zid', 'clear-hash', 'cancel-billing', 'deactivate']);
            expect(mockCancelZidSubscriptionLocal).toHaveBeenCalledWith('store-1', 'zid_app_uninstalled', log);
            expect(mockDeactivateStore).toHaveBeenCalledWith('zid', 'shop.zid.store');
        });
    });

    describe('revokeEmbeddedToken', () => {
        it('on uninstall, a rejected DELETE at Zid is expected: no Sentry event, local hash still cleared', async () => {
            mockDeleteEmbeddedToken.mockRejectedValueOnce(new Error('401'));
            await revokeEmbeddedToken('store-1', log, 'uninstall');
            expect(mockCaptureError).not.toHaveBeenCalled();
            expect(mockSetEmbeddedTokenHash).toHaveBeenCalledWith('store-1', null);
        });

        it('on merchant disconnect, a rejected DELETE means a usable credential survives at Zid — reported', async () => {
            mockDeleteEmbeddedToken.mockRejectedValueOnce(new Error('500'));
            await revokeEmbeddedToken('store-1', log, 'disconnect');
            expect(mockCaptureError).toHaveBeenCalledWith(
                expect.any(Error),
                'Zid embedded-token revocation failed on merchant disconnect',
                expect.objectContaining({ extra: { storeId: 'store-1' } }),
            );
            expect(mockSetEmbeddedTokenHash).toHaveBeenCalledWith('store-1', null);
        });

        it('reports a hash that could not be cleared — a surviving hash keeps the dashboard entry open', async () => {
            mockSetEmbeddedTokenHash.mockRejectedValueOnce(new Error('db down'));
            await revokeEmbeddedToken('store-1', log);
            expect(mockCaptureError).toHaveBeenCalledWith(
                expect.any(Error),
                'Failed to clear Zid embedded token hash',
                expect.anything(),
            );
        });
    });

    describe('readZidUninstallSignal', () => {
        it('reads an ISO marker back, and treats anything else as no signal', () => {
            expect(readZidUninstallSignal({ uninstallSignalAt: '2026-08-30T02:54:24.000Z' })?.toISOString())
                .toBe('2026-08-30T02:54:24.000Z');
            expect(readZidUninstallSignal({ uninstallSignalAt: null })).toBeNull();
            expect(readZidUninstallSignal({ uninstallSignalAt: 'not a date' })).toBeNull();
            expect(readZidUninstallSignal({})).toBeNull();
            expect(readZidUninstallSignal(null)).toBeNull();
            expect(readZidUninstallSignal('{"uninstallSignalAt":"x"}')).toBeNull();
        });
    });

    describe('sweepZidUninstallSignals — finishes what an early delivery could not', () => {
        const NOW = new Date('2026-08-30T12:00:00.000Z');
        const fresh = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();
        const stale = new Date(NOW.getTime() - ZID_UNINSTALL_SIGNAL_TTL_MS - 1).toISOString();

        it('probes ONLY stores carrying a marker, skipping demo rows', async () => {
            storeRows = [
                { id: 'no-marker', storeDomain: 'a.zid.store', platformData: { merchantId: '1' } },
                { id: 'demo', storeDomain: 'demo.zid.store', platformData: { demo: true, uninstallSignalAt: fresh } },
                { id: 'marked', storeDomain: 'b.zid.store', platformData: { uninstallSignalAt: fresh } },
            ];

            const result = await sweepZidUninstallSignals({ log, now: NOW });

            expect(result).toEqual({ scanned: 1, finalized: 1, cleared: 0, errors: 0 });
            expect(mockProbeZidToken).toHaveBeenCalledTimes(1);
            expect(mockDeactivateStore).toHaveBeenCalledWith('zid', 'b.zid.store');
        });

        it('finalizes a marked store once Zid reports the token dead', async () => {
            storeRows = [{ id: 'marked', storeDomain: 'b.zid.store', platformData: { uninstallSignalAt: fresh } }];

            const result = await sweepZidUninstallSignals({ log, now: NOW });

            expect(result.finalized).toBe(1);
            expect(mockCancelZidSubscriptionLocal).toHaveBeenCalledWith('marked', 'zid_app_uninstalled', log);
            expect(mockDeactivateStore).toHaveBeenCalledWith('zid', 'b.zid.store');
            expect(log.info).toHaveBeenCalledWith(
                expect.objectContaining({ storeId: 'marked' }),
                expect.stringContaining('confirmed'),
            );
        });

        it('keeps a FRESH marker while Zid still honours the token — the next tick asks again', async () => {
            mockProbeZidToken.mockResolvedValue('valid');
            storeRows = [{ id: 'marked', storeDomain: 'b.zid.store', platformData: { uninstallSignalAt: fresh } }];

            const result = await sweepZidUninstallSignals({ log, now: NOW });

            expect(result).toEqual({ scanned: 1, finalized: 0, cleared: 0, errors: 0 });
            expect(mockDeactivateStore).not.toHaveBeenCalled();
            expect(mockApplySyncedStoreInfo).not.toHaveBeenCalled();
        });

        it('clears a STALE marker whose token Zid still honours — a spoof, or an uninstall Zid never followed through on', async () => {
            mockProbeZidToken.mockResolvedValue('valid');
            storeRows = [{ id: 'marked', storeDomain: 'b.zid.store', platformData: { uninstallSignalAt: stale } }];

            const result = await sweepZidUninstallSignals({ log, now: NOW });

            expect(result).toEqual({ scanned: 1, finalized: 0, cleared: 1, errors: 0 });
            expect(mockApplySyncedStoreInfo).toHaveBeenCalledWith('marked', {}, { uninstallSignalAt: null });
            expect(mockDeactivateStore).not.toHaveBeenCalled();
        });

        it('keeps a marker of any age while Zid is unreachable — never clears on a network verdict', async () => {
            mockProbeZidToken.mockResolvedValue('unreachable');
            storeRows = [{ id: 'marked', storeDomain: 'b.zid.store', platformData: { uninstallSignalAt: stale } }];

            const result = await sweepZidUninstallSignals({ log, now: NOW });

            expect(result).toEqual({ scanned: 1, finalized: 0, cleared: 0, errors: 0 });
            expect(mockApplySyncedStoreInfo).not.toHaveBeenCalled();
        });

        it('isolates a failing store so one bad row cannot stall the sweep', async () => {
            storeRows = [
                { id: 'bad', storeDomain: 'bad.zid.store', platformData: { uninstallSignalAt: fresh } },
                { id: 'good', storeDomain: 'good.zid.store', platformData: { uninstallSignalAt: fresh } },
            ];
            mockDeactivateStore
                .mockRejectedValueOnce(new Error('db down'))
                .mockResolvedValueOnce(undefined);

            const result = await sweepZidUninstallSignals({ log, now: NOW });

            expect(result).toEqual({ scanned: 2, finalized: 1, cleared: 0, errors: 1 });
            expect(log.warn).toHaveBeenCalledWith(
                expect.objectContaining({ storeId: 'bad' }),
                'Zid uninstall sweep failed for one store',
            );
        });
    });
});
