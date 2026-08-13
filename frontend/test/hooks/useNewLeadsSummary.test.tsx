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

let mockWorkspaceId: string | null = 'ws-1';

vi.mock('@/lib/store', () => ({
    useAuthStore: (
        selector: (s: { isAuthenticated: boolean; _hasHydrated: boolean; activeWorkspaceId: string | null }) => unknown,
    ) => selector({ isAuthenticated: true, _hasHydrated: true, activeWorkspaceId: mockWorkspaceId }),
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
        mockWorkspaceId = 'ws-1';
    });

    // Switching workspace does not clear the query cache, so an unscoped key
    // served the PREVIOUS workspace's count — and its customer's name — until
    // the 60s staleTime elapsed. The key must carry the workspace.
    it('caches per workspace: switching workspaces does not reuse the old count', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
        const scoped = ({ children }: { children: React.ReactNode }) =>
            React.createElement(QueryClientProvider, { client }, children);

        getNewSummaryMock.mockResolvedValue({
            data: { count: 19, latestName: 'Feras', latestAt: null, oldestAt: null },
        });
        const first = renderHook(() => useNewLeadsSummary(), { wrapper: scoped });
        await waitFor(() => expect(first.result.current.count).toBe(19));

        // Same client, different workspace, endpoint now answers for ws-2.
        mockWorkspaceId = 'ws-2';
        getNewSummaryMock.mockResolvedValue({
            data: { count: 0, latestName: null, latestAt: null, oldestAt: null },
        });
        const second = renderHook(() => useNewLeadsSummary(), { wrapper: scoped });

        await waitFor(() => expect(second.result.current.count).toBe(0));
        expect(second.result.current.latestName).toBeNull();
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

        expect(result.current).toEqual({ count: 0, latestName: null, latestAt: null, oldestAt: null, byPage: [] });
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
        expect(result.current).toEqual({ count: 0, latestName: null, latestAt: null, oldestAt: null, byPage: [] });
    });

    it('rejects a non-numeric count and a non-string latestName', async () => {
        getNewSummaryMock.mockResolvedValue({
            data: { count: '19', latestName: { first: 'Feras' }, latestAt: 12345 },
        });

        const { result } = renderHook(() => useNewLeadsSummary(), { wrapper });

        await waitFor(() => expect(getNewSummaryMock).toHaveBeenCalled());
        expect(result.current).toEqual({ count: 0, latestName: null, latestAt: null, oldestAt: null, byPage: [] });
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
        expect(result.current).toEqual({ count: 0, latestName: null, latestAt: null, oldestAt: null, byPage: [] });
    });

    // `byPage` decides which page the badge's deep link opens. A malformed entry
    // that survived normalization would send the merchant to a page id that does
    // not exist — a 404 list under a non-zero badge.
    describe('byPage', () => {
        it('keeps the server order — longest-waiting page first', async () => {
            getNewSummaryMock.mockResolvedValue({
                data: {
                    count: 9, latestName: null, latestAt: null, oldestAt: null,
                    byPage: [
                        { pageId: 'page_b', count: 4, oldestAt: '2026-08-02T09:00:00.000Z' },
                        { pageId: 'page_a', count: 5, oldestAt: '2026-08-11T09:00:00.000Z' },
                    ],
                },
            });

            const { result } = renderHook(() => useNewLeadsSummary(), { wrapper });

            await waitFor(() => expect(result.current.byPage).toHaveLength(2));
            expect(result.current.byPage.map((p) => p.pageId)).toEqual(['page_b', 'page_a']);
        });

        it('drops entries that could not name a page to land on', async () => {
            getNewSummaryMock.mockResolvedValue({
                data: {
                    count: 3, latestName: null, latestAt: null, oldestAt: null,
                    byPage: [
                        { pageId: '', count: 2, oldestAt: null },
                        { pageId: 'page_a', count: '4', oldestAt: null },
                        { pageId: 'page_b', count: 0, oldestAt: null },
                        null,
                        { pageId: 'page_c', count: 3, oldestAt: null },
                    ],
                },
            });

            const { result } = renderHook(() => useNewLeadsSummary(), { wrapper });

            await waitFor(() => expect(getNewSummaryMock).toHaveBeenCalled());
            // A page with nothing waiting is as useless a landing target as a
            // nameless one, so both go.
            await waitFor(() => expect(result.current.byPage).toEqual([
                { pageId: 'page_c', count: 3, oldestAt: null },
            ]));
        });

        it('treats a backend that sends no breakdown as "no idea where the queue is"', async () => {
            getNewSummaryMock.mockResolvedValue({
                data: { count: 19, latestName: 'Feras', latestAt: null, oldestAt: null },
            });

            const { result } = renderHook(() => useNewLeadsSummary(), { wrapper });

            // The count still shows; the page selection is simply left alone.
            await waitFor(() => expect(result.current.count).toBe(19));
            expect(result.current.byPage).toEqual([]);
        });
    });
});
