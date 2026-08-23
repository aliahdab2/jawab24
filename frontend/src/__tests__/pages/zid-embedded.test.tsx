import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import ZidEmbedded from '@/pages/zid/embedded';
import axios from 'axios';
import { setEmbeddedSession } from '@/lib/embeddedSession';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const mockSetAuth = vi.hoisted(() => vi.fn());
const mockSetWorkspaces = vi.hoisted(() => vi.fn());
vi.mock('@/lib/store', () => ({
    useAuthStore: () => ({ setAuth: mockSetAuth, setWorkspaces: mockSetWorkspaces }),
}));

const mockCaptureError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sentryHelpers', () => ({ captureError: mockCaptureError }));

vi.mock('@/lib/embeddedSession', () => ({ setEmbeddedSession: vi.fn() }));

// next-intl: return the key so assertions don't depend on copy.
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

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

const mockedAxios = vi.mocked(axios, true);
const USER = { id: 'owner-1', name: 'Merchant' };

describe('Zid embedded entry page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        routerState.query = {};
        mockedAxios.get.mockImplementation(async (url: string) => {
            if (url.endsWith('/auth/me')) return { data: USER };
            if (url.endsWith('/workspaces')) return { data: [{ id: 'ws-1' }] };
            // A fresh install: a page may exist, but none is linked to the store yet.
            if (url.endsWith('/pages')) return { data: [{ id: 'page-1', ecommerceStoreId: null }] };
            throw new Error(`Unexpected GET ${url}`);
        });
        mockedAxios.post.mockResolvedValue({
            data: { accessToken: 'session-token', workspaceId: 'ws-1' },
        });
    });

    it('trades the Zid iframe token for a session and lands the merchant in the app', async () => {
        routerState.query = { token: 'uuid-from-zid', language: 'ar' };

        render(<ZidEmbedded />);

        await waitFor(() => {
            // `embeddedToken` is the credential in — not `token`.
            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.stringContaining('/zid/embedded/session'),
                { embeddedToken: 'uuid-from-zid' },
            );
        });

        // The UUID is kept so an expired access token can be re-minted without
        // making the merchant reopen the app.
        expect(setEmbeddedSession).toHaveBeenCalledWith('zid', 'uuid-from-zid', 'session-token');
        await waitFor(() => expect(mockSetAuth).toHaveBeenCalledWith(USER, 'session-token', ''));
        // Zid's language is honoured on the way into the app.
        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/zid/onboarding', undefined, { locale: 'ar' }));
    });

    it('strips the credential from the URL before doing anything else', async () => {
        routerState.query = { token: 'uuid-from-zid' };
        const replaceState = vi.spyOn(window.history, 'replaceState');

        render(<ZidEmbedded />);

        // The token rides the iframe src; it must not linger in history/referrer.
        await waitFor(() => expect(replaceState).toHaveBeenCalled());
        const [, , url] = replaceState.mock.calls[0];
        expect(String(url)).not.toContain('uuid-from-zid');
        replaceState.mockRestore();
    });

    it('persists the session BEFORE calling /auth/me — the api client reads its Bearer token from there', async () => {
        routerState.query = { token: 'uuid-from-zid' };
        const order: string[] = [];
        vi.mocked(setEmbeddedSession).mockImplementation(() => { order.push('persist'); });
        mockedAxios.get.mockImplementation(async (url: string) => {
            if (url.endsWith('/auth/me')) { order.push('auth/me'); return { data: USER }; }
            return { data: [{ id: 'ws-1' }] };
        });

        render(<ZidEmbedded />);

        await waitFor(() => expect(order).toEqual(['persist', 'auth/me']));
    });

    it('sends the access token as a Bearer header, never a cookie (third-party frame)', async () => {
        routerState.query = { token: 'uuid-from-zid' };

        render(<ZidEmbedded />);

        await waitFor(() => {
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.stringContaining('/auth/me'),
                { headers: { Authorization: 'Bearer session-token' } },
            );
        });
        // withCredentials would be a silent no-op here and mask the real design.
        const meCall = mockedAxios.get.mock.calls.find(([url]) => String(url).endsWith('/auth/me'));
        expect(meCall?.[1]).not.toHaveProperty('withCredentials');
    });

    it('shows a reopen-from-dashboard message instead of a login form when the token is rejected', async () => {
        routerState.query = { token: 'stale-uuid' };
        mockedAxios.post.mockRejectedValueOnce(new Error('401'));

        render(<ZidEmbedded />);

        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect(screen.getByText('embedded.errorTitle')).toBeInTheDocument();
        // Never bounce an embedded merchant to /login — that IS the rejected defect.
        expect(mockRouterReplace).not.toHaveBeenCalled();
        expect(mockCaptureError).toHaveBeenCalled();
    });

    it('explains rather than spins when arriving with no token at all', async () => {
        routerState.query = {};

        render(<ZidEmbedded />);

        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('explains rather than retrying when redirected here after an embedded session expiry', async () => {
        routerState.query = { expired: '1' };

        render(<ZidEmbedded />);

        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('still establishes the session when the workspaces call fails', async () => {
        routerState.query = { token: 'uuid-from-zid' };
        mockedAxios.get.mockImplementation(async (url: string) => {
            if (url.endsWith('/auth/me')) return { data: USER };
            throw new Error('workspaces 500');
        });

        render(<ZidEmbedded />);

        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/zid/onboarding', undefined, undefined));
        expect(mockSetWorkspaces).not.toHaveBeenCalled();
    });

    // Until 2026-08-23 every open of the app from the Zid dashboard — store
    // connected, products synced, page linked — landed on «let's connect your
    // Zid store». The wizard is for the first open only; a page linked to the
    // store is the proof it was completed.
    it('lands a merchant whose page is already linked to the store in the app, not the wizard', async () => {
        routerState.query = { token: 'uuid-from-zid', language: 'ar' };
        mockedAxios.get.mockImplementation(async (url: string) => {
            if (url.endsWith('/auth/me')) return { data: USER };
            if (url.endsWith('/workspaces')) return { data: [{ id: 'ws-1' }] };
            if (url.endsWith('/pages')) {
                return { data: [
                    { id: 'page-1', ecommerceStoreId: null },
                    { id: 'page-2', ecommerceStoreId: 'store-1' },
                ] };
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        render(<ZidEmbedded />);

        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/dashboard', undefined, { locale: 'ar' }));
        expect(mockRouterReplace).not.toHaveBeenCalledWith('/zid/onboarding', expect.anything(), expect.anything());
    });

    it('reads the pages in parallel with the profile, as a Bearer call, and never before the session is persisted', async () => {
        routerState.query = { token: 'uuid-from-zid' };
        const order: string[] = [];
        vi.mocked(setEmbeddedSession).mockImplementation(() => { order.push('persist'); });
        mockedAxios.get.mockImplementation(async (url: string) => {
            order.push(String(url).split('/').pop() ?? '');
            if (url.endsWith('/auth/me')) return { data: USER };
            return { data: [] };
        });

        render(<ZidEmbedded />);

        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalled());
        expect(order[0]).toBe('persist');
        expect(mockedAxios.get).toHaveBeenCalledWith(
            expect.stringContaining('/pages'),
            { headers: { Authorization: 'Bearer session-token' } },
        );
    });

    it('falls back to the wizard when the pages read fails — shown once too often is recoverable, hidden is not', async () => {
        routerState.query = { token: 'uuid-from-zid' };
        mockedAxios.get.mockImplementation(async (url: string) => {
            if (url.endsWith('/auth/me')) return { data: USER };
            if (url.endsWith('/workspaces')) return { data: [{ id: 'ws-1' }] };
            throw new Error('pages 500');
        });

        render(<ZidEmbedded />);

        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/zid/onboarding', undefined, undefined));
        expect(mockCaptureError).not.toHaveBeenCalled();
    });
});
