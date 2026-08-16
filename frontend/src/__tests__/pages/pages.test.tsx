import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PagesPage from '@/pages/pages';
// The next-intl mock in test/setup.ts resolves keys against the real EN
// messages, so assert on the JSON value rather than hardcoding the copy.
import enPages from '@/i18n/en/pages.json';
import { pagesApi, api, subscriptionApi } from '@/lib/api';

// Create mock functions
const mockToastError = vi.fn();

vi.mock('sonner', () => ({
    toast: {
        error: (...args: unknown[]) => mockToastError(...args),
        success: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('@/i18n/hooks', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), dateLocale: {}, intlLocale: 'en-US' }),
}));

// Mutable so individual tests can flip the acting user's platform-admin flag.
// (The enable-without-info soft gate no longer depends on it — see D-025; isAdmin
// now only affects WhatsApp visibility and the nudge banner's strong copy.)
// Read lazily inside useAuthStore, so assignment in a test takes effect on render.
let mockIsAdmin = false;
// Mutable so the deep-link tests can start UNauthenticated (pages query
// disabled) and hydrate mid-test — the RQ v5 race regression below.
let mockIsAuthenticated = true;
// Mutable workspace role for useWorkspaceRole (reads workspaces + activeWorkspaceId
// from this store). null = leave `workspaces` undefined so the hook falls back to
// its 'owner' default, which is what every pre-existing test expects.
let mockWorkspaceRole: 'owner' | 'admin' | 'member' | null = null;
vi.mock('@/lib/store', () => ({
    useAuthStore: (selector?: (s: Record<string, unknown>) => unknown) => {
        const state = {
            isAuthenticated: mockIsAuthenticated,
            fbToken: 'mock-fb-token',
            user: { isAdmin: mockIsAdmin },
            setActiveWorkspace: vi.fn(),
            ...(mockWorkspaceRole
                ? { workspaces: [{ id: 'ws_test', role: mockWorkspaceRole }], activeWorkspaceId: 'ws_test' }
                : {}),
        };
        return selector ? selector(state) : state;
    },
    useUIStore: (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ sidebarOpen: false }),
}));

// Local router mock with mutable query + spy-able replace/push — the global setup
// mock returns a fresh static object per call, unusable for deep-link asserts.
let mockRouterQuery: Record<string, string> = {};
const mockRouterReplace = vi.fn();
const mockRouterPush = vi.fn();
vi.mock('next/router', () => ({
    useRouter: () => ({
        isReady: true,
        query: mockRouterQuery,
        pathname: '/pages',
        push: mockRouterPush,
        replace: mockRouterReplace,
        prefetch: vi.fn(),
        locale: 'en',
    }),
}));

vi.mock('@/lib/api', () => ({
    pagesApi: {
        getAll: vi.fn(),
        toggle: vi.fn(),
        archive: vi.fn(),
    },
    subscriptionApi: {
        getUsage: vi.fn(),
    },
    api: {
        patch: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
    },
}));

const mockOpenExternalUrl = vi.fn();
const mockOpenInSystemBrowser = vi.fn();
vi.mock('@/lib/openExternalUrl', () => ({
    openExternalUrl: (...args: unknown[]) => mockOpenExternalUrl(...args),
    // The WhatsApp handoff needs the REAL browser, not the in-app Custom Tab —
    // Embedded Signup's popup cannot open in one. Mocked separately so a test
    // asserting the handoff can tell the two apart; see openExternalUrl.ts.
    openInSystemBrowser: (...args: unknown[]) => mockOpenInSystemBrowser(...args),
}));

const mockLaunchWhatsAppSignup = vi.fn();
vi.mock('@/lib/whatsappSignup', () => ({
    launchWhatsAppSignup: (...args: unknown[]) => mockLaunchWhatsAppSignup(...args),
}));

const mockStartWhatsAppConnect = vi.fn();
const mockPrepareWhatsAppConnect = vi.fn();
const mockOpenWhatsAppSignupUrl = vi.fn();
vi.mock('@/lib/whatsappRedirect', () => ({
    startWhatsAppConnect: (...args: unknown[]) => mockStartWhatsAppConnect(...args),
    prepareWhatsAppConnect: (...args: unknown[]) => mockPrepareWhatsAppConnect(...args),
    openWhatsAppSignupUrl: (...args: unknown[]) => mockOpenWhatsAppSignupUrl(...args),
}));

// Phone browsers get desktop guidance before Embedded Signup is attempted
// (the fb.login popup opens unreliably there). Default false = desktop, so the
// pre-existing web tests exercise the direct flow; the mobile-web test flips it.
let mockIsMobileBrowser = false;
vi.mock('@/lib/browserEnv', () => ({
    isMobileBrowser: () => mockIsMobileBrowser,
}));

vi.mock('@/components/layout/DashboardLayout', () => ({
    DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn().mockReturnValue(false),
        getPlatform: vi.fn().mockReturnValue('web'),
    },
}));

// The native connect + Facebook reconnect legs both hand their URL to the
// Capacitor Browser tab; assertions here are about WHICH url it opens.
vi.mock('@capacitor/browser', () => ({
    Browser: { open: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@/components/ui', () => ({
    Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
        <button onClick={onClick} disabled={disabled}>{children}</button>
    ),
    // `aria-label` is forwarded because it is the ONLY thing distinguishing one
    // channel's toggle from another's in the rendered card — without it a test can
    // count switches but never assert WHICH channel it just found.
    Toggle: ({ enabled, onChange, 'aria-label': ariaLabel }: { enabled: boolean; onChange: (val: boolean) => void; 'aria-label'?: string }) => (
        <button role="switch" aria-checked={enabled} aria-label={ariaLabel} onClick={() => onChange(!enabled)}>{enabled ? 'ON' : 'OFF'}</button>
    ),
    EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
    PageHeader: ({ title, action }: { title: string; action?: React.ReactNode }) => <div><h1>{title}</h1>{action}</div>,
    PageSkeleton: () => <div data-testid="page-skeleton">Loading...</div>,
    ConfirmationModal: ({ isOpen, onClose, onConfirm, title, message, confirmText }: { isOpen: boolean; onClose: () => void; onConfirm: () => void; title?: string; message?: string; confirmText?: string }) =>
        isOpen ? (
            <div data-testid="confirmation-modal">
                <p>{title}</p>
                <p>{message}</p>
                <button onClick={onClose}>common.cancel</button>
                <button onClick={onConfirm}>{confirmText}</button>
            </div>
        ) : null,
    InfoPopover: ({ children }: { children: React.ReactNode; label?: string }) => <>{children}</>,
    UpgradeCTA: ({ children }: { children: React.ReactNode }) => <div data-testid="upgrade-cta">{children}</div>,
    Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span>,
    WhatsAppIcon: () => <svg data-testid="whatsapp-icon" />,
    FacebookIcon: () => <svg data-testid="facebook-icon" />,
    // One option in a pick-one modal — shared by the channel picker and the
    // WhatsApp onboarding-path question.
    ChoiceRow: ({ title, description, badge, onClick, disabled }: { title: React.ReactNode; description: React.ReactNode; badge?: React.ReactNode; onClick: () => void; disabled?: boolean }) => (
        <button onClick={onClick} disabled={disabled}>
            <span>{title}</span>
            <span>{description}</span>
            {badge}
        </button>
    ),
    // Shared by the channel picker and the WhatsApp onboarding-path question.
    // They are never open at once — picking WhatsApp closes the picker first.
    Modal: ({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }) =>
        isOpen ? (
            <div data-testid="modal">
                <p>{title}</p>
                <button data-testid="modal-close" onClick={onClose}>close</button>
                {children}
            </div>
        ) : null,
}));

const mockedPagesApi = vi.mocked(pagesApi);
const mockedApi = vi.mocked(api, true);
const mockedSubscriptionApi = vi.mocked(subscriptionApi);

// Plan entitlement served by useSubscriptionUsage (WhatsApp is Business+ only).
const mockUsagePlan = (whatsappEnabled: boolean) =>
    mockedSubscriptionApi.getUsage.mockResolvedValue({
        data: { data: { subscription: { plan: { whatsappEnabled } } } },
    } as unknown as Awaited<ReturnType<typeof mockedSubscriptionApi.getUsage>>);

const MOCK_PAGES = [
    {
        id: 'page_1',
        facebookPageId: 'fb_123',
        name: 'My Business Page',
        autoReplyEnabled: true,
        instagramAutoReplyEnabled: false,
        instagramUsername: 'mybiz',
        commentsCount: 25,
        knowledgeBase: 'We sell electronics.',
    },
    {
        id: 'page_2',
        facebookPageId: 'fb_456',
        name: 'Second Page',
        autoReplyEnabled: false,
        instagramAutoReplyEnabled: false,
        commentsCount: 0,
        knowledgeBase: '',
    },
];

