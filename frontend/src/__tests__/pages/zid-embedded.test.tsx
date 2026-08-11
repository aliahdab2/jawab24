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
            throw new Error(`Unexpected GET ${url}`);
        });
        mockedAxios.post.mockResolvedValue({
            data: { token: 'session-token', defaultWorkspaceId: 'ws-1' },
        });
    });

    it('trades the Zid iframe token for a session and lands the merchant in the app', async () => {
        routerState.query = { token: 'uuid-from-zid', language: 'ar' };

        render(<ZidEmbedded />);

        await waitFor(() => {
            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.stringContaining('/zid/embedded/session'),
                { token: 'uuid-from-zid' },
            );
        });

        // The UUID is kept so an expired access token can be re-minted without
        // making the merchant reopen the app.
        expect(setEmbeddedSession).toHaveBeenCalledWith('zid', 'uuid-from-zid', 'session-token');
        await waitFor(() => expect(mockSetAuth).toHaveBeenCalledWith(USER, 'session-token', ''));
        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/zid/onboarding'));
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

        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/zid/onboarding'));
        expect(mockSetWorkspaces).not.toHaveBeenCalled();
    });
});
