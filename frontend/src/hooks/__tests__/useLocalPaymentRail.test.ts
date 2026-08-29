/**
 * `useLocalPaymentRail` answers "does THIS visitor have a local payment rail?"
 * for the pricing grids and checkout — from the geo cache alone. It must issue
 * no request of its own (every caller already ran a geo check that cached the
 * country), and it must stay false until the caller says that check resolved.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GEO_CACHE_KEY } from '@/utils/geoCheck';
import { useLocalPaymentRail } from '../useLocalPaymentRail';

function cacheCountry(country: string | undefined) {
    localStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ sanctioned: true, country, timestamp: Date.now() }));
}

const fetchSpy = vi.fn();

beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
    vi.unstubAllGlobals();
    fetchSpy.mockReset();
});

describe('useLocalPaymentRail', () => {
    it('is false until the caller reports the geo check resolved, even with SY cached', () => {
        cacheCountry('SY');
        const { result, rerender } = renderHook(({ resolved }) => useLocalPaymentRail(resolved), {
            initialProps: { resolved: false },
        });

        expect(result.current).toBe(false);

        rerender({ resolved: true });
        expect(result.current).toBe(true);
    });

    it('is true for a visitor resolved to Syria', () => {
        cacheCountry('SY');
        const { result } = renderHook(() => useLocalPaymentRail(true));
        expect(result.current).toBe(true);
    });

    it('is false for any other blocked region and for an unknown country', () => {
        cacheCountry('IR');
        expect(renderHook(() => useLocalPaymentRail(true)).result.current).toBe(false);

        cacheCountry(undefined);
        expect(renderHook(() => useLocalPaymentRail(true)).result.current).toBe(false);

        localStorage.clear();
        expect(renderHook(() => useLocalPaymentRail(true)).result.current).toBe(false);
    });

    it('never issues a request of its own', () => {
        cacheCountry('SY');
        renderHook(() => useLocalPaymentRail(true));
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
