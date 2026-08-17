import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api', () => ({
    settingsApi: { get: vi.fn() },
}));

import { useSettingsQuery } from '@/hooks/useSettingsQuery';
import { useLeadAlertsEnabled } from '@/hooks/useLeadAlertsEnabled';
import { useMerchantTimezone } from '@/hooks/useMerchantTimezone';
import { useHandoffPauseDuration } from '@/hooks/useHandoffPauseDuration';
import { useCommentReplyMode } from '@/hooks/useCommentReplyMode';
import { settingsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

const getMock = vi.mocked(settingsApi.get);

/** One client per render, shared across the hooks inside a single render. */
function makeWrapper() {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    };
}

/**
 * `GET /settings` is fetched ONCE for the whole app.
 *
 * Six call sites used to fetch the identical response under five different query
 * keys, so react-query could not dedupe them: a measured dashboard load issued
 * `/api/settings` **twice**, and other screens more. On a slow connection each of
 * those was a full round trip (~2 s at 3G latency) for bytes already in flight.
 */
describe('useSettingsQuery — one shared /settings fetch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuthStore.setState({ isAuthenticated: true });
    });

    it('serves every settings consumer from a SINGLE request', async () => {
        getMock.mockResolvedValue({
            data: {
                newLeadAlertsEnabled: false,
                timezone: 'Asia/Damascus',
                handoffPauseDurationMinutes: 45,
                commentReplyMode: 'dual',
            },
        });
        const wrapper = makeWrapper();

        // All four independent hooks, rendered together as a real screen would.
        const { result } = renderHook(() => ({
            alerts: useLeadAlertsEnabled(),
            tz: useMerchantTimezone(),
            pause: useHandoffPauseDuration(),
            mode: useCommentReplyMode(),
        }), { wrapper });

        await waitFor(() => expect(result.current.tz).toBe('Asia/Damascus'));
        expect(result.current.alerts).toBe(false);
        expect(result.current.pause).toBe(45);
        expect(result.current.mode).toBe('dual');

        // The point of the change: four consumers, one round trip.
        expect(getMock).toHaveBeenCalledTimes(1);
    });

    it('does not fetch while unauthenticated — /settings 401s without a session', async () => {
        useAuthStore.setState({ isAuthenticated: false });
        getMock.mockResolvedValue({ data: {} });

        renderHook(() => useSettingsQuery(), { wrapper: makeWrapper() });

        await new Promise((r) => setTimeout(r, 20));
        expect(getMock).not.toHaveBeenCalled();
    });

    it('falls back to safe defaults while the request is in flight', async () => {
        let resolve: ((v: unknown) => void) | undefined;
        getMock.mockReturnValue(new Promise((r) => { resolve = r; }) as never);
        const wrapper = makeWrapper();

        const { result } = renderHook(() => ({
            alerts: useLeadAlertsEnabled(),
            tz: useMerchantTimezone(),
            mode: useCommentReplyMode(),
        }), { wrapper });

        // Alerts default ON (matches the DB column default and the backend's `?? true`),
        // timezone stays undefined so callers hide the hint rather than show a wrong
        // clock, and the reply mode stays null so no wrong delivery claim is rendered.
        expect(result.current.alerts).toBe(true);
        expect(result.current.tz).toBeUndefined();
        expect(result.current.mode).toBeNull();

        resolve?.({ data: {} });
    });
});
