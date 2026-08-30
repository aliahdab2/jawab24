import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen, fireEvent } from '@testing-library/react';
import ZidEmbedded from '@/pages/zid/embedded';
import axios from 'axios';
import { setEmbeddedSession } from '@/lib/embeddedSession';
import { openTopLevelAuthenticated } from '@/lib/embeddedBreakout';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

// The ui barrel transitively imports lib/api (axios.create) — mock the two
// components the launchpad uses so the mocked axios above stays sufficient.
vi.mock('@/components/ui', () => ({
    Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
        <button onClick={onClick}>{children}</button>
    ),
    Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const mockSetAuth = vi.hoisted(() => vi.fn());
const mockSetWorkspaces = vi.hoisted(() => vi.fn());
vi.mock('@/lib/store', () => ({
    useAuthStore: () => ({ setAuth: mockSetAuth, setWorkspaces: mockSetWorkspaces }),
}));

const mockCaptureError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sentryHelpers', () => ({ captureError: mockCaptureError }));

const mockGetCredential = vi.hoisted(() => vi.fn<() => string | null>(() => null));
vi.mock('@/lib/embeddedSession', () => ({
    setEmbeddedSession: vi.fn(),
    getEmbeddedCredential: mockGetCredential,
}));

vi.mock('@/lib/embeddedBreakout', () => ({ openTopLevelAuthenticated: vi.fn() }));
vi.mock('@/lib/marketplaceBilling', () => ({
    getMarketplaceBilling: (usage: { subscription?: { marketplaceBilling?: unknown } } | null) =>
        usage?.subscription?.marketplaceBilling ?? null,
    openMarketplaceManageUrl: vi.fn(),
}));

// next-intl: return the key so assertions don't depend on copy.
vi.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
    useLocale: () => 'ar',
}));

const { mockRouterReplace, routerState } = vi.hoisted(() => ({
    mockRouterReplace: vi.fn(),
    routerState: { query: {} as Record<string, string> },
}));
const stableRouter = vi.hoisted(() => ({
    isReady: true,
    pathname: '/zid/embedded',
    get query() { return routerState.query; },
    replace: mockRouterReplace,
}));
vi.mock('next/router', () => ({ useRouter: () => stableRouter }));

const mockedAxios = vi.mocked(axios, true);
const USER = { id: 'owner-1', name: 'Merchant' };
const STORE = { id: 'store-1', storeName: 'Jawab24 Dev', productCount: 4 };
const LINKED_PAGE = { id: 'page-1', name: 'Jawab24 Test', ecommerceStoreId: 'store-1', autoReplyEnabled: true, isConnected: true };
const UNLINKED_PAGE = { id: 'page-1', name: 'Jawab24 Test', ecommerceStoreId: null, autoReplyEnabled: false, isConnected: true };

function mockApi({ pages = [UNLINKED_PAGE] as unknown[], store = STORE as unknown, manageUrl }: {
    pages?: unknown[]; store?: unknown; manageUrl?: string;
} = {}) {
    mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.endsWith('/auth/me')) return { data: USER };
        if (url.endsWith('/workspaces')) return { data: [{ id: 'ws-1' }] };
        if (url.endsWith('/pages')) return { data: pages };
        if (url.endsWith('/zid/store')) return { data: store };
        if (url.endsWith('/subscription/usage')) {
            return { data: { subscription: manageUrl ? { marketplaceBilling: { marketplace: 'zid', manageUrl } } : {} } };
        }
        throw new Error(`Unexpected GET ${url}`);
    });
    mockedAxios.post.mockResolvedValue({
        data: { accessToken: 'session-token', workspaceId: 'ws-1' },
    });
}