const createWrapper = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    Wrapper.displayName = 'TestQueryWrapper';
    return Wrapper;
};

const renderPage = (ui: React.ReactElement) => render(ui, { wrapper: createWrapper() });

describe('PagesPage - Toggle Error Handling', () => {
    beforeEach(() => {
        mockToastError.mockClear();

        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: MOCK_PAGES },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);

        // Default: toggle calls succeed
        mockedPagesApi.toggle.mockResolvedValue({ data: {} } as unknown as Awaited<ReturnType<typeof mockedPagesApi.toggle>>);
        mockedApi.patch.mockResolvedValue({ data: {} } as unknown as Awaited<ReturnType<typeof mockedApi.patch>>);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should render pages with toggles', async () => {
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('My Business Page')[0]).toBeInTheDocument();
        });

        expect(screen.getAllByText('Second Page')[0]).toBeInTheDocument();
    });

    it('should show toast when Facebook toggle ON fails with PAGE_LIMIT_REACHED', async () => {
        // Override default to reject for this test
        mockedPagesApi.toggle.mockRejectedValue({
            response: {
                status: 403,
                data: { code: 'PAGE_LIMIT_REACHED', error: 'Page limit reached' },
            },
        });

        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Second Page')[0]).toBeInTheDocument();
        });

        // Page_2 FB toggle is OFF — find all OFF toggles
        const offToggles = screen.getAllByRole('switch').filter(btn => btn.getAttribute('aria-checked') === 'false');
        expect(offToggles.length).toBeGreaterThan(0);

        // Click the first OFF toggle (page_1 IG is OFF, page_2 FB is OFF)
        // We need to target page_2's FB toggle specifically — it's the 3rd switch
        // Order: page_1 FB (ON), page_1 IG (OFF), page_2 FB (OFF)
        // But page_1 IG calls handleInstagramToggle, not handleToggle
        // So let's click the last OFF toggle which should be page_2 FB
        const allSwitches = screen.getAllByRole('switch');
        // page_1 FB = allSwitches[0] (ON), page_1 IG = allSwitches[1] (OFF), page_2 FB = allSwitches[2] (OFF)
        await act(async () => {
            fireEvent.click(allSwitches[2]); // page_2 FB toggle (OFF -> ON)
        });
        // page_2 has no Business Info → the D-025 soft gate confirms first; proceed to the API.
        await act(async () => {
            fireEvent.click(screen.getByText('Turn on anyway'));
        });

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalledWith('Page limit reached. Disable another page or upgrade your plan.');
        });
    });

    it('should show toast when Facebook toggle ON fails with TRIAL_ALREADY_USED (402)', async () => {
        mockedPagesApi.toggle.mockRejectedValue({
            response: {
                status: 402,
                data: { code: 'TRIAL_ALREADY_USED', error: 'This page has already used its free trial.' },
            },
        });

        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Second Page')[0]).toBeInTheDocument();
        });

        const allSwitches = screen.getAllByRole('switch');
        await act(async () => {
            fireEvent.click(allSwitches[2]); // page_2 FB toggle (OFF -> ON)
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Turn on anyway'));
        });

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalledWith('This page has already used its free trial. Subscribe to enable auto-reply.');
        });
    });

    it('should show "renew subscription" toast (not page-limit) when toggle fails with SUBSCRIPTION_INACTIVE (402)', async () => {
        mockedPagesApi.toggle.mockRejectedValue({
            response: {
                status: 402,
                data: { code: 'SUBSCRIPTION_INACTIVE', error: 'Subscription expired. Please renew to continue.' },
            },
        });

        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Second Page')[0]).toBeInTheDocument();
        });

        const allSwitches = screen.getAllByRole('switch');
        await act(async () => {
            fireEvent.click(allSwitches[2]); // page_2 FB toggle (OFF -> ON)
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Turn on anyway'));
        });

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalledWith("Your subscription isn't active. Please renew it to continue.");
        });
        // Must NOT show the misleading page-limit message for a billing problem.
        expect(mockToastError).not.toHaveBeenCalledWith('Page limit reached. Disable another page or upgrade your plan.');
    });

    it('should show generic error toast on Facebook toggle failure (non-403)', async () => {
        mockedPagesApi.toggle.mockRejectedValue({
            response: { status: 500, data: {} },
        });

        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Second Page')[0]).toBeInTheDocument();
        });

        const allSwitches = screen.getAllByRole('switch');
        // page_2 FB toggle is allSwitches[2]
        await act(async () => {
            fireEvent.click(allSwitches[2]);
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Turn on anyway'));
        });

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalledWith('Something went wrong');
        });
    });

    it('should toggle Facebook OFF successfully without toast', async () => {
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('My Business Page')[0]).toBeInTheDocument();
        });

        const allSwitches = screen.getAllByRole('switch');
        // page_1 FB toggle is allSwitches[0] (ON)
        await act(async () => {
            fireEvent.click(allSwitches[0]);
        });

        await waitFor(() => {
            expect(mockedPagesApi.toggle).toHaveBeenCalledWith('page_1', false);
        });

        expect(mockToastError).not.toHaveBeenCalled();
    });

    it('should show toast when Instagram toggle ON fails with PAGE_LIMIT_REACHED', async () => {
        mockedApi.patch.mockRejectedValue({
            response: {
                status: 403,
                data: { code: 'PAGE_LIMIT_REACHED', error: 'Page limit reached' },
            },
        });

        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('My Business Page')[0]).toBeInTheDocument();
        });

        const allSwitches = screen.getAllByRole('switch');
        // page_1 IG toggle is allSwitches[1] (OFF)
        await act(async () => {
            fireEvent.click(allSwitches[1]);
        });
        // page_1's KB is too short to count as Business Info → soft gate confirms first.
        await act(async () => {
            fireEvent.click(screen.getByText('Turn on anyway'));
        });

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalledWith('Page limit reached. Disable another page or upgrade your plan.');
        });
    });
});

