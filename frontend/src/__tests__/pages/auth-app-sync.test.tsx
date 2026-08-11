import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import AuthAppSync from '@/pages/auth/app-sync';

const mockCaptureError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sentryHelpers', () => ({ captureError: mockCaptureError }));

// Stable router object — a fresh one per render would re-fire the effect.
const { mockRouterReplace, routerState } = vi.hoisted(() => ({
    mockRouterReplace: vi.fn(),
    routerState: { query: {} as Record<string, string> },
}));
const stableRouter = vi.hoisted(() => ({
    isReady: true,
    get query() { return routerState.query; },
    replace: mockRouterReplace,
}));
vi.mock('next/router', () => ({ useRouter: () => stableRouter }));

/** The page navigates by assigning window.location.href (Rule 17b: a PAGE must
 *  start the navigation, so this is not router.push and cannot be spied there). */
function captureLocationAssignments(): string[] {
    const assigned: string[] = [];
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: {
            get href() { return ''; },
            set href(value: string) { assigned.push(value); },
        },
    });
    return assigned;
}

describe('AuthAppSync (Android App Link fallback)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        routerState.query = {};
    });

    it('forwards a token hand-off to the native app via the custom scheme', async () => {
        const assigned = captureLocationAssignments();
        routerState.query = { token: 'session-token', redirect: '/dashboard' };

        render(<AuthAppSync />);

        await waitFor(() => expect(assigned).toHaveLength(1));
        expect(assigned[0]).toContain('com.jawab24.app://auth/sync?token=session-token');
        expect(mockCaptureError).not.toHaveBeenCalled();
    });

    /**
     * Rule 17b: a token-less bridge URL is a RETURN, not a sign-in. The
     * WhatsApp connect leg comes home this way because the app never lost its
     * session; bouncing it to /login stranded a merchant after a SUCCESSFUL
     * connect (observed 2026-07-31).
     */
    it('forwards a token-less RETURN that carries a destination — never /login', async () => {
        const assigned = captureLocationAssignments();
        routerState.query = { redirect: '/pages?connectWhatsApp=true' };

        render(<AuthAppSync />);

        await waitFor(() => expect(assigned).toHaveLength(1));
        expect(assigned[0]).toContain('com.jawab24.app://auth/sync?redirect=');
        expect(mockRouterReplace).not.toHaveBeenCalled();
        expect(mockCaptureError).not.toHaveBeenCalled();
    });

    /**
     * THE alert-precision property. This URL is public and `noindex` stops
     * nobody, so crawlers and pasted links land here with an empty query. Those
     * reopened a resolved issue twice on 2026-08-11 (a HeadlessChrome scanner
     * and a desktop visit) — and an alert that cries wolf is how a genuinely
     * stranded merchant stops being noticed.
     */
    it('does NOT alert on a bare visit with no query at all — a crawler is not a defect', async () => {
        captureLocationAssignments();
        routerState.query = {};

        render(<AuthAppSync />);

        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/login'));
        expect(mockCaptureError).not.toHaveBeenCalled();
    });

    it('does NOT alert on unrelated tracking params either', async () => {
        captureLocationAssignments();
        routerState.query = { utm_source: 'newsletter', fbclid: 'abc123' };

        render(<AuthAppSync />);

        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/login'));
        expect(mockCaptureError).not.toHaveBeenCalled();
    });

    /**
     * The other half: an alert that never fires is worth nothing. A hand-off
     * that ARRIVED and could not be honoured is still a defect and must page us.
     */
    it('DOES alert when a hand-off arrived but carries no session token', async () => {
        captureLocationAssignments();
        routerState.query = { fbToken: 'fb-only', user: '{"id":"u1"}' };

        render(<AuthAppSync />);

        await waitFor(() => expect(mockCaptureError).toHaveBeenCalled());
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'app-sync fallback: no token' }),
            expect.any(String),
            expect.objectContaining({ extra: { params: ['fbToken', 'user'] } }),
        );
        expect(mockRouterReplace).toHaveBeenCalledWith('/login');
    });

    /** An off-site `redirect` is rejected by the startsWith('/') guard, so it
     *  reaches the fallback — a genuinely broken (or hostile) bridge. */
    it('DOES alert when the redirect is rejected as off-site, and never forwards it', async () => {
        const assigned = captureLocationAssignments();
        routerState.query = { redirect: 'https://evil.example.com' };

        render(<AuthAppSync />);

        await waitFor(() => expect(mockCaptureError).toHaveBeenCalled());
        expect(assigned).toHaveLength(0);
        expect(mockRouterReplace).toHaveBeenCalledWith('/login');
    });
});