describe('Zid embedded launchpad (D-119)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        routerState.query = {};
        mockGetCredential.mockReturnValue(null);
        mockApi();
    });

    it('trades the Zid iframe token for a session and renders the status card — no in-frame routing into the app', async () => {
        routerState.query = { token: 'uuid-from-zid', language: 'ar' };

        render(<ZidEmbedded />);

        await waitFor(() => {
            // `embeddedToken` is the credential in — not `token`.
            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.stringContaining('/zid/embedded/session'),
                { embeddedToken: 'uuid-from-zid' },
            );
        });

        // The UUID is kept so a remount can re-establish without reopening the app.
        expect(setEmbeddedSession).toHaveBeenCalledWith('zid', 'uuid-from-zid', 'session-token');
        await waitFor(() => expect(mockSetAuth).toHaveBeenCalledWith(USER, 'session-token', ''));

        // The launchpad renders IN PLACE: store + page on the card, and the frame
        // never navigates into the full app (the retired pre-D-119 behavior).
        expect(await screen.findByText('Jawab24 Dev')).toBeInTheDocument();
        expect(screen.getByText('Jawab24 Test')).toBeInTheDocument();
        expect(mockRouterReplace).not.toHaveBeenCalledWith('/dashboard', undefined, expect.anything());
        expect(mockRouterReplace).not.toHaveBeenCalledWith('/zid/onboarding', undefined, expect.anything());
    });

    it('strips the credential from the URL before doing anything else', async () => {
        routerState.query = { token: 'uuid-from-zid', language: 'ar' };
        const replaceState = vi.spyOn(window.history, 'replaceState');

        render(<ZidEmbedded />);

        await waitFor(() => {
            expect(replaceState).toHaveBeenCalledWith(null, '', window.location.pathname);
        });
    });

    it('no linked page → CTA opens the connect flow top-level, in the frame locale', async () => {
        routerState.query = { token: 'uuid-from-zid', language: 'ar' };
        mockApi({ pages: [] });

        render(<ZidEmbedded />);

        const cta = await screen.findByText('launchpad.completeSetup');
        fireEvent.click(cta);
        expect(openTopLevelAuthenticated).toHaveBeenCalledWith('/pages?connectFacebook=true', { locale: 'ar' });
    });

    it('a connected-but-UNLINKED page must not be captioned as linked — the card cannot contradict its own CTA', async () => {
        routerState.query = { token: 'uuid-from-zid', language: 'ar' };
        mockApi({ pages: [UNLINKED_PAGE] });

        render(<ZidEmbedded />);

        expect(await screen.findByText('Jawab24 Test')).toBeInTheDocument();
        expect(screen.getByText('launchpad.pageNotLinkedYet')).toBeInTheDocument();
        expect(screen.queryByText('launchpad.pageLinked')).not.toBeInTheDocument();
        // And the CTA agrees: setup is not done.
        expect(screen.getByText('launchpad.completeSetup')).toBeInTheDocument();
    });

    it('linked page → CTA opens the dashboard top-level', async () => {
        routerState.query = { token: 'uuid-from-zid', language: 'ar' };
        mockApi({ pages: [LINKED_PAGE] });

        render(<ZidEmbedded />);

        const cta = await screen.findByText('launchpad.openApp');
        fireEvent.click(cta);
        expect(openTopLevelAuthenticated).toHaveBeenCalledWith('/dashboard', { locale: 'ar' });
    });

    it('shows the manage-plan link only when the marketplace billing URL exists', async () => {
        routerState.query = { token: 'uuid-from-zid', language: 'ar' };
        mockApi({ manageUrl: 'https://dashboard.zid.sa/ar-sa/stores/1/apps/7367/plans' });

        render(<ZidEmbedded />);
        expect(await screen.findByText('launchpad.managePlanInZid')).toBeInTheDocument();
    });

    it('remounts with NO url token re-establish from the stored credential (locale switch, iframe re-render)', async () => {
        routerState.query = { language: 'ar' };
        mockGetCredential.mockReturnValue('stored-uuid');

        render(<ZidEmbedded />);

        await waitFor(() => {
            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.stringContaining('/zid/embedded/session'),
                { embeddedToken: 'stored-uuid' },
            );
        });
        expect(await screen.findByText('Jawab24 Dev')).toBeInTheDocument();
    });

    it('a session failure shows the reopen guidance — never a login form', async () => {
        routerState.query = { token: 'uuid-from-zid' };
        mockedAxios.post.mockRejectedValue(new Error('401'));

        render(<ZidEmbedded />);

        expect(await screen.findByText('embedded.errorTitle')).toBeInTheDocument();
        expect(mockCaptureError).toHaveBeenCalled();
        expect(screen.queryByText(/login/i)).not.toBeInTheDocument();
    });

    it('no token anywhere (expired logout, cleared storage) → the same error screen', async () => {
        routerState.query = {};
        mockGetCredential.mockReturnValue(null);

        render(<ZidEmbedded />);

        expect(await screen.findByText('embedded.errorTitle')).toBeInTheDocument();
        expect(mockedAxios.post).not.toHaveBeenCalled();
    });
});