describe('PagesPage - WhatsApp', () => {
    const WA_PAGE = {
        id: 'page_wa',
        facebookPageId: 'fb_789',
        name: 'WA Page',
        autoReplyEnabled: false,
        instagramAutoReplyEnabled: false,
        commentsCount: 0,
        knowledgeBase: 'We sell things.',
        whatsappConnected: true,
        whatsappPhoneNumberId: 'pn_1',
        whatsappDisplayPhoneNumber: '+966 55 000 0000',
        whatsappAutoReplyEnabled: false,
    };

    beforeEach(() => {
        mockToastError.mockClear();
        vi.stubEnv('NEXT_PUBLIC_FB_APP_ID', '123');
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', 'cfg-1');
        // Pin the redirect-flow flag OFF for the legacy-flow suites — the release
        // script exports it in the shell, and inheriting it flips these tests'
        // entire code path (the aeb8c0a5 lesson, third flag edition). The
        // redirect-flow tests stub it 'true' explicitly per test.
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT', '');
        mockUsagePlan(true);
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [WA_PAGE] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it('disconnect: unlink -> confirm -> DELETE -> row shows not connected', async () => {
        mockedApi.delete.mockResolvedValue({
            data: {
                whatsappConnected: false,
                whatsappPhoneNumberId: null,
                whatsappDisplayPhoneNumber: null,
                whatsappAutoReplyEnabled: false,
            },
        } as unknown as Awaited<ReturnType<typeof mockedApi.delete>>);

        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('WA Page')[0]).toBeInTheDocument();
        });
        expect(screen.getByText('+966 55 000 0000')).toBeInTheDocument();

        // Owner-only unlink affordance on the connected row
        fireEvent.click(screen.getByLabelText('Disconnect WhatsApp - WA Page'));

        // ConfirmationModal (danger) opens; confirm
        expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();
        await act(async () => {
            fireEvent.click(screen.getByText('Disconnect', { selector: 'button' }));
        });

        expect(mockedApi.delete).toHaveBeenCalledWith('/pages/page_wa/whatsapp');
        await waitFor(() => {
            expect(screen.getByText('WhatsApp not connected')).toBeInTheDocument();
        });
        expect(screen.queryByText('+966 55 000 0000')).not.toBeInTheDocument();
    });

    it('cancelling the disconnect dialog makes no API call', async () => {
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('WA Page')[0]).toBeInTheDocument();
        });

        fireEvent.click(screen.getByLabelText('Disconnect WhatsApp - WA Page'));
        fireEvent.click(screen.getByText('common.cancel'));

        expect(mockedApi.delete).not.toHaveBeenCalled();
        expect(screen.getByText('+966 55 000 0000')).toBeInTheDocument();
    });

    // The card row reaches a DIFFERENT endpoint than the channel picker
    // (/pages/:id/connect-whatsapp vs /pages/connect-whatsapp), so the path
    // answer has to be proven to survive on this route too.
    it('attaching WhatsApp to an existing page card asks the path question first', async () => {
        mockLaunchWhatsAppSignup.mockResolvedValue({ code: 'c', phoneNumberId: 'pn_2', wabaId: 'w', coexistence: true });
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [{ ...WA_PAGE, id: 'page_x', whatsappConnected: false, whatsappPhoneNumberId: null, whatsappDisplayPhoneNumber: null }] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);
        mockedApi.post.mockResolvedValue({ data: { whatsappConnected: true } } as unknown as Awaited<ReturnType<typeof mockedApi.post>>);

        renderPage(<PagesPage />);
        await waitFor(() => expect(screen.getAllByText('WA Page')[0]).toBeInTheDocument());

        fireEvent.click(screen.getByText('Connect', { selector: 'button' }));
        expect(mockLaunchWhatsAppSignup).not.toHaveBeenCalled();
        expect(screen.getByText(enPages.whatsappPathTitle)).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByText(enPages.whatsappPathKeep));
        });

        expect(mockLaunchWhatsAppSignup).toHaveBeenCalledWith({ coexistence: true });
        expect(mockedApi.post).toHaveBeenCalledWith('/pages/page_x/connect-whatsapp', {
            code: 'c', phoneNumberId: 'pn_2', wabaId: 'w', coexistence: true,
        });
    });

    it('mobile: Connect hands off to the web dashboard instead of the popup', async () => {
        const { Capacitor } = await import('@capacitor/core');
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [{ ...WA_PAGE, id: 'page_x', whatsappConnected: false, whatsappPhoneNumberId: null, whatsappDisplayPhoneNumber: null }] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);

        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('WA Page')[0]).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('Connect', { selector: 'button' }));
        });

        // Desktop guidance comes FIRST: Meta's wizard popup opens unreliably on
        // phones, so the merchant is told a computer is the reliable path before
        // anything is attempted. Nothing has launched yet.
        expect(screen.getByText(enPages.whatsappDesktopNeededTitle)).toBeInTheDocument();
        expect(mockOpenInSystemBrowser).not.toHaveBeenCalled();

        // "Try on this device" = the explicit escape hatch → browser handoff.
        await act(async () => {
            fireEvent.click(screen.getByText(enPages.whatsappDesktopTryAnyway));
        });

        await waitFor(() => {
            // Via /login, NOT straight to /pages. The app's JWT lives in the
            // WebView's localStorage under a different origin, so it does not
            // travel to the system browser — a bare /pages link dropped the
            // merchant on a logged-out screen when they came to connect a
            // number. /login forwards instantly when a browser session already
            // exists, so this costs a signed-in merchant nothing.
            expect(mockOpenInSystemBrowser).toHaveBeenCalledWith(
                // ?connectWhatsApp=true is what makes the browser REOPEN the path
                // question. Without it the handoff delivered the merchant to a page
                // identical to the one they left, with no sign of what to do next —
                // "it redirects then comes back to the same page" (2026-07-29).
                // waPage preserves which card they tapped Connect on; attaching to
                // an existing page and creating a standalone WhatsApp-only card are
                // different outcomes.
                'https://jawab24.com/en/login?redirect=%2Fpages%3FconnectWhatsApp%3Dtrue%26waPage%3Dpage_x',
            );
            // 3s, not the 1s default: this asserts the END of an async chain
            // (guidance dialog → handoff), and under the full coverage run's
            // parallel load the default timeout flaked (2026-07-30 pre-deploy).
        }, { timeout: 3000 });
        expect(mockLaunchWhatsAppSignup).not.toHaveBeenCalled();
        // Must be the real browser, never the in-app Custom Tab: a Custom Tab
        // supports neither popups nor `window.opener`, so Embedded Signup silently
        // never opened and the merchant dead-ended (Android, 2026-07-29).
        expect(mockOpenExternalUrl).not.toHaveBeenCalled();
        // And the path question is SKIPPED, not asked-then-abandoned: the merchant
        // answers it in the browser we just handed off to, so asking here would
        // make them answer the same question twice.
        expect(screen.queryByText(enPages.whatsappPathTitle)).not.toBeInTheDocument();

        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    });

    it('mobile BROWSER: desktop guidance first, "try on this device" continues to the path question', async () => {
        mockIsMobileBrowser = true;
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [{ ...WA_PAGE, id: 'page_x', whatsappConnected: false, whatsappPhoneNumberId: null, whatsappDisplayPhoneNumber: null }] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);

        renderPage(<PagesPage />);
        await waitFor(() => expect(screen.getAllByText('WA Page')[0]).toBeInTheDocument());

        fireEvent.click(screen.getByText('Connect', { selector: 'button' }));

        // Guidance precedes the path question — answering a question whose
        // fb.login popup then fails to open is the dead end this prevents.
        expect(screen.getByText(enPages.whatsappDesktopNeededTitle)).toBeInTheDocument();
        expect(screen.queryByText(enPages.whatsappPathTitle)).not.toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByText(enPages.whatsappDesktopTryAnyway));
        });

        // The escape hatch reaches the normal web flow: path question, no launch
        // until the merchant answers it.
        expect(screen.getByText(enPages.whatsappPathTitle)).toBeInTheDocument();
        expect(mockLaunchWhatsAppSignup).not.toHaveBeenCalled();
        expect(mockOpenInSystemBrowser).not.toHaveBeenCalled();

        mockIsMobileBrowser = false;
    });

    it('?connectWhatsApp=true (browser side of the handoff) reopens the path question for the carried card', async () => {
        mockRouterQuery = { connectWhatsApp: 'true', waPage: 'page_x' };
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [{ ...WA_PAGE, id: 'page_x', whatsappConnected: false, whatsappPhoneNumberId: null, whatsappDisplayPhoneNumber: null }] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);

        renderPage(<PagesPage />);

        // No click needed — arriving with the param IS the resume.
        // 3s timeout: the resume waits for the pages query + router readiness,
        // and the 1s default flaked under the full coverage run (2026-07-30).
        await waitFor(() => {
            expect(screen.getByText(enPages.whatsappPathTitle)).toBeInTheDocument();
        }, { timeout: 3000 });
        // But fb.login must wait for the merchant's answer (transient user
        // activation) — auto-launching would be popup-blocked.
        expect(mockLaunchWhatsAppSignup).not.toHaveBeenCalled();

        mockRouterQuery = {};
    });

    it('?connectWhatsApp=true inside the NATIVE app must NOT open the dialog — it can only dead-end there', async () => {
        // The dialog's answer runs fb.login in the WebView, where popups are
        // disabled — the exact failure the browser handoff exists to escape. If
        // the resume param ever fires natively (deep link, stale history), do
        // nothing rather than ask a question whose answer goes nowhere.
        const { Capacitor } = await import('@capacitor/core');
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
        mockRouterQuery = { connectWhatsApp: 'true', waPage: 'page_x' };
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [{ ...WA_PAGE, id: 'page_x', whatsappConnected: false, whatsappPhoneNumberId: null, whatsappDisplayPhoneNumber: null }] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);

        renderPage(<PagesPage />);
        await waitFor(() => {
            expect(screen.getAllByText('WA Page')[0]).toBeInTheDocument();
        });
        await act(async () => { /* flush the resume effect */ });

        expect(screen.queryByText(enPages.whatsappPathTitle)).not.toBeInTheDocument();
        expect(mockLaunchWhatsAppSignup).not.toHaveBeenCalled();

        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
        mockRouterQuery = {};
    });

    // ── Redirect connect flow (NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT) ──

    it('REDIRECT flag: opening the path question PRE-MINTS both URLs; the answer navigates SYNCHRONOUSLY', async () => {
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT', 'true');
        mockPrepareWhatsAppConnect.mockResolvedValue({ coexistence: 'https://fb/coex', dedicated: 'https://fb/dedicated' });
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [{ ...WA_PAGE, id: 'page_x', whatsappConnected: false, whatsappPhoneNumberId: null, whatsappDisplayPhoneNumber: null }] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);

        renderPage(<PagesPage />);
        await waitFor(() => expect(screen.getAllByText('WA Page')[0]).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(screen.getByText('Connect', { selector: 'button' }));
        });
        expect(screen.getByText(enPages.whatsappPathTitle)).toBeInTheDocument();
        // The modal OPENING triggered the pre-mint — before any answer.
        expect(mockPrepareWhatsAppConnect).toHaveBeenCalledWith({ pageId: 'page_x', locale: 'en' });

        await act(async () => {
            fireEvent.click(screen.getByText(enPages.whatsappPathKeep));
        });

        // The tap navigates with the PRE-MINTED variant — no async start between
        // gesture and navigation (mobile Chrome silently dropped that shape).
        expect(mockOpenWhatsAppSignupUrl).toHaveBeenCalledWith('https://fb/coex');
        expect(mockStartWhatsAppConnect).not.toHaveBeenCalled();
        expect(mockLaunchWhatsAppSignup).not.toHaveBeenCalled();
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT', '');
    });

    it('REDIRECT flag: pre-mint failed → the answer falls back to the async start (which owns error toasts)', async () => {
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT', 'true');
        mockPrepareWhatsAppConnect.mockRejectedValue(new Error('network'));
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [{ ...WA_PAGE, id: 'page_x', whatsappConnected: false, whatsappPhoneNumberId: null, whatsappDisplayPhoneNumber: null }] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);

        renderPage(<PagesPage />);
        await waitFor(() => expect(screen.getAllByText('WA Page')[0]).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(screen.getByText('Connect', { selector: 'button' }));
        });
        await act(async () => {
            fireEvent.click(screen.getByText(enPages.whatsappPathDedicated));
        });

        expect(mockOpenWhatsAppSignupUrl).not.toHaveBeenCalled();
        expect(mockStartWhatsAppConnect).toHaveBeenCalledWith({ pageId: 'page_x', coexistence: false, locale: 'en' });
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT', '');
    });

    it('REDIRECT flag, native: the path question opens IN-APP, and the answer opens the browser tab DIRECTLY at Meta', async () => {
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT', 'true');
        const { Capacitor } = await import('@capacitor/core');
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
        const metaUrl = 'https://www.facebook.com/v23.0/dialog/oauth?config_id=cfg&state=st';
        mockedApi.post.mockResolvedValueOnce({ data: { url: metaUrl } } as unknown as Awaited<ReturnType<typeof mockedApi.post>>);
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [{ ...WA_PAGE, id: 'page_x', whatsappConnected: false, whatsappPhoneNumberId: null, whatsappDisplayPhoneNumber: null }] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);

        renderPage(<PagesPage />);
        await waitFor(() => expect(screen.getAllByText('WA Page')[0]).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(screen.getByText('Connect', { selector: 'button' }));
        });

        // The onboarding-path question is asked INSIDE the app — nothing is
        // minted and no browser opens before the merchant has answered.
        expect(screen.getByText(enPages.whatsappPathTitle)).toBeInTheDocument();
        expect(mockedApi.post).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.click(screen.getByText(enPages.whatsappPathDedicated));
        });

        // `nativeApp` tells the backend this state belongs to a browser that
        // will never carry our nonce cookie, and to return via the App Link.
        expect(mockedApi.post).toHaveBeenCalledWith('/auth/whatsapp/start', {
            pageId: 'page_x', coexistence: false, locale: 'en', nativeApp: true,
        });

        // The tab's FIRST document must be facebook.com — mirrors the working
        // Facebook page-connect flow. Routing the tab through a jawab24.com
        // page first is what died on a real device three separate ways
        // (Custom Tab + intent-opened Chrome + server 302, 2026-07-30/31).
        const { Browser } = await import('@capacitor/browser');
        await waitFor(() => {
            expect(Browser.open).toHaveBeenCalledWith({ url: metaUrl });
        });
        expect(mockOpenInSystemBrowser).not.toHaveBeenCalled();
        expect(mockOpenExternalUrl).not.toHaveBeenCalled();
        expect(screen.queryByText(enPages.whatsappDesktopNeededTitle)).not.toBeInTheDocument();

        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT', '');
    });

    it('REDIRECT flag, phone browser: no desktop guidance — the path question opens directly', async () => {
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT', 'true');
        mockIsMobileBrowser = true;
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [{ ...WA_PAGE, id: 'page_x', whatsappConnected: false, whatsappPhoneNumberId: null, whatsappDisplayPhoneNumber: null }] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);

        renderPage(<PagesPage />);
        await waitFor(() => expect(screen.getAllByText('WA Page')[0]).toBeInTheDocument());

        fireEvent.click(screen.getByText('Connect', { selector: 'button' }));

        expect(screen.queryByText(enPages.whatsappDesktopNeededTitle)).not.toBeInTheDocument();
        expect(screen.getByText(enPages.whatsappPathTitle)).toBeInTheDocument();

        mockIsMobileBrowser = false;
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT', '');
    });

    it('return leg: ?whatsappConnected=1 → success toast, params stripped', async () => {
        const { toast } = await import('sonner');
        mockRouterQuery = { whatsappConnected: '1', waPageId: 'page_wa' };
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(vi.mocked(toast.success)).toHaveBeenCalledWith(enPages.whatsappConnectSuccess);
        });
        expect(mockRouterReplace).toHaveBeenCalled();
        mockRouterQuery = {};
    });

    it('return leg: ?whatsappError=WHATSAPP_NUMBER_TAKEN → the SAME error copy as the popup flow', async () => {
        mockRouterQuery = { whatsappError: 'WHATSAPP_NUMBER_TAKEN' };
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalledWith(enPages.whatsappNumberTaken);
        });
        mockRouterQuery = {};
    });

    it('return leg: ?whatsappError=WHATSAPP_AMBIGUOUS → the redirect-only ambiguity copy', async () => {
        mockRouterQuery = { whatsappError: 'WHATSAPP_AMBIGUOUS' };
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalledWith(enPages.whatsappAmbiguousNumber);
        });
        mockRouterQuery = {};
    });
});

