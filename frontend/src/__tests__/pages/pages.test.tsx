import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PagesPage from '@/pages/pages';
import { pagesApi, api } from '@/lib/api';

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

vi.mock('@/lib/store', () => ({
    useAuthStore: () => ({
        isAuthenticated: true,
        fbToken: 'mock-fb-token',
    }),
    useUIStore: (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ sidebarOpen: false }),
}));

vi.mock('@/lib/api', () => ({
    pagesApi: {
        getAll: vi.fn(),
        toggle: vi.fn(),
    },
    api: {
        patch: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
    },
}));

const mockOpenExternalUrl = vi.fn();
vi.mock('@/lib/openExternalUrl', () => ({
    openExternalUrl: (...args: unknown[]) => mockOpenExternalUrl(...args),
}));

const mockLaunchWhatsAppSignup = vi.fn();
vi.mock('@/lib/whatsappSignup', () => ({
    launchWhatsAppSignup: (...args: unknown[]) => mockLaunchWhatsAppSignup(...args),
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

vi.mock('@/components/ui', () => ({
    Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
        <button onClick={onClick} disabled={disabled}>{children}</button>
    ),
    Toggle: ({ enabled, onChange }: { enabled: boolean; onChange: (val: boolean) => void }) => (
        <button role="switch" aria-checked={enabled} onClick={() => onChange(!enabled)}>{enabled ? 'ON' : 'OFF'}</button>
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
    WhatsAppIcon: () => <svg data-testid="whatsapp-icon" />,
    FacebookIcon: () => <svg data-testid="facebook-icon" />,
    Modal: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) =>
        isOpen ? (
            <div data-testid="channel-picker-modal">
                <p>{title}</p>
                {children}
            </div>
        ) : null,
}));

vi.mock('@/components/knowledge-base/KnowledgeBaseModal', () => ({
    KnowledgeBaseModal: () => null,
}));

const mockedPagesApi = vi.mocked(pagesApi);
const mockedApi = vi.mocked(api, true);

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

        await waitFor(() => {
            expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://jawab24.com/en/pages');
        });
        expect(mockLaunchWhatsAppSignup).not.toHaveBeenCalled();

        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
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

    it('channel picker: WhatsApp option runs signup and appends the created card', async () => {
        mockLaunchWhatsAppSignup.mockResolvedValue({ code: 'c', phoneNumberId: 'pn_new', wabaId: 'w' });
        mockedApi.post.mockResolvedValue({
            data: { ...WA_ONLY_PAGE, id: 'wa_new', name: 'Second Branch', whatsappDisplayPhoneNumber: '+966 50 999 8877' },
        } as unknown as Awaited<ReturnType<typeof mockedApi.post>>);

        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Noor Store')[0]).toBeInTheDocument();
        });

        // Header "Connect channel" opens the picker
        fireEvent.click(screen.getByText('Connect channel'));
        expect(screen.getByTestId('channel-picker-modal')).toBeInTheDocument();
        expect(screen.getByText('Which channel do you want to connect?')).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByText('WhatsApp only'));
        });

        expect(mockLaunchWhatsAppSignup).toHaveBeenCalled();
        expect(mockedApi.post).toHaveBeenCalledWith('/pages/connect-whatsapp', {
            code: 'c', phoneNumberId: 'pn_new', wabaId: 'w',
        });
        await waitFor(() => {
            expect(screen.getAllByText('Second Branch')[0]).toBeInTheDocument();
        });
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
        renderPage(<PagesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Noor Store')[0]).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Connect New Page'));
        expect(screen.queryByTestId('channel-picker-modal')).not.toBeInTheDocument();
        expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();
    });
});
