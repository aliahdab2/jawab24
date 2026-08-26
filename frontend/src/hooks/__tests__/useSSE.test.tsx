/**
 * Regression tests for useSSE's embedded-mode auth (found live 2026-08-26,
 * the Zid reviewer's session): the hook connected EventSource with cookie
 * credentials only, but SameSite=strict cookies never reach a third-party
 * iframe — so every embedded (Zid dashboard) session got 401 on /sse/events
 * in a permanent reconnect loop and no real-time updates at all.
 *
 * The fix: pass the embedded Bearer token via the backend's sanctioned
 * ?token= query param (EventSource cannot set headers), and re-mint the
 * short-lived (15 min) token from the durable platform credential before
 * each reconnect so an idle embedded tab recovers after token expiry.
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSSE } from '../useSSE';
import { getEmbeddedToken, isEmbeddedSession, refreshEmbeddedToken } from '@/lib/embeddedSession';

vi.mock('next/router', () => ({
    useRouter: () => ({ pathname: '/dashboard', push: vi.fn() }),
}));
vi.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));
vi.mock('sonner', () => ({ toast: vi.fn() }));
vi.mock('@/lib/capacitor', () => ({ isNativePlatform: () => false }));
vi.mock('../useLeadAlertsEnabled', () => ({ useLeadAlertsEnabled: () => true }));
vi.mock('@/lib/embeddedSession', () => ({
    getEmbeddedToken: vi.fn(),
    isEmbeddedSession: vi.fn(),
    refreshEmbeddedToken: vi.fn(),
}));

const mockAuthState = { isAuthenticated: true };
const mockUIState = {
    setSSEStatus: vi.fn(),
    incrementUnreadComments: vi.fn(),
    incrementUnreadMessages: vi.fn(),
};
vi.mock('@/lib/store', () => ({
    useAuthStore: (selector: (s: typeof mockAuthState) => unknown) => selector(mockAuthState),
    useUIStore: (selector: (s: typeof mockUIState) => unknown) => selector(mockUIState),
}));

/** Captures every EventSource construction so tests can assert URL + options. */
class MockEventSource {
    static instances: MockEventSource[] = [];
    url: string;
    withCredentials: boolean;
    onerror: (() => void) | null = null;
    constructor(url: string, init?: { withCredentials?: boolean }) {
        this.url = url;
        this.withCredentials = init?.withCredentials ?? false;
        MockEventSource.instances.push(this);
    }
    addEventListener(): void { /* handlers not exercised here */ }
    close(): void { /* no-op */ }
}

function makeWrapper() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return function Wrapper({ children }: { children: React.ReactNode }) {
        return React.createElement(QueryClientProvider, { client: queryClient }, children);
    };
}

describe('useSSE auth modes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        MockEventSource.instances = [];
        vi.stubGlobal('EventSource', MockEventSource);
        vi.mocked(getEmbeddedToken).mockReturnValue(null);
        vi.mocked(isEmbeddedSession).mockReturnValue(false);
        vi.mocked(refreshEmbeddedToken).mockResolvedValue(null);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('cookie mode: connects with credentials and no token in the URL', () => {
        renderHook(() => useSSE(), { wrapper: makeWrapper() });

        expect(MockEventSource.instances).toHaveLength(1);
        const es = MockEventSource.instances[0];
        expect(es.url).toMatch(/\/sse\/events$/);
        expect(es.url).not.toContain('token=');
        expect(es.withCredentials).toBe(true);
    });

    it('embedded mode: passes the Bearer token as ?token= (cookies cannot cross the iframe)', () => {
        vi.mocked(getEmbeddedToken).mockReturnValue('embedded-jwt');
        vi.mocked(isEmbeddedSession).mockReturnValue(true);

        renderHook(() => useSSE(), { wrapper: makeWrapper() });

        expect(MockEventSource.instances).toHaveLength(1);
        const es = MockEventSource.instances[0];
        expect(es.url).toContain('/sse/events?token=embedded-jwt');
        expect(es.withCredentials).toBe(false);
    });

    it('embedded mode: URL-encodes the token', () => {
        vi.mocked(getEmbeddedToken).mockReturnValue('a+b/c=');
        vi.mocked(isEmbeddedSession).mockReturnValue(true);

        renderHook(() => useSSE(), { wrapper: makeWrapper() });

        expect(MockEventSource.instances[0].url).toContain(`token=${encodeURIComponent('a+b/c=')}`);
    });

    it('embedded mode: re-mints the token before reconnecting, and the new connection uses it', async () => {
        vi.mocked(getEmbeddedToken).mockReturnValue('stale-jwt');
        vi.mocked(isEmbeddedSession).mockReturnValue(true);

        renderHook(() => useSSE(), { wrapper: makeWrapper() });
        expect(MockEventSource.instances).toHaveLength(1);

        // Simulate the refresh landing a new token in storage before reconnect.
        vi.mocked(refreshEmbeddedToken).mockImplementation(async () => {
            vi.mocked(getEmbeddedToken).mockReturnValue('fresh-jwt');
            return 'fresh-jwt';
        });

        act(() => { MockEventSource.instances[0].onerror?.(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });

        expect(refreshEmbeddedToken).toHaveBeenCalledTimes(1);
        expect(MockEventSource.instances).toHaveLength(2);
        expect(MockEventSource.instances[1].url).toContain('token=fresh-jwt');
    });

    it('cookie mode: reconnects without touching the embedded mint endpoint', async () => {
        renderHook(() => useSSE(), { wrapper: makeWrapper() });

        act(() => { MockEventSource.instances[0].onerror?.(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });

        expect(refreshEmbeddedToken).not.toHaveBeenCalled();
        expect(MockEventSource.instances).toHaveLength(2);
        expect(MockEventSource.instances[1].url).not.toContain('token=');
    });
});