describe('PagesPage - WhatsApp-only cards', () => {
    const WA_ONLY_PAGE = {
        id: 'wa_only_1',
        facebookPageId: null,
        name: 'Noor Store',
        autoReplyEnabled: false,
        instagramAutoReplyEnabled: false,
        whatsappAutoReplyEnabled: false,
        commentsCount: 0,
        knowledgeBase: 'We sell abayas.',
        isConnected: true,
        whatsappConnected: true,
        whatsappPhoneNumberId: 'pn_9',
        whatsappDisplayPhoneNumber: '+966 50 111 2233',
    };

    beforeEach(() => {
        mockToastError.mockClear();
        vi.stubEnv('NEXT_PUBLIC_FB_APP_ID', '123');
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', 'cfg-1');
        // Pin the redirect-flow flag OFF for the legacy-flow suites — the release
        // script exports it in the shell, and inheriting it flips these tests'
        // entire code path (the aeb8c0a5 lesson, third flag edition). The
        // redirect-flow tests stub it 'true' explicitly per test.
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT', '');
        mockUsagePlan(true);
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [WA_ONLY_PAGE] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it('renders without Facebook/Instagram rows and without the reconnect banner', async () => {
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Noor Store')[0]).toBeInTheDocument();
        });

        expect(screen.getByText('+966 50 111 2233')).toBeInTheDocument();
        // No Facebook / Instagram channel rows on a WhatsApp-only card
        expect(screen.queryByText('Facebook')).not.toBeInTheDocument();
        expect(screen.queryByText('Instagram')).not.toBeInTheDocument();
        // No "reconnect Facebook" banner — there is no Facebook credential
        expect(screen.queryByText('Reconnect Required')).not.toBeInTheDocument();
        // The WhatsApp toggle is present and interactive
        expect(screen.getAllByRole('switch').length).toBe(1);
    });

    it('removing the card confirms then deletes the page row', async () => {
        mockedApi.delete.mockResolvedValue({ data: { success: true } } as unknown as Awaited<ReturnType<typeof mockedApi.delete>>);

        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Noor Store')[0]).toBeInTheDocument();
        });

        fireEvent.click(screen.getByLabelText('Disconnect WhatsApp - Noor Store'));
        expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();
        expect(screen.getByText('Remove this number?')).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByText('Remove', { selector: 'button' }));
        });

        expect(mockedApi.delete).toHaveBeenCalledWith('/pages/wa_only_1');
        await waitFor(() => {
            expect(screen.queryByText('Noor Store')).not.toBeInTheDocument();
        });
    });

    // ⛔ REGRESSION GUARD — reconnect must preserve the onboarding path.
    //
    // The reconnect banner reuses handleConnectWhatsApp. If it re-runs Embedded
    // Signup WITHOUT requesting coexistence, Meta puts the number on the
    // MIGRATION path, the backend registers it against the Cloud API, and the
    // number is taken off the merchant's WhatsApp Business app — permanently,
    // silently, and it is the exact outcome Coexistence exists to prevent.
    it('reconnect on a COEXISTENCE number re-requests coexistence', async () => {
        mockLaunchWhatsAppSignup.mockResolvedValue({ code: 'c', phoneNumberId: 'pn_9', wabaId: 'w', coexistence: true });
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [{ ...WA_ONLY_PAGE, whatsappCoexistence: true, whatsappNeedsReconnect: true }] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);
        mockedApi.post.mockResolvedValue({ data: WA_ONLY_PAGE } as unknown as Awaited<ReturnType<typeof mockedApi.post>>);

        renderPage(<PagesPage />);
        await waitFor(() => expect(screen.getAllByText('Noor Store')[0]).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(screen.getAllByText('Connect')[0]);
        });

        expect(mockLaunchWhatsAppSignup).toHaveBeenCalledWith({ coexistence: true });
    });

    it('reconnect on a MIGRATED number does not request coexistence', async () => {
        mockLaunchWhatsAppSignup.mockResolvedValue({ code: 'c', phoneNumberId: 'pn_9', wabaId: 'w', coexistence: false });
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [{ ...WA_ONLY_PAGE, whatsappCoexistence: false, whatsappNeedsReconnect: true }] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);
        mockedApi.post.mockResolvedValue({ data: WA_ONLY_PAGE } as unknown as Awaited<ReturnType<typeof mockedApi.post>>);

        renderPage(<PagesPage />);
        await waitFor(() => expect(screen.getAllByText('Noor Store')[0]).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(screen.getAllByText('Connect')[0]);
        });

        expect(mockLaunchWhatsAppSignup).toHaveBeenCalledWith({ coexistence: false });
    });

    it('channel picker: WhatsApp option asks the path question, then runs signup and appends the created card', async () => {
        mockLaunchWhatsAppSignup.mockResolvedValue({ code: 'c', phoneNumberId: 'pn_new', wabaId: 'w', coexistence: false });
        mockedApi.post.mockResolvedValue({
            data: { ...WA_ONLY_PAGE, id: 'wa_new', name: 'Second Branch', whatsappDisplayPhoneNumber: '+966 50 999 8877' },
        } as unknown as Awaited<ReturnType<typeof mockedApi.post>>);

        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Noor Store')[0]).toBeInTheDocument();
        });

        // Header "Connect channel" opens the picker
        fireEvent.click(screen.getByText('Connect channel'));
        expect(screen.getByTestId('modal')).toBeInTheDocument();
        expect(screen.getByText('Which channel do you want to connect?')).toBeInTheDocument();

        // Picking WhatsApp does NOT launch signup yet — Meta needs the onboarding
        // path at popup launch, so the merchant is asked first.
        fireEvent.click(screen.getByText('WhatsApp only'));
        expect(mockLaunchWhatsAppSignup).not.toHaveBeenCalled();
        expect(screen.getByText(enPages.whatsappPathTitle)).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByText(enPages.whatsappPathDedicated));
        });

        expect(mockLaunchWhatsAppSignup).toHaveBeenCalledWith({ coexistence: false });
        expect(mockedApi.post).toHaveBeenCalledWith('/pages/connect-whatsapp', {
            code: 'c', phoneNumberId: 'pn_new', wabaId: 'w', coexistence: false,
        });
        await waitFor(() => {
            expect(screen.getAllByText('Second Branch')[0]).toBeInTheDocument();
        });
    });

    // The whole point of Coexistence: answering "I already use this number"
    // must reach Meta as the coexistence request, or the merchant's number is
    // migrated to the Cloud API and leaves their phone.
    it('channel picker: choosing "I already use this number" requests coexistence', async () => {
        mockLaunchWhatsAppSignup.mockResolvedValue({ code: 'c', phoneNumberId: 'pn_new', wabaId: 'w', coexistence: true });
        mockedApi.post.mockResolvedValue({
            data: { ...WA_ONLY_PAGE, id: 'wa_new', name: 'Second Branch' },
        } as unknown as Awaited<ReturnType<typeof mockedApi.post>>);

        renderPage(<PagesPage />);
        await waitFor(() => expect(screen.getAllByText('Noor Store')[0]).toBeInTheDocument());

        fireEvent.click(screen.getByText('Connect channel'));
        fireEvent.click(screen.getByText('WhatsApp only'));

        await act(async () => {
            fireEvent.click(screen.getByText(enPages.whatsappPathKeep));
        });

        expect(mockLaunchWhatsAppSignup).toHaveBeenCalledWith({ coexistence: true });
        // The path Meta actually took is what reaches the backend, not the request.
        expect(mockedApi.post).toHaveBeenCalledWith('/pages/connect-whatsapp', {
            code: 'c', phoneNumberId: 'pn_new', wabaId: 'w', coexistence: true,
        });
    });

    // A merchant can back out of the coexistence path INSIDE Meta's wizard. What
    // reaches the backend must be the path Meta actually took, because it decides
    // whether the number is registered against the Cloud API — send the requested
    // value instead and a migrated number silently never gets registered.
    it('sends the path Meta took, not the one the merchant asked for', async () => {
        mockLaunchWhatsAppSignup.mockResolvedValue({ code: 'c', phoneNumberId: 'pn_new', wabaId: 'w', coexistence: false });
        mockedApi.post.mockResolvedValue({
            data: { ...WA_ONLY_PAGE, id: 'wa_new', name: 'Second Branch' },
        } as unknown as Awaited<ReturnType<typeof mockedApi.post>>);

        renderPage(<PagesPage />);
        await waitFor(() => expect(screen.getAllByText('Noor Store')[0]).toBeInTheDocument());

        fireEvent.click(screen.getByText('Connect channel'));
        fireEvent.click(screen.getByText('WhatsApp only'));

        await act(async () => {
            // Merchant asks to keep the number...
            fireEvent.click(screen.getByText(enPages.whatsappPathKeep));
        });

        expect(mockLaunchWhatsAppSignup).toHaveBeenCalledWith({ coexistence: true });
        // ...but Meta migrated it, and that is what the backend is told.
        expect(mockedApi.post).toHaveBeenCalledWith('/pages/connect-whatsapp', {
            code: 'c', phoneNumberId: 'pn_new', wabaId: 'w', coexistence: false,
        });
    });

    it('dismissing the path question connects nothing', async () => {
        renderPage(<PagesPage />);
        await waitFor(() => expect(screen.getAllByText('Noor Store')[0]).toBeInTheDocument());

        fireEvent.click(screen.getByText('Connect channel'));
        fireEvent.click(screen.getByText('WhatsApp only'));
        expect(screen.getByText(enPages.whatsappPathTitle)).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByTestId('modal-close'));
        });

        expect(mockLaunchWhatsAppSignup).not.toHaveBeenCalled();
        expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it('channel picker: Facebook option opens the FB connect dialog', async () => {
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Noor Store')[0]).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Connect channel'));
        fireEvent.click(screen.getByText('Facebook Page'));

        expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();
        expect(screen.getByText('Connect a Page')).toBeInTheDocument();
        expect(mockLaunchWhatsAppSignup).not.toHaveBeenCalled();
    });

    it('without Embedded Signup config the header button skips the picker (FB dialog directly)', async () => {
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', '');
        // Pin the redirect-flow flag OFF for the legacy-flow suites — the release
        // script exports it in the shell, and inheriting it flips these tests'
        // entire code path (the aeb8c0a5 lesson, third flag edition). The
        // redirect-flow tests stub it 'true' explicitly per test.
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT', '');
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Noor Store')[0]).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Connect New Page'));
        expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
        expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();
    });
});

