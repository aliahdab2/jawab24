import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import AuthSync from '@/pages/auth/sync';
import axios from 'axios';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const mockSetAuth = vi.hoisted(() => vi.fn());
const mockSetWorkspaces = vi.hoisted(() => vi.fn());
const mockSetLanguage = vi.hoisted(() => vi.fn());
vi.mock('@/lib/store', () => ({
    useAuthStore: () => ({ setAuth: mockSetAuth, setWorkspaces: mockSetWorkspaces }),
    useUIStore: { getState: () => ({ setLanguage: mockSetLanguage }) },
}));

const mockCaptureError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sentryHelpers', () => ({ captureError: mockCaptureError }));

// Stable router object (fresh objects per render would re-fire the sync
// effect on every setStatus render — the real router is referentially stable).
const { mockRouterReplace, routerState } = vi.hoisted(() => ({
    mockRouterReplace: vi.fn(),
    routerState: { query: {} as Record<string, string>, locale: undefined as string | undefined },
}));
const stableRouter = vi.hoisted(() => ({
    isReady: true,
    get query() { return routerState.query; },
    get locale() { return routerState.locale; },
    replace: mockRouterReplace,
}));
vi.mock('next/router', () => ({ useRouter: () => stableRouter }));

const mockedAxios = vi.mocked(axios, true);

const USER = { id: 'user-1', name: 'Merchant' };

function mockApiRoutes() {
    mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.endsWith('/auth/me')) return { data: USER };
        if (url.endsWith('/workspaces')) return { data: [{ id: 'ws-1' }] };
        throw new Error(`Unexpected GET ${url}`);
    });
}

describe('AuthSync page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        routerState.query = {};
        routerState.locale = undefined;
        mockApiRoutes();
    });

    // Mutation-checked: removing the setLanguage call fails the first assertion;
    // dropping the `{ locale }` from router.replace fails the second.
    it("adopts the URL locale into the UI store and forwards WITH it — the frame's language survives the break-out", async () => {
        routerState.locale = 'ar';
        routerState.query = { code: 'opaque-handoff-code', redirect: '/pages?connectFacebook=true' };
        mockedAxios.post.mockResolvedValue({ data: { token: 'session-token', defaultWorkspaceId: 'ws-1' } });

        render(<AuthSync />);

        // _app.tsx re-routes the NEXT page to the persisted language; without this
        // an Arabic merchant breaking out of the Zid frame landed on /en/pages.
        await waitFor(() => expect(mockSetLanguage).toHaveBeenCalledWith('ar'));
        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith(
            '/pages?connectFacebook=true', undefined, { locale: 'ar' },
        ));
    });

    it('token path (mobile deep link): uses the token as the session and forwards to redirect', async () => {
        routerState.query = { token: 'deep-link-token', redirect: '/dashboard' };

        render(<AuthSync />);

        await waitFor(() => {
            expect(mockSetAuth).toHaveBeenCalledWith(USER, 'deep-link-token', '');
        });
        // No handoff exchange on this path
        expect(mockedAxios.post).not.toHaveBeenCalled();
        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/dashboard'));
    });

    it('code path (app→browser handoff): trades the single-use code for a real login, then forwards', async () => {
        routerState.query = { code: 'opaque-handoff-code', redirect: '/pages?connectWhatsApp=true&waPage=page_x' };
        mockedAxios.post.mockResolvedValue({ data: { token: 'session-token', defaultWorkspaceId: 'ws-1' } });

        render(<AuthSync />);

        await waitFor(() => {
            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.stringContaining('/auth/browser-handoff/exchange'),
                { code: 'opaque-handoff-code' },
                { withCredentials: true },
            );
        });
        // The EXCHANGED token becomes the session — the code itself never does.
        await waitFor(() => {
            expect(mockSetAuth).toHaveBeenCalledWith(USER, 'session-token', '');
        });
        expect(mockedAxios.get).toHaveBeenCalledWith(
            expect.stringContaining('/auth/me'),
            { headers: { Authorization: 'Bearer session-token' } },
        );
        // Workspace hint comes from the exchange response (parity with the
        // mobile deep link, where it rides the URL).
        expect(mockSetWorkspaces).toHaveBeenCalledWith([{ id: 'ws-1' }], { defaultWorkspaceId: 'ws-1' });
        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/pages?connectWhatsApp=true&waPage=page_x'));
    });

    it('an expired/used code fails the sync and lands on /login — never a half-session', async () => {
        routerState.query = { code: 'stale-code', redirect: '/pages' };
        mockedAxios.post.mockRejectedValue(new Error('401'));

        render(<AuthSync />);

        await waitFor(() => expect(mockCaptureError).toHaveBeenCalled());
        expect(mockSetAuth).not.toHaveBeenCalled();
        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/login'), { timeout: 4000 });
    });

    // Mutation-checked: removing `clearEmbeddedSession()` from syncAuth fails this.
    it('clears a cloned embedded (platform-frame) marker on arrival — this tab is top-level and first-party', async () => {
        // Browsers without storage partitioning copy sessionStorage into a
        // window.open target — which is exactly how the embedded break-out opens
        // THIS tab. A surviving marker would keep the API client on the frame's
        // Bearer token and make /pages believe it is still framed.
        const { setEmbeddedSession, getEmbeddedPlatform, getEmbeddedToken } = await import('@/lib/embeddedSession');
        setEmbeddedSession('zid', 'frame-credential', 'frame-token');
        routerState.query = { code: 'opaque-handoff-code', redirect: '/pages?connectFacebook=true' };
        mockedAxios.post.mockResolvedValue({ data: { token: 'session-token', defaultWorkspaceId: 'ws-1' } });

        render(<AuthSync />);

        await waitFor(() => expect(mockSetAuth).toHaveBeenCalledWith(USER, 'session-token', ''));
        expect(getEmbeddedPlatform()).toBeNull();
        expect(getEmbeddedToken()).toBeNull();
        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/pages?connectFacebook=true'));
    });
});
