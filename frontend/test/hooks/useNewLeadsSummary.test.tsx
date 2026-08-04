/**
 * Tests: useNewLeadsSummary — the workspace-wide standing lead queue.
 *
 * The hook's whole job is to be TRUSTWORTHY: the badge and the dashboard
 * attention row exist because a merchant sat on 19 unworked leads while every
 * surface showed zero. A `count` that is `undefined` at runtime while typed as
 * `number` reintroduces exactly that failure (and renders an empty badge pill,
 * because `undefined <= 0` is false), so the shape is normalized at the
 * boundary and pinned here.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getNewSummaryMock = vi.fn();

vi.mock('@/lib/api', () => ({
    leadsApi: { getNewSummary: (...args: unknown[]) => getNewSummaryMock(...args) },
}));

vi.mock('@/lib/store', () => ({
    useAuthStore: (selector: (s: { isAuthenticated: boolean; _hasHydrated: boolean }) => unknown) =>
        selector({ isAuthenticated: true, _hasHydrated: true }),
}));

import { useNewLeadsSummary } from '@/hooks/useNewLeadsSummary';

function wrapper({ children }: { children: React.ReactNode }) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return React.createElement(QueryClientProvider, { client }, children);
}

describe('useNewLeadsSummary', () => {
    beforeEach(() => {
        getNewSummaryMock.mockReset();
    });

    it('passes through a well-formed summary', async () => {
        getNewSummaryMock.mockResolvedValue({
            data: { count: 19, latestName: 'عبدالخالق عامر', latestAt: '2026-08-04T13:22:00Z' },
        });

        const { result } = renderHook(() => useNewLeadsSummary(), { wrapper });

        await waitFor(() => expect(result.current.count).toBe(19));
        expect(result.current.latestName).toBe('عبدالخالق عامر');
        expect(result.current.latestAt).toBe('2026-08-04T13:22:00Z');
    });

    it('starts at zero before the request resolves', () => {
        getNewSummaryMock.mockReturnValue(new Promise(() => { /* never resolves */ }));

        const { result } = renderHook(() => useNewLeadsSummary(), { wrapper });

        expect(result.current).toEqual({ count: 0, latestName: null, latestAt: null });
    });

    // A 200 carrying the WRONG body — an older/newer backend, a proxy, a test
    // mock that matched `/leads` before `/leads/count`. TypeScript believes
    // `count` is a number here; at runtime it is not. Without normalization the
    // sidebar renders an empty pill instead of nothing.
    it('coerces a wrong-shaped 200 body to an empty summary', async () => {
        getNewSummaryMock.mockResolvedValue({ data: { data: [], meta: { total: 0 } } });

        const { result } = renderHook(() => useNewLeadsSummary(), { wrapper });

        await waitFor(() => expect(getNewSummaryMock).toHaveBeenCalled());
        await waitFor(() => expect(result.current.count).toBe(0));
        expect(result.current.count).not.toBeUndefined();
        expect(result.current.latestName).toBeNull();
        expect(result.current.latestAt).toBeNull();
    });

    it('coerces a null / non-object body to an empty summary', async () => {
        getNewSummaryMock.mockResolvedValue({ data: null });

        const { result } = renderHook(() => useNewLeadsSummary(), { wrapper });

        await waitFor(() => expect(getNewSummaryMock).toHaveBeenCalled());
        expect(result.current).toEqual({ count: 0, latestName: null, latestAt: null });
    });

    it('rejects a non-numeric count and a non-string latestName', async () => {
        getNewSummaryMock.mockResolvedValue({
            data: { count: '19', latestName: { first: 'Feras' }, latestAt: 12345 },
        });

        const { result } = renderHook(() => useNewLeadsSummary(), { wrapper });

        await waitFor(() => expect(getNewSummaryMock).toHaveBeenCalled());
        expect(result.current).toEqual({ count: 0, latestName: null, latestAt: null });
    });

    it('clamps a negative or fractional count', async () => {
        getNewSummaryMock.mockResolvedValue({ data: { count: -3, latestName: null, latestAt: null } });

        const { result } = renderHook(() => useNewLeadsSummary(), { wrapper });

        await waitFor(() => expect(getNewSummaryMock).toHaveBeenCalled());
        expect(result.current.count).toBe(0);
    });

    it('returns an empty summary when the request fails (never a stale or NaN badge)', async () => {
        getNewSummaryMock.mockRejectedValue(new Error('network down'));

        const { result } = renderHook(() => useNewLeadsSummary(), { wrapper });

        await waitFor(() => expect(getNewSummaryMock).toHaveBeenCalled());
        expect(result.current).toEqual({ count: 0, latestName: null, latestAt: null });
    });
});