describe('PagesPage - WhatsApp plan gate (Business+ entitlement)', () => {
    const UNCONNECTED_WA_PAGE = {
        id: 'page_wa',
        facebookPageId: 'fb_789',
        name: 'WA Page',
        autoReplyEnabled: false,
        instagramAutoReplyEnabled: false,
        commentsCount: 0,
        knowledgeBase: 'We sell things.',
        isConnected: true,
        whatsappConnected: false,
        whatsappPhoneNumberId: null,
        whatsappDisplayPhoneNumber: null,
        whatsappAutoReplyEnabled: false,
    };

    beforeEach(() => {
        mockToastError.mockClear();
        vi.stubEnv('NEXT_PUBLIC_FB_APP_ID', '123');
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', 'cfg-1');
        // Pin the redirect-flow flag OFF for the legacy-flow suites — the release
        // script exports it in the shell, and inheriting it flips these tests'
        // entire code path (the aeb8c0a5 lesson, third flag edition). The
        // redirect-flow tests stub it 'true' explicitly per test.
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT', '');
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [UNCONNECTED_WA_PAGE] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);
        mockedApi.patch.mockResolvedValue({ data: {} } as unknown as Awaited<ReturnType<typeof mockedApi.patch>>);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it('non-entitled plan: upgrade CTA replaces the Connect button', async () => {
        mockUsagePlan(false);
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('WA Page')[0]).toBeInTheDocument();
        });

        await waitFor(() => {
            expect(screen.getByTestId('upgrade-cta')).toBeInTheDocument();
        });
        expect(screen.getByText('Upgrade to connect')).toBeInTheDocument();
        expect(screen.queryByText('Connect', { selector: 'button' })).not.toBeInTheDocument();
    });

    it('non-entitled plan: header connect skips the picker and opens the FB dialog', async () => {
        mockUsagePlan(false);
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('WA Page')[0]).toBeInTheDocument();
        });
        // Let the entitlement query settle so the picker decision is plan-aware
        await waitFor(() => {
            expect(screen.getByTestId('upgrade-cta')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Connect channel'));
        expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
        expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();
        expect(mockLaunchWhatsAppSignup).not.toHaveBeenCalled();
    });

    it('entitled plan: Connect button renders as before', async () => {
        mockUsagePlan(true);
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('WA Page')[0]).toBeInTheDocument();
        });

        await waitFor(() => {
            expect(screen.getByText('Connect', { selector: 'button' })).toBeInTheDocument();
        });
        expect(screen.queryByTestId('upgrade-cta')).not.toBeInTheDocument();
    });

    it('toggle ON rejected with 403 WHATSAPP_PLAN_REQUIRED shows the plan toast and rolls back', async () => {
        // Entitlement can go stale (e.g. downgrade in another tab) — the
        // backend gate is authoritative and the client maps its error code.
        mockUsagePlan(true);
        mockedPagesApi.getAll.mockResolvedValue({
            data: {
                data: [{
                    ...UNCONNECTED_WA_PAGE,
                    whatsappConnected: true,
                    whatsappPhoneNumberId: 'pn_1',
                    whatsappDisplayPhoneNumber: '+966 55 000 0000',
                }],
            },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);
        mockedApi.patch.mockRejectedValue({
            response: {
                status: 403,
                data: { code: 'WHATSAPP_PLAN_REQUIRED', error: 'WhatsApp requires the Business plan or higher.' },
            },
        });

        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('WA Page')[0]).toBeInTheDocument();
        });

        // Switches on the card: [0] Facebook, [1] WhatsApp — both OFF
        const allSwitches = screen.getAllByRole('switch');
        await act(async () => {
            fireEvent.click(allSwitches[1]); // WhatsApp toggle OFF -> ON
        });
        // Page has no Business Info → the D-025 soft gate confirms first; proceed to the API.
        await act(async () => {
            fireEvent.click(screen.getByText('Turn on anyway'));
        });

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalledWith(enPages.whatsappPlanRequired);
        });
        // Optimistic update rolled back
        expect(screen.getAllByRole('switch')[1].getAttribute('aria-checked')).toBe('false');
    });
});

