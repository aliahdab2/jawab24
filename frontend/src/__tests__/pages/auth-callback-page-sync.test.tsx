/**
 * The Facebook RECONNECT leg must explain pages the backend refused.
 *
 * A sync can succeed (200) and still refuse pages — plan page limit, trial
 * already used, held by another workspace. Those reasons ride in the response
 * body. This page used to `await fetch('/pages/sync')` and throw the body away,
 * so the merchant landed on /pages with fewer pages than they granted and no
 * explanation at all. Observed 2026-09-04 on a Starter workspace at
 * `max_pages = 1`: Facebook returned 2 pages, the backend refused the second
 * with `skipReason: 'page_limit'`, and nothing was ever shown.
 *
 * These tests pin the REPORTING, not the fetch — a sync that happens silently is
 * the defect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import AuthCallback from '@/pages/auth/callback';

const mockToastWarning = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { warning: mockToastWarning, error: vi.fn(), success: vi.fn() } }));

vi.mock('@/lib/sentryHelpers', () => ({
    captureError: vi.fn(),
    getBackendErrorCode: () => undefined,
}));

// Translations: return the key plus the interpolated values, so an assertion can
// prove the RIGHT message fired with the RIGHT page names — not merely that some
// toast appeared.
vi.mock('next-intl', () => ({
    useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) =>
        `${ns}.${key}${values ? `:${JSON.stringify(values)}` : ''}`,
}));

const { mockRouterReplace, routerState } = vi.hoisted(() => ({
    mockRouterReplace: vi.fn(),
    routerState: { query: {} as Record<string, string> },
}));
const stableRouter = vi.hoisted(() => ({
    isReady: true,
    get query() { return routerState.query; },
    replace: mockRouterReplace,
    push: vi.fn(),
}));
vi.mock('next/router', () => ({ useRouter: () => stableRouter }));

const { authState } = vi.hoisted(() => ({
    authState: { isAuthenticated: false, token: null as string | null },
}));
vi.mock('@/lib/store', () => ({
    useAuthStore: Object.assign(
        () => ({ setAuth: vi.fn(), setWorkspaces: vi.fn() }),
        { getState: () => authState },
    ),
    useUIStore: { getState: () => ({ setLanguage: vi.fn() }) },
}));

vi.mock('@/components/ui', () => ({ AppSkeleton: () => <div data-testid="skeleton" /> }));

/** A successful /auth/facebook exchange, then the /pages/sync answer under test. */
function mockAuthThenSync(syncBody: unknown, syncOk = true) {
    const fetchMock = vi.fn((url: string) => {
        if (url.includes('/pages/sync')) {
            return Promise.resolve({
                ok: syncOk,
                json: () => Promise.resolve(syncBody),
            } as Response);
        }
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                token: 'session-token',
                fbAccessToken: 'fb-token',
                user: { id: 'u1', email: 'merchant@example.com' },
                settings: {},
            }),
        } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('AuthCallback — reconnect leg reports refused pages', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authState.isAuthenticated = false;
        // "returnUrl|platform|locale|reconnect" — the reconnect shape the Facebook
        // dialog carries (observed live: state=/pages|web|en|reconnect).
        routerState.query = { code: 'oauth-code', state: '/pages|web|en|reconnect' };
    });

    it('names the pages refused by the plan page limit', async () => {
        mockAuthThenSync({
            synced: 1,
            skippedCount: 1,
            skippedPages: [{ pageName: 'Jawab24 Test Salla' }],
            skipReason: 'page_limit',
            pageLimit: 1,
        });

        render(<AuthCallback />);

        await waitFor(() => expect(mockToastWarning).toHaveBeenCalledTimes(1));
        const [message, options] = mockToastWarning.mock.calls[0];
        expect(message).toContain('pages.pageLimitSkippedWarning');
        expect(message).toContain('Jawab24 Test Salla');
        expect(message).toContain('"limit":1');
        // The merchant must act on this (upgrade) — it must not expire unread.
        expect(options).toMatchObject({ duration: Infinity });
    });

    it('tells a returning identity to subscribe rather than to upgrade', async () => {
        mockAuthThenSync({
            synced: 0,
            skippedCount: 2,
            skippedPages: [{ pageName: 'Page A' }, { pageName: 'Page B' }],
            skipReason: 'subscription_inactive',
        });

        render(<AuthCallback />);

        await waitFor(() => expect(mockToastWarning).toHaveBeenCalledTimes(1));
        const [message] = mockToastWarning.mock.calls[0];
        expect(message).toContain('pages.trialUsedSkippedWarning');
        expect(message).not.toContain('pageLimitSkippedWarning');
    });

    it('reports pages held by another workspace', async () => {
        mockAuthThenSync({
            synced: 0,
            takenCount: 1,
            takenPages: [{ pageName: 'Someone Elses Page' }],
        });

        render(<AuthCallback />);

        await waitFor(() => expect(mockToastWarning).toHaveBeenCalledTimes(1));
        expect(mockToastWarning.mock.calls[0][0]).toContain('pages.pageTakenWarning');
    });

    it('offers no workspace-switch action mid-auth — the store is not usable yet', async () => {
        mockAuthThenSync({
            synced: 0,
            alreadyMemberOf: [{ workspaceId: 'w2', workspaceName: 'Other Co', role: 'member', pageName: 'P' }],
        });

        render(<AuthCallback />);

        await waitFor(() => expect(mockToastWarning).toHaveBeenCalledTimes(1));
        const [message, options] = mockToastWarning.mock.calls[0];
        expect(message).toContain('pages.pageTakenInWorkspace');
        expect(options).not.toHaveProperty('action');
    });

    it('stays silent when every granted page connected', async () => {
        mockAuthThenSync({ synced: 2, pages: [{ id: 'a' }, { id: 'b' }] });

        render(<AuthCallback />);

        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalled());
        expect(mockToastWarning).not.toHaveBeenCalled();
    });

    it('does not block the redirect when the sync itself fails', async () => {
        mockAuthThenSync({}, false);

        render(<AuthCallback />);

        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/pages', '/pages', { locale: 'en' }));
        expect(mockToastWarning).not.toHaveBeenCalled();
    });
});
