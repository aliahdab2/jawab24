import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('@/lib/api', () => ({
    ecommerceApi: { getStore: vi.fn() },
    sallaApi: { getStore: vi.fn() },
    zidApi: { getStore: vi.fn() },
}));

import { useConnectedStore } from '@/hooks/useConnectedStore';
import { ecommerceApi, sallaApi, zidApi } from '@/lib/api';

const shopifyMock = vi.mocked(ecommerceApi.getStore);
const sallaMock = vi.mocked(sallaApi.getStore);
const zidMock = vi.mocked(zidApi.getStore);

const ACTIVE_STORE = { id: 'store-1', isActive: true, platform: 'salla' };
const INACTIVE_STORE = { id: 'store-2', isActive: false, platform: 'shopify' };

describe('useConnectedStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns null when not enabled (no requests fire)', () => {
        const { result } = renderHook(() => useConnectedStore(false));
        expect(result.current).toEqual({ store: null, loading: false });
        expect(shopifyMock).not.toHaveBeenCalled();
        expect(sallaMock).not.toHaveBeenCalled();
        expect(zidMock).not.toHaveBeenCalled();
    });

    it('returns the first active store across all platforms', async () => {
        shopifyMock.mockResolvedValue({ data: null });
        sallaMock.mockResolvedValue({ data: ACTIVE_STORE });
        zidMock.mockResolvedValue({ data: null });

        const { result } = renderHook(() => useConnectedStore(true));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.store).toEqual(ACTIVE_STORE);
    });

    it('skips inactive stores even if a platform returns one', async () => {
        shopifyMock.mockResolvedValue({ data: INACTIVE_STORE });
        sallaMock.mockResolvedValue({ data: null });
        zidMock.mockResolvedValue({ data: null });

        const { result } = renderHook(() => useConnectedStore(true));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.store).toBeNull();
    });

    it('handles platform endpoints that throw without crashing the hook', async () => {
        shopifyMock.mockRejectedValue(new Error('shopify 500'));
        sallaMock.mockResolvedValue({ data: ACTIVE_STORE });
        zidMock.mockRejectedValue(new Error('zid 401'));

        const { result } = renderHook(() => useConnectedStore(true));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.store).toEqual(ACTIVE_STORE);
    });

    it('accepts both wrapped {data} and bare-store shapes', async () => {
        // Different platform clients return slightly different shapes today;
        // this test pins the contract so future refactors don't break either.
        shopifyMock.mockResolvedValue(ACTIVE_STORE);
        sallaMock.mockResolvedValue({ data: null });
        zidMock.mockResolvedValue({ data: null });

        const { result } = renderHook(() => useConnectedStore(true));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.store).toEqual(ACTIVE_STORE);
    });

    it('returns null when no platform returns an active store', async () => {
        shopifyMock.mockResolvedValue({ data: null });
        sallaMock.mockResolvedValue({ data: null });
        zidMock.mockResolvedValue({ data: null });

        const { result } = renderHook(() => useConnectedStore(true));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.store).toBeNull();
    });

    it('cancels in-flight responses on unmount (no state-update warning)', async () => {
        let resolveSalla!: (v: unknown) => void;
        shopifyMock.mockResolvedValue({ data: null });
        sallaMock.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveSalla = resolve;
                }),
        );
        zidMock.mockResolvedValue({ data: null });

        const { unmount } = renderHook(() => useConnectedStore(true));
        unmount();
        // Resolve after unmount — the hook's `cancelled` flag must prevent setState
        await act(async () => {
            resolveSalla({ data: ACTIVE_STORE });
        });
        // No assertion needed beyond "no crash / no act() warning"
    });
});