describe('PagesPage - WhatsApp master switch OFF (dark deploy)', () => {
    // Flag off: the page must look exactly like the pre-WhatsApp product for a
    // normal Facebook page — no WhatsApp row, legacy "My Pages" title, no picker.
    const FB_PAGE = {
        id: 'page_fb',
        facebookPageId: 'fb_1',
        name: 'Falafel House',
        autoReplyEnabled: true,
        instagramAutoReplyEnabled: false,
        instagramUsername: 'falafel',
        commentsCount: 5,
        knowledgeBase: 'We sell falafel.',
        isConnected: true,
        whatsappConnected: false,
    };

    beforeEach(() => {
        mockToastError.mockClear();
        vi.stubEnv('NEXT_PUBLIC_FB_APP_ID', '');
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', '');
        // Pin the redirect-flow flag OFF for the legacy-flow suites — the release
        // script exports it in the shell, and inheriting it flips these tests'
        // entire code path (the aeb8c0a5 lesson, third flag edition). The
        // redirect-flow tests stub it 'true' explicitly per test.
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT', '');
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [FB_PAGE] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it('hides the WhatsApp row on a Facebook page and keeps the legacy title', async () => {
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Falafel House')[0]).toBeInTheDocument();
        });

        // No WhatsApp surface at all
        expect(screen.queryByText('WhatsApp')).not.toBeInTheDocument();
        expect(screen.queryByText('WhatsApp not connected')).not.toBeInTheDocument();
        // Legacy title, not "Channels"
        expect(screen.getByText('My Pages')).toBeInTheDocument();
        expect(screen.queryByText('Channels')).not.toBeInTheDocument();
        // Facebook row still present (unchanged experience)
        expect(screen.getByText('Facebook')).toBeInTheDocument();
    });

    it('still shows the WhatsApp row for an already-connected number even when the flag is off', async () => {
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [{ ...FB_PAGE, whatsappConnected: true, whatsappDisplayPhoneNumber: '+966 55 000 0000', whatsappAutoReplyEnabled: true }] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);

        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Falafel House')[0]).toBeInTheDocument();
        });

        // The whatsappConnected OR keeps a live number visible regardless of the flag
        expect(screen.getByText('+966 55 000 0000')).toBeInTheDocument();
    });

    /**
     * The beta chip is a deliberate expectation-setter on the newest channel —
     * it must ride along with the WhatsApp row wherever that row appears, so a
     * merchant never meets WhatsApp without seeing that it is still in beta.
     */
    it('labels the WhatsApp row as beta', async () => {
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [{ ...FB_PAGE, whatsappConnected: true, whatsappDisplayPhoneNumber: '+966 55 000 0000', whatsappAutoReplyEnabled: true }] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);

        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Falafel House')[0]).toBeInTheDocument();
        });

        expect(screen.getByText(enPages.whatsappBeta)).toBeInTheDocument();
    });
});

describe('PagesPage - Enable-without-info soft gate (all merchants, D-025)', () => {
    // page_2 in MOCK_PAGES = connected FB page, empty KB, no store, FB toggle OFF
    // → needsBusinessInfo(page_2) is true, so enabling should confirm first — for
    // every merchant now (the isAdmin canary was removed when new signups moved to
    // auto-reply OFF by default).
    beforeEach(() => {
        mockToastError.mockClear();
        mockIsAdmin = false;

        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: MOCK_PAGES },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);
        mockedPagesApi.toggle.mockResolvedValue({ data: {} } as unknown as Awaited<ReturnType<typeof mockedPagesApi.toggle>>);
        mockedApi.patch.mockResolvedValue({ data: {} } as unknown as Awaited<ReturnType<typeof mockedApi.patch>>);
    });

    afterEach(() => {
        mockIsAdmin = false;
        vi.clearAllMocks();
    });

    const clickPage2FacebookToggle = async () => {
        renderPage(<PagesPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Second Page')[0]).toBeInTheDocument();
        });
        const allSwitches = screen.getAllByRole('switch');
        await act(async () => {
            fireEvent.click(allSwitches[2]); // page_2 FB toggle (OFF -> ON)
        });
    };

    it('confirms before enabling on a page with no answer source', async () => {
        await clickPage2FacebookToggle();

        expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();
        expect(screen.getByText('Turn on auto-reply without Business Info?')).toBeInTheDocument();
        // Nothing toggled yet — the confirmation intercepted the enable
        expect(mockedPagesApi.toggle).not.toHaveBeenCalled();
    });

    it('"Turn on anyway" proceeds with the original toggle', async () => {
        await clickPage2FacebookToggle();

        await act(async () => {
            fireEvent.click(screen.getByText('Turn on anyway'));
        });

        expect(mockedPagesApi.toggle).toHaveBeenCalledWith('page_2', true);
    });

    it('cancel leaves the toggle off and calls nothing', async () => {
        await clickPage2FacebookToggle();

        await act(async () => {
            fireEvent.click(screen.getByText('common.cancel'));
        });

        expect(mockedPagesApi.toggle).not.toHaveBeenCalled();
        expect(screen.queryByTestId('confirmation-modal')).not.toBeInTheDocument();
    });

    it('gates non-admins too (rolled out to everyone): confirms before enabling', async () => {
        mockIsAdmin = false;
        await clickPage2FacebookToggle();

        expect(screen.getByText('Turn on auto-reply without Business Info?')).toBeInTheDocument();
        expect(mockedPagesApi.toggle).not.toHaveBeenCalled();
    });

    it('does NOT gate a store-connected page (Salla/Shopify/Zid = answer source)', async () => {
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [{ ...MOCK_PAGES[1], ecommerceStoreId: 'store_1' }] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);

        renderPage(<PagesPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Second Page')[0]).toBeInTheDocument();
        });
        const offToggle = screen.getAllByRole('switch').find(btn => btn.getAttribute('aria-checked') === 'false');
        await act(async () => {
            fireEvent.click(offToggle!);
        });

        expect(screen.queryByText('Turn on auto-reply without Business Info?')).not.toBeInTheDocument();
        expect(mockedPagesApi.toggle).toHaveBeenCalledWith('page_2', true);
    });

    it('never gates turning auto-reply OFF', async () => {
        // A KB-less page whose FB auto-reply is ON — disabling must never confirm
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [{ ...MOCK_PAGES[1], autoReplyEnabled: true }] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);

        renderPage(<PagesPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Second Page')[0]).toBeInTheDocument();
        });
        const onToggle = screen.getAllByRole('switch').find(btn => btn.getAttribute('aria-checked') === 'true');
        await act(async () => {
            fireEvent.click(onToggle!);
        });

        expect(screen.queryByText('Turn on auto-reply without Business Info?')).not.toBeInTheDocument();
        expect(mockedPagesApi.toggle).toHaveBeenCalledWith('page_2', false);
    });
});

