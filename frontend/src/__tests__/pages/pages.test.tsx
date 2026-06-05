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
    },
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
    PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
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
