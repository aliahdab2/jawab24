import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import type { ReactNode } from 'react';

/**
 * The Zid onboarding wizard inside the platform frame — the three gaps found in
 * the live run of 2026-08-30 on the dev store:
 *   1. it always started at «مرحباً بك» even after the page was connected
 *      (Zid re-rendered the iframe mid-flow and React state alone was lost);
 *   2. step 2 fetched pages once, so after connecting in the break-out tab the
 *      frame kept saying «لا توجد صفحات متصلة» until رجوع → forward;
 *   3. the break-out landed on plain /pages, in the wrong locale, asking the
 *      merchant to pick "Facebook page" a second time.
 *
 * Mutation-checked: deleting the derived-step effect fails the first two
 * cases; deleting the focus/visibility listener fails the refetch case;
 * dropping `?connectFacebook=true` or `{ locale }` fails the break-out case.
 */

const { mockPagesGetAll, mockOpenTopLevelAuthenticated, mockRouterPush, embedded } = vi.hoisted(() => ({
    mockPagesGetAll: vi.fn(),
    mockOpenTopLevelAuthenticated: vi.fn(),
    mockRouterPush: vi.fn(),
    embedded: { platform: 'zid' as 'zid' | null },
}));

vi.mock('@/lib/api', () => ({
    zidApi: { getStore: vi.fn(), syncProducts: vi.fn(), linkPage: vi.fn().mockResolvedValue({}) },
    pagesApi: { getAll: mockPagesGetAll },
}));
vi.mock('@/lib/store', () => ({
    useAuthStore: (selector: (s: { isAuthenticated: boolean; _hasHydrated: boolean }) => unknown) =>
        selector({ isAuthenticated: true, _hasHydrated: true }),
}));
vi.mock('@/lib/embeddedSession', () => ({ getEmbeddedPlatform: () => embedded.platform }));
vi.mock('@/lib/embeddedBreakout', () => ({
    openTopLevelAuthenticated: (...args: unknown[]) => mockOpenTopLevelAuthenticated(...args),
}));
vi.mock('@/hooks/useEcommerceStoreSync', () => ({
    useEcommerceStoreSync: () => ({
        store: { storeName: 'Jawab24 Dev', storeDomain: 'h47p59.zid.store' },
        storeLoading: false,
        storeError: false,
        syncStatus: 'done',
        syncResult: { synced: 4 },
        retrySync: vi.fn(),
    }),
}));
vi.mock('@/components/onboarding/StoreAutoReplyRow', () => ({
    StoreAutoReplyRow: () => <div data-testid="auto-reply-row" />,
}));
vi.mock('@/components/ui', () => ({
    Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => (
        <button onClick={onClick} disabled={disabled}>{children}</button>
    ),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
    useLocale: () => 'ar',
}));
vi.mock('next/router', () => ({
    useRouter: () => ({ push: mockRouterPush, replace: vi.fn(), isReady: true, query: {} }),
}));
vi.mock('@/i18n/getMessages', () => ({ makeGetStaticProps: () => async () => ({ props: {} }) }));
vi.mock('@/i18n/namespaces', () => ({ PAGE_NAMESPACES: { zidOnboard: [] } }));

import ZidOnboarding from '@/pages/zid/onboarding';

const PAGE = { id: 'page-1', name: 'Jawab24 Test', facebookPageId: 'fb-1', autoReplyEnabled: false, ecommerceStoreId: null };

describe('Zid onboarding wizard (embedded)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        embedded.platform = 'zid';
    });

    it('starts at the welcome step when the merchant has no page yet', async () => {
        mockPagesGetAll.mockResolvedValue({ data: [] });
        render(<ZidOnboarding />);
        expect(await screen.findByText('onboarding.welcomeTitle')).toBeInTheDocument();
    });

    it('derives step 2 from server state when a page is connected but not yet linked', async () => {
        mockPagesGetAll.mockResolvedValue({ data: [PAGE] });
        render(<ZidOnboarding />);
        expect(await screen.findByText('onboarding.connectPage')).toBeInTheDocument();
        expect(screen.getByText('Jawab24 Test')).toBeInTheDocument();
        expect(screen.queryByText('onboarding.welcomeTitle')).not.toBeInTheDocument();
    });

    it('derives the DONE step when a page is already linked to the store, and tells the merchant how to sign in elsewhere', async () => {
        mockPagesGetAll.mockResolvedValue({ data: [{ ...PAGE, ecommerceStoreId: 'store-1' }] });
        render(<ZidOnboarding />);
        expect(await screen.findByText('onboarding.done')).toBeInTheDocument();
        expect(screen.getByText('onboarding.doneSignInHint')).toBeInTheDocument();
    });

    it('breaks out to the Facebook dialog directly, in the frame\'s locale', async () => {
        mockPagesGetAll.mockResolvedValue({ data: [] });
        render(<ZidOnboarding />);
        fireEvent.click(await screen.findByText('onboarding.welcomeCta'));
        fireEvent.click(await screen.findByText('onboarding.connectPage'));
        fireEvent.click(await screen.findByText('onboarding.connectFacebookCta'));

        expect(mockOpenTopLevelAuthenticated).toHaveBeenCalledWith('/pages?connectFacebook=true', { locale: 'ar' });
        expect(mockRouterPush).not.toHaveBeenCalled();
    });

    it('re-reads the pages when the frame regains focus — the page was connected in another tab', async () => {
        mockPagesGetAll.mockResolvedValue({ data: [] });
        render(<ZidOnboarding />);
        fireEvent.click(await screen.findByText('onboarding.welcomeCta'));
        fireEvent.click(await screen.findByText('onboarding.connectPage'));
        expect(await screen.findByText('onboarding.noPages')).toBeInTheDocument();

        mockPagesGetAll.mockResolvedValue({ data: [PAGE] });
        await act(async () => { window.dispatchEvent(new Event('focus')); });

        await waitFor(() => expect(screen.getByText('Jawab24 Test')).toBeInTheDocument());
        expect(screen.queryByText('onboarding.noPages')).not.toBeInTheDocument();
    });

    it('on the plain web (not embedded) the connect step navigates in place, unchanged', async () => {
        embedded.platform = null;
        mockPagesGetAll.mockResolvedValue({ data: [] });
        render(<ZidOnboarding />);
        fireEvent.click(await screen.findByText('onboarding.welcomeCta'));
        fireEvent.click(await screen.findByText('onboarding.connectPage'));
        fireEvent.click(await screen.findByText('onboarding.connectFacebookCta'));

        expect(mockRouterPush).toHaveBeenCalledWith('/pages');
        expect(mockOpenTopLevelAuthenticated).not.toHaveBeenCalled();
    });
});