// ── Business Info deep-links (?openKb / ?openKbActive) ───────────────────────
//
// Two intents, two params (see utils/kb.ts): openKb = needs-first (checklist /
// dashboard nudge: "add your missing info"); openKbActive = the most-active
// page (Settings board: "the info my replies use"). Plus the RQ v5 readiness
// regression: a DISABLED query reports isLoading=false, so gating on !isLoading
// consumed the param before pages ever loaded, silently swallowing the click.
describe('PagesPage — Business Info deep-links', () => {
    // page_active: most-active (auto-reply ON) with a FILLED KB (≥80 chars,
    // differs from the FB suggestion). page_dormant: needs Business Info.
    const DEEPLINK_PAGES = [
        {
            id: 'page_active',
            facebookPageId: 'fb_a',
            name: 'Active Filled Page',
            autoReplyEnabled: true,
            instagramAutoReplyEnabled: false,
            commentsCount: 10,
            lastActivity: 2000,
            knowledgeBase: 'We sell handmade abayas. Prices start at 250 SAR. Delivery across KSA within 3 days. Returns accepted within 14 days.',
            suggestedKnowledgeBase: '',
        },
        {
            id: 'page_dormant',
            facebookPageId: 'fb_b',
            name: 'Dormant Empty Page',
            autoReplyEnabled: false,
            instagramAutoReplyEnabled: false,
            commentsCount: 0,
            lastActivity: 1000,
            knowledgeBase: '',
            suggestedKnowledgeBase: '',
        },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        mockIsAuthenticated = true;
        mockRouterQuery = {};
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: DEEPLINK_PAGES },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);
        mockUsagePlan(false);
    });

    afterEach(() => {
        mockIsAuthenticated = true;
        mockRouterQuery = {};
    });

    it('?openKbActive=true routes to /business for the MOST-ACTIVE page even when another page needs info', async () => {
        mockRouterQuery = { openKbActive: 'true' };
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(mockRouterPush).toHaveBeenCalledWith('/business?page=page_active');
        });
        expect(mockRouterReplace).toHaveBeenCalledTimes(1);
    });

    it('?openKb=true keeps needs-first: routes to /business for the page missing Business Info', async () => {
        // The structured /business page is the canonical Business Info surface
        // for ALL merchants (GA 2026-08-15) — every entry point funnels through
        // openKbEditorFor and lands on /business with the target preselected.
        mockRouterQuery = { openKb: 'true' };
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(mockRouterPush).toHaveBeenCalledWith('/business?page=page_dormant');
        });
    });

    it('REGRESSION (RQ v5): a disabled pages query must NOT consume the param', async () => {
        // Pre-auth-hydration: query disabled → isLoading=false BUT isFetched=false.
        // Gating readiness on !isLoading fired here, consuming ?openKbActive with
        // zero pages — the merchant's click evaporated.
        mockIsAuthenticated = false;
        mockRouterQuery = { openKbActive: 'true' };
        const { rerender } = renderPage(<PagesPage />);

        await act(async () => { /* flush effects */ });
        expect(mockRouterReplace).not.toHaveBeenCalled();
        expect(mockRouterPush).not.toHaveBeenCalledWith(expect.stringContaining('/business'));

        // Auth hydrates → query runs → the SAME un-consumed param now routes to /business.
        mockIsAuthenticated = true;
        rerender(<PagesPage />);
        await waitFor(() => {
            expect(mockRouterPush).toHaveBeenCalledWith('/business?page=page_active');
        });
        expect(mockRouterReplace).toHaveBeenCalledTimes(1);
    });

    it('zero pages: consumes the param without navigating (no delayed pop)', async () => {
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);
        mockRouterQuery = { openKbActive: 'true' };
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(mockRouterReplace).toHaveBeenCalledTimes(1);
        });
        expect(mockRouterPush).not.toHaveBeenCalledWith(expect.stringContaining('/business'));
    });
});

// The archive (soft-hide) affordance on a DISCONNECTED Facebook card. Agencies
// rotate pages and the dead cards used to pile up with no merchant-facing remedy
// (hard delete is admin/GDPR only). Archiving hides the card; the row and its
// data survive and come back when the page is reconnected.
describe('PagesPage - archiving a disconnected page', () => {
    const DISCONNECTED_PAGE = {
        id: 'page_dead',
        facebookPageId: 'fb_dead',
        name: 'Dima Handmade',
        autoReplyEnabled: false,
        instagramAutoReplyEnabled: false,
        commentsCount: 0,
        knowledgeBase: '',
        isConnected: false,
        whatsappConnected: false,
    };

    beforeEach(() => {
        mockIsAdmin = false;
        mockWorkspaceRole = null; // → hook default 'owner' → canEdit
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [DISCONNECTED_PAGE] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);
    });

    afterEach(() => {
        mockWorkspaceRole = null;
        vi.clearAllMocks();
    });

    it('offers the archive action on the reconnect banner', async () => {
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Dima Handmade')[0]).toBeInTheDocument();
        });

        // Reconnect stays the primary call to action
        expect(screen.getByText(enPages.reconnectRequired)).toBeInTheDocument();
        expect(screen.getByText(enPages.archiveAction)).toBeInTheDocument();
    });

    it('confirms, calls the archive endpoint, and drops the card', async () => {
        const { toast } = await import('sonner');
        mockedPagesApi.archive.mockResolvedValue({ data: {} } as unknown as Awaited<ReturnType<typeof mockedPagesApi.archive>>);

        renderPage(<PagesPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Dima Handmade')[0]).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText(enPages.archiveAction));
        expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();
        expect(screen.getByText(enPages.archiveTitle)).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByText(enPages.archiveConfirm, { selector: 'button' }));
        });

        expect(mockedPagesApi.archive).toHaveBeenCalledWith('page_dead');
        await waitFor(() => {
            expect(screen.queryByText('Dima Handmade')).not.toBeInTheDocument();
        });
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith(enPages.archiveSuccess);
    });

    it('keeps the card and warns when the request fails', async () => {
        mockedPagesApi.archive.mockRejectedValue(new Error('boom'));

        renderPage(<PagesPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Dima Handmade')[0]).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText(enPages.archiveAction));
        await act(async () => {
            fireEvent.click(screen.getByText(enPages.archiveConfirm, { selector: 'button' }));
        });

        expect(mockToastError).toHaveBeenCalled();
        expect(screen.getAllByText('Dima Handmade')[0]).toBeInTheDocument();
    });

    it('hides the action when WhatsApp is still live on the card', async () => {
        // Same reconnect banner, but archiving would bury a working channel
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [{ ...DISCONNECTED_PAGE, whatsappConnected: true, whatsappDisplayPhoneNumber: '+966 50 111 2233' }] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);

        renderPage(<PagesPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Dima Handmade')[0]).toBeInTheDocument();
        });

        expect(screen.getByText(enPages.reconnectRequired)).toBeInTheDocument();
        expect(screen.queryByText(enPages.archiveAction)).not.toBeInTheDocument();
    });

    it('hides the action from members (the route is admin+ only)', async () => {
        mockWorkspaceRole = 'member';

        renderPage(<PagesPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Dima Handmade')[0]).toBeInTheDocument();
        });

        expect(screen.queryByText(enPages.archiveAction)).not.toBeInTheDocument();
    });
});

