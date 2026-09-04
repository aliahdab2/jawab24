/**
 * Both Facebook RECONNECT legs must hand the refused pages on to /pages.
 *
 * A sync can succeed (200) and still refuse pages — plan page limit, trial
 * already used, held by another workspace. `auth/callback.tsx` used to throw
 * that away, so the merchant landed on /pages with fewer pages than they
 * granted and no explanation. Observed 2026-09-04 on a Starter workspace at
 * `max_pages = 1`: Facebook returned 2 pages, the backend refused the second
 * with `skipReason: 'page_limit'`, and nothing was ever shown.
 *
 * ⚠️ There are TWO legs and they are NOT interchangeable:
 *
 *  1. `POST /auth/facebook/link` — taken when the persisted store says
 *     authenticated. On web that is ALWAYS (`isAuthenticated` is persisted to
 *     localStorage and rehydrated from synchronous storage before this effect
 *     runs), so it is the leg a signed-in merchant reconnecting from /pages
 *     actually takes. It syncs SERVER-side and returns the refusals as
 *     `pageSync`.
 *  2. `POST /auth/facebook` then `POST /pages/sync` — taken only when the
 *     browser holds no session (the mobile Custom Tab jar).
 *
 * The first version of this fix covered only leg 2, and this suite only ever
 * ran with `isAuthenticated = false` — so it was green while the leg a web
 * merchant takes stayed silent. Every test below states its leg.
 *
 * These tests pin the HANDOFF, not the fetch: a sync whose refusals go nowhere
 * is the defect. The rendering itself is pinned on /pages (pages.test.tsx),
 * which is where it now happens.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import AuthCallback from '@/pages/auth/callback';
import { takePageSyncOutcome } from '@/features/pageSync';

const mockCaptureError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));

vi.mock('@/lib/sentryHelpers', () => ({
    captureError: mockCaptureError,
    getBackendErrorCode: () => undefined,
}));

vi.mock('next-intl', () => ({
    useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
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

const AUTH_BODY = {
    token: 'session-token',
    fbAccessToken: 'fb-token',
    user: { id: 'u1', email: 'merchant@example.com' },
    settings: {},
};

/** Leg 2: no session in this browser — `/auth/facebook` then `/pages/sync`. */
function mockUnauthenticatedLeg(syncBody: unknown, syncOk = true) {
    authState.isAuthenticated = false;
    const fetchMock = vi.fn((url: string) => {
        if (url.includes('/pages/sync')) {
            return Promise.resolve({ ok: syncOk, status: syncOk ? 200 : 500, json: () => Promise.resolve(syncBody) } as Response);
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(AUTH_BODY) } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

/** Leg 1: the signed-in web reconnect — `/auth/facebook/link`, which syncs server-side. */
function mockAuthenticatedLeg(linkBody: Record<string, unknown>) {
    authState.isAuthenticated = true;
    authState.token = 'existing-token';
    const fetchMock = vi.fn((url: string) => {
        if (url.includes('/auth/facebook/link')) {
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ ...AUTH_BODY, ...linkBody }),
            } as Response);
        }
        throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

const PAGE_LIMIT_OUTCOME = {
    skippedCount: 1,
    skippedPages: [{ pageName: 'Jawab24 Test Salla' }],
    skipReason: 'page_limit' as const,
    pageLimit: 1,
};

describe('AuthCallback — reconnect hands refused pages to /pages', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.sessionStorage.clear();
        authState.isAuthenticated = false;
        authState.token = null;
        // "returnUrl|platform|locale|reconnect" — the reconnect shape the Facebook
        // dialog carries (observed live: state=/pages|web|en|reconnect).
        routerState.query = { code: 'oauth-code', state: '/pages|web|en|reconnect' };
    });

    describe('signed-in web reconnect (POST /auth/facebook/link)', () => {
        it('hands over the pages the plan refused', async () => {
            const fetchMock = mockAuthenticatedLeg({ pageSync: PAGE_LIMIT_OUTCOME });

            render(<AuthCallback />);

            await waitFor(() => expect(mockRouterReplace).toHaveBeenCalled());
            // /pages/sync is NEVER called on this leg — the backend synced already.
            expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/pages/sync'))).toBe(false);
            expect(takePageSyncOutcome()).toEqual(PAGE_LIMIT_OUTCOME);
        });

        it('hands over pages held by a workspace the user already belongs to', async () => {
            const alreadyMemberOf = [{ workspaceId: 'w2', workspaceName: 'Other Co', role: 'member', pageName: 'P' }];
            mockAuthenticatedLeg({ pageSync: { alreadyMemberOf } });

            render(<AuthCallback />);

            await waitFor(() => expect(mockRouterReplace).toHaveBeenCalled());
            expect(takePageSyncOutcome()).toEqual({ alreadyMemberOf });
        });

        it('hands over nothing when every granted page connected', async () => {
            mockAuthenticatedLeg({});

            render(<AuthCallback />);

            await waitFor(() => expect(mockRouterReplace).toHaveBeenCalled());
            expect(takePageSyncOutcome()).toBeUndefined();
        });
    });

    describe('no session in this browser (POST /auth/facebook + POST /pages/sync)', () => {
        it('hands over the pages the plan refused', async () => {
            mockUnauthenticatedLeg({ synced: 1, ...PAGE_LIMIT_OUTCOME });

            render(<AuthCallback />);

            await waitFor(() => expect(mockRouterReplace).toHaveBeenCalled());
            expect(takePageSyncOutcome()).toMatchObject({ skipReason: 'page_limit', pageLimit: 1 });
        });

        it('distinguishes a returning identity from a page-count limit', async () => {
            mockUnauthenticatedLeg({
                synced: 0,
                skippedCount: 2,
                skippedPages: [{ pageName: 'Page A' }, { pageName: 'Page B' }],
                skipReason: 'subscription_inactive',
            });

            render(<AuthCallback />);

            await waitFor(() => expect(mockRouterReplace).toHaveBeenCalled());
            expect(takePageSyncOutcome()).toMatchObject({ skipReason: 'subscription_inactive', skippedCount: 2 });
        });

        it('hands over nothing when every granted page connected', async () => {
            mockUnauthenticatedLeg({ synced: 2, pages: [{ id: 'a' }, { id: 'b' }] });

            render(<AuthCallback />);

            await waitFor(() => expect(mockRouterReplace).toHaveBeenCalled());
            expect(takePageSyncOutcome()).toBeUndefined();
        });

        it('reports a failed sync instead of redirecting in silence', async () => {
            mockUnauthenticatedLeg({}, false);

            render(<AuthCallback />);

            await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/pages', '/pages', { locale: 'en' }));
            expect(takePageSyncOutcome()).toBeUndefined();
            expect(mockCaptureError).toHaveBeenCalledWith(
                expect.any(Error),
                'Reconnect page sync failed',
                expect.objectContaining({ tags: expect.objectContaining({ action: 'reconnectSync' }) }),
            );
        });
    });
});
