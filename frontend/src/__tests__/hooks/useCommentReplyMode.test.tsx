import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api', () => ({
    settingsApi: { get: vi.fn() },
}));

import { useCommentReplyMode } from '@/hooks/useCommentReplyMode';
import { settingsApi } from '@/lib/api';

const getMock = vi.mocked(settingsApi.get);

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useCommentReplyMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the configured mode once settings load', async () => {
        getMock.mockResolvedValue({ data: { commentReplyMode: 'dual' } });
        const { result } = renderHook(() => useCommentReplyMode(), { wrapper });
        expect(result.current).toBeNull(); // loading
        await waitFor(() => expect(result.current).toBe('dual'));
    });

    it('passes private through', async () => {
        getMock.mockResolvedValue({ data: { commentReplyMode: 'private' } });
        const { result } = renderHook(() => useCommentReplyMode(), { wrapper });
        await waitFor(() => expect(result.current).toBe('private'));
    });

    // GET /settings always returns a concrete mode; a payload without one is
    // not the settings response (auth error body, wrong shape). Returning a
    // guessed mode here would show a wrong delivery claim — stay null instead.
    it('returns null for a payload without a mode (not the settings response)', async () => {
        getMock.mockResolvedValue({ data: {} });
        const { result } = renderHook(() => useCommentReplyMode(), { wrapper });
        await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(result.current).toBeNull());
    });

    it('returns null for an unknown mode value', async () => {
        getMock.mockResolvedValue({ data: { commentReplyMode: 'something-new' } });
        const { result } = renderHook(() => useCommentReplyMode(), { wrapper });
        await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(result.current).toBeNull());
    });

    it('passes public through', async () => {
        getMock.mockResolvedValue({ data: { commentReplyMode: 'public' } });
        const { result } = renderHook(() => useCommentReplyMode(), { wrapper });
        await waitFor(() => expect(result.current).toBe('public'));
    });

    it('stays null when the settings fetch fails (callers hide the note)', async () => {
        getMock.mockRejectedValue(new Error('network down'));
        const { result } = renderHook(() => useCommentReplyMode(), { wrapper });
        await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
        // Let the rejection settle — the hook must keep returning null, not throw.
        await waitFor(() => expect(result.current).toBeNull());
    });
});