/**
 * Instagram-direct cards (Instagram Login — no Facebook Page behind the row).
 *
 * This block exists because PR #772 shipped the backend for this channel while
 * the card still keyed pageless rows on ONE predicate (`!facebookPageId`), so an
 * Instagram-direct connect rendered a green WhatsApp card whose Instagram toggle
 * — the only switch that governs the channel — was hidden (review H3). The
 * feature was unusable from the UI with every backend gate correct.
 *
 * Mirrors the WhatsApp-only block above, which is the working precedent.
 */
describe('PagesPage - Instagram-direct cards', () => {
    const IG_ONLY_PAGE = {
        id: 'ig_only_1',
        facebookPageId: null,
        name: 'Sweets by Oum Anas',
        autoReplyEnabled: false,
        instagramAutoReplyEnabled: false,
        whatsappAutoReplyEnabled: false,
        commentsCount: 0,
        knowledgeBase: 'We sell homemade sweets.',
        isConnected: true,
        // IDENTITY vs LIVENESS, exactly as serializePage ships them: the card
        // keys its Instagram identity on `instagramDirect` (true even after the
        // sweep clears a dead credential to ''), while `instagramDirectConnected`
        // and `isConnected` carry liveness and die together. Fixtures here must
        // stay serializer-POSSIBLE — a hand-mixed state the serializer cannot
        // emit turns these tests vacuous (PR #772 re-review, Medium).
        instagramDirect: true,
        instagramDirectConnected: true,
        instagramAccountId: '17841400000000',
        instagramUsername: 'sweets.by.oum.anas',
    };

    beforeEach(() => {
        mockToastError.mockClear();
        vi.stubEnv('NEXT_PUBLIC_FB_APP_ID', '123');
        // WhatsApp fully visible on purpose: the card must stay Instagram even when
        // the WhatsApp surface is switched on, or the assertion proves nothing.
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', 'cfg-1');
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT', '');
        mockUsagePlan(true);
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [IG_ONLY_PAGE] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    // ⛔ THE H3 REGRESSION. Mutation-check: force `isInstagramOnly = false` in
    // pages.tsx and this goes red on the missing Instagram row — which is exactly
    // the shipped state the review caught.
    it('renders as an Instagram card: the Instagram toggle is reachable, no Facebook or WhatsApp rows', async () => {
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Sweets by Oum Anas')[0]).toBeInTheDocument();
        });

        // The Instagram channel row is present and carries the account handle
        expect(screen.getByText(enPages.platformInstagram)).toBeInTheDocument();
        expect(screen.getByText('@sweets.by.oum.anas')).toBeInTheDocument();

        // The toggle that governs this channel EXISTS and is the only one on the
        // card — hidden behind the WhatsApp-only branch, the channel could never
        // be enabled at all.
        const toggles = screen.getAllByRole('switch');
        expect(toggles.length).toBe(1);
        expect(screen.getByLabelText(`${enPages.autoReply} Instagram - Sweets by Oum Anas`)).toBeInTheDocument();

        // No Facebook row (no Page to answer as) and no WhatsApp affordance
        expect(screen.queryByText('Facebook')).not.toBeInTheDocument();
        expect(screen.queryByText(enPages.platformWhatsApp)).not.toBeInTheDocument();

        // Neither reconnect banner: this card is healthy
        expect(screen.queryByText(enPages.reconnectRequired)).not.toBeInTheDocument();
        expect(screen.queryByText(enPages.instagramReconnectRequired)).not.toBeInTheDocument();
    });

    // The M1 sweep clears the credential when Meta pronounces it dead (Graph 190):
    // `instagramAccessToken` becomes '' and the serializer flips BOTH liveness
    // flags false together while `instagramDirect` (identity) stays true. This
    // fixture is exactly that serializer output — the previous one hand-mixed
    // `isConnected: false` with `instagramDirectConnected: true`, a state the
    // serializer cannot emit, so it green-lit a banner that was dead code in
    // production (PR #772 re-review, High + Medium). The merchant must be told
    // to re-run Instagram Login — NOT to "reconnect via Facebook".
    // Mutation-checked: keying isInstagramOnly on `instagramDirectConnected`
    // again fails all three assertions below.
    it('a dead credential keeps the Instagram card and raises the INSTAGRAM reconnect banner, never the Facebook one', async () => {
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [{ ...IG_ONLY_PAGE, isConnected: false, instagramDirectConnected: false }] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);

        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Sweets by Oum Anas')[0]).toBeInTheDocument();
        });

        expect(screen.getByText(enPages.instagramReconnectRequired)).toBeInTheDocument();
        expect(screen.queryByText(enPages.reconnectRequired)).not.toBeInTheDocument();
        // The card must KEEP its Instagram identity in death — not re-render as a
        // WhatsApp-only card offering a WhatsApp connect row for an IG outage.
        expect(screen.queryByText(enPages.platformWhatsApp)).not.toBeInTheDocument();
    });

    it('removing the card confirms then deletes the page row', async () => {
        mockedApi.delete.mockResolvedValue({ data: { success: true } } as unknown as Awaited<ReturnType<typeof mockedApi.delete>>);

        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Sweets by Oum Anas')[0]).toBeInTheDocument();
        });

        fireEvent.click(screen.getByLabelText(`${enPages.instagramOnlyRemoveTitle} - Sweets by Oum Anas`));
        expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();
        expect(screen.getByText(enPages.instagramOnlyRemoveTitle)).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByText(enPages.instagramOnlyRemoveConfirm, { selector: 'button' }));
        });

        expect(mockedApi.delete).toHaveBeenCalledWith('/pages/ig_only_1');
        await waitFor(() => {
            expect(screen.queryByText('Sweets by Oum Anas')).not.toBeInTheDocument();
        });
    });
});

describe('PagesPage - Instagram-only demand signal', () => {
    beforeEach(() => {
        mockedPagesApi.getAll.mockResolvedValue({
            data: { data: [] },
        } as unknown as Awaited<ReturnType<typeof mockedPagesApi.getAll>>);
        mockUsagePlan(false);
        // The empty list auto-fires /pages/sync; the interest click shares api.post.
        mockedApi.post.mockResolvedValue({ data: {} } as unknown as Awaited<ReturnType<typeof mockedApi.post>>);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('shows the interest CTA in the empty state and records the click', async () => {
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getByText(enPages.igOnlyPrompt)).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText(enPages.igOnlyCta));

        await waitFor(() => {
            expect(mockedApi.post).toHaveBeenCalledWith('/pages/instagram-direct-interest');
        });
        expect(screen.getByText(enPages.igOnlyThanks)).toBeInTheDocument();
        expect(screen.queryByText(enPages.igOnlyCta)).not.toBeInTheDocument();
    });

    // Two eras, one button: once Instagram-direct is LIT (flag on), asking an
    // owner to "register interest" in a feature one click away would be absurd —
    // the same CTA starts the real Instagram Login connect instead. The dark-era
    // test above keeps pinning the interest path (flag unset there).
    // Mutation-checked: reverting the onClick to handleIgDirectInterest
    // unconditionally fails this.
    it('when the flag is on, an owner click starts the REAL Instagram connect instead of recording interest', async () => {
        vi.stubEnv('NEXT_PUBLIC_INSTAGRAM_DIRECT_ENABLED', 'true');
        const originalLocation = window.location;
        const assign = vi.fn();
        Object.defineProperty(window, 'location', {
            value: { ...originalLocation, assign }, writable: true, configurable: true,
        });
        try {
            mockedApi.post.mockResolvedValue({
                data: { url: 'https://www.instagram.com/oauth/authorize?client_id=x' },
            } as unknown as Awaited<ReturnType<typeof mockedApi.post>>);

            renderPage(<PagesPage />);
            await waitFor(() => {
                expect(screen.getByText(enPages.igOnlyCta)).toBeInTheDocument();
            });

            fireEvent.click(screen.getByText(enPages.igOnlyCta));

            await waitFor(() => {
                expect(mockedApi.post).toHaveBeenCalledWith('/auth/instagram/start', expect.anything());
            });
            expect(assign).toHaveBeenCalledWith('https://www.instagram.com/oauth/authorize?client_id=x');
            expect(mockedApi.post).not.toHaveBeenCalledWith('/pages/instagram-direct-interest');
        } finally {
            Object.defineProperty(window, 'location', {
                value: originalLocation, writable: true, configurable: true,
            });
            vi.unstubAllEnvs();
        }
    });
});
