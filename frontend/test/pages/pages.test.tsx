import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PagesPage from '@/pages/pages';

// Mock @/lib/api
const mockPagesApiGetAll = vi.fn();
const mockPagesApiToggle = vi.fn();
const mockApiPost = vi.fn();
const mockApiPatch = vi.fn();
const mockApiPut = vi.fn();

vi.mock('@/lib/api', () => ({
  pagesApi: {
    getAll: () => mockPagesApiGetAll(),
    toggle: (id: string, enabled: boolean) => mockPagesApiToggle(id, enabled),
    getKbGaps: () => Promise.resolve({ data: { data: [] } }),
    dismissGap: () => Promise.resolve({ data: { success: true } }),
  },
  api: {
    post: (url: string, data: any) => mockApiPost(url, data),
    patch: (url: string, data: any) => mockApiPatch(url, data),
    put: (url: string, data: any) => mockApiPut(url, data),
  },
}));

// Mock Capacitor
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn().mockReturnValue(false),
    getPlatform: vi.fn().mockReturnValue('web'),
  },
}));

// Mock Next.js router — shared push spy so tests can assert the /business
// routing (the canonical Business Info surface for all merchants, GA 2026-08-15).
const { mockRouterPush } = vi.hoisted(() => ({ mockRouterPush: vi.fn() }));
vi.mock('next/router', () => ({
  useRouter: vi.fn(() => ({
    query: {},
    push: mockRouterPush,
    replace: vi.fn(),
    pathname: '/pages',
  })),
}));

// next-intl is mocked globally in test/setup.ts — no local @/i18n mock needed

// Mock Store
vi.mock('@/lib/store', () => ({
  useAuthStore: vi.fn((selector) => {
    const store = {
      fbToken: 'test-fb-token',
      user: { id: 'user-1' },
      setAuth: vi.fn(),
      isAuthenticated: true,
      _hasHydrated: true,
      logout: vi.fn(),
    };
    return typeof selector === 'function' ? selector(store) : store;
  }),
  useUIStore: vi.fn(() => ({
    sidebarOpen: false,
    isOnboardingVisible: false,
    setSidebarOpen: vi.fn(),
    setOnboardingVisible: vi.fn(),
  })),
}));

const createWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'TestQueryWrapper';
  return Wrapper;
};

const renderPage = (ui: React.ReactElement) => render(ui, { wrapper: createWrapper() });

describe('PagesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return empty pages
    mockPagesApiGetAll.mockResolvedValue({ data: [] });
    mockApiPost.mockResolvedValue({ data: { success: true } });
    mockPagesApiToggle.mockResolvedValue({ data: { success: true } });
    mockApiPatch.mockResolvedValue({ data: { success: true } });
    mockApiPut.mockResolvedValue({ data: { success: true } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Empty State', () => {
    it('should show empty state when no pages', async () => {
      renderPage(<PagesPage />);

      await waitFor(() => {
        expect(screen.getByText('Get started')).toBeInTheDocument();
      });
    });

    it('should show connect button in empty state', async () => {
      renderPage(<PagesPage />);

      await waitFor(() => {
        // The empty state should have a connect button
        const buttons = screen.getAllByText('Connect New Page');
        expect(buttons.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Pages Display', () => {
    it('should display pages when available', async () => {
      mockPagesApiGetAll.mockResolvedValue({
        data: [
          {
            id: 'page-1',
            name: 'Test Page',
            facebookPageId: '123',
            autoReplyEnabled: true,
            accessToken: 'token',
          },
        ],
      });

      renderPage(<PagesPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Test Page')[0]).toBeInTheDocument();
      });

      // Empty state should NOT be shown
      expect(screen.queryByText('Get started')).not.toBeInTheDocument();
    });

    it('should show Facebook badge on page cards', async () => {
      mockPagesApiGetAll.mockResolvedValue({
        data: [
          {
            id: 'page-1',
            name: 'My Business Page',
            facebookPageId: '456',
            autoReplyEnabled: false,
          },
        ],
      });

      renderPage(<PagesPage />);

      // Wait for page to load first
      await waitFor(() => {
        expect(screen.getAllByText('My Business Page')[0]).toBeInTheDocument();
      });

      // Then check for Facebook badge (there may be multiple "Facebook" texts in the UI)
      expect(screen.getAllByText('Facebook').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Connect Page Flow', () => {
    it('should show confirmation dialog when connect button is clicked', async () => {
      mockPagesApiGetAll.mockResolvedValue({ data: [] });

      renderPage(<PagesPage />);

      await waitFor(() => {
        expect(screen.getByText('Get started')).toBeInTheDocument();
      });

      // Click connect button
      const connectButtons = screen.getAllByText('Connect New Page');
      fireEvent.click(connectButtons[0]);

      // Confirmation dialog should appear
      await waitFor(() => {
        expect(screen.getByText('Connect a Page')).toBeInTheDocument();
        expect(screen.getByText(/redirected to Facebook/)).toBeInTheDocument();
        expect(screen.getByText('Continue to Facebook')).toBeInTheDocument();
      });
    });

    it('should close dialog when cancel is clicked', async () => {
      mockPagesApiGetAll.mockResolvedValue({ data: [] });

      renderPage(<PagesPage />);

      await waitFor(() => {
        expect(screen.getByText('Get started')).toBeInTheDocument();
      });

      // Open dialog
      const connectButtons = screen.getAllByText('Connect New Page');
      fireEvent.click(connectButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Connect a Page')).toBeInTheDocument();
      });

      // Click cancel
      fireEvent.click(screen.getByText('Cancel'));

      await waitFor(() => {
        expect(screen.queryByText('Connect a Page')).not.toBeInTheDocument();
      });
    });
  });

  describe('Auto-reply Toggle', () => {
    it('should toggle auto-reply when switch is clicked', async () => {
      mockPagesApiGetAll.mockResolvedValue({
        data: [
          {
            id: 'page-1',
            name: 'Test Page',
            facebookPageId: '123',
            autoReplyEnabled: false,
            // Has Business Info so the enable-without-info soft gate (D-025) doesn't
            // intercept — this test covers the basic toggle→API wiring, not the gate.
            knowledgeBase: 'We are a family-run bakery in Damascus. We sell fresh bread, cakes, and pastries daily from 8am to 8pm.',
          },
        ],
      });

      renderPage(<PagesPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Test Page')[0]).toBeInTheDocument();
      });

      // Find and click the toggle button (role="switch")
      const toggles = screen.getAllByRole('switch');
      expect(toggles.length).toBeGreaterThanOrEqual(1);

      fireEvent.click(toggles[0]);

      await waitFor(() => {
        expect(mockPagesApiToggle).toHaveBeenCalledWith('page-1', true);
      });
    });
  });

  describe('Business Info entry point', () => {
    it('routes to /business when business info is clicked (GA: the structured surface is canonical)', async () => {
      mockPagesApiGetAll.mockResolvedValue({
        data: [
          {
            id: 'page-1',
            name: 'Test Page',
            facebookPageId: '123',
            autoReplyEnabled: true,
            knowledgeBase: '',
          },
        ],
      });

      renderPage(<PagesPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Test Page')[0]).toBeInTheDocument();
      });

      // Click the "Add business info" button
      const businessInfoButton = screen.getByText('Add Your Business Info');
      fireEvent.click(businessInfoButton);

      await waitFor(() => {
        expect(mockRouterPush).toHaveBeenCalledWith('/business?page=page-1');
      });
    });
  });

  describe('Empty KB Indicator', () => {
    it('should show "Add info" chip when page has no KB and no e-commerce', async () => {
      mockPagesApiGetAll.mockResolvedValue({
        data: [
          {
            id: 'page-1',
            name: 'Test Page',
            facebookPageId: '123',
            autoReplyEnabled: true,
            knowledgeBase: null,
            ecommerceStoreId: null,
          },
        ],
      });

      renderPage(<PagesPage />);

      await waitFor(() => {
        expect(screen.getByText('Add info')).toBeInTheDocument();
      });
    });

    it('should NOT show "Add info" chip when page has KB content', async () => {
      mockPagesApiGetAll.mockResolvedValue({
        data: [
          {
            id: 'page-1',
            name: 'Test Page',
            facebookPageId: '123',
            autoReplyEnabled: true,
            knowledgeBase: 'We sell electronics and accessories.',
            ecommerceStoreId: null,
          },
        ],
      });

      renderPage(<PagesPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Test Page')[0]).toBeInTheDocument();
      });

      expect(screen.queryByText('Add info')).not.toBeInTheDocument();
    });

    it('should NOT show "Add info" chip when page has e-commerce connected', async () => {
      mockPagesApiGetAll.mockResolvedValue({
        data: [
          {
            id: 'page-1',
            name: 'Test Page',
            facebookPageId: '123',
            autoReplyEnabled: true,
            knowledgeBase: null,
            ecommerceStoreId: 'store-1',
          },
        ],
      });

      renderPage(<PagesPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Test Page')[0]).toBeInTheDocument();
      });

      expect(screen.queryByText('Add info')).not.toBeInTheDocument();
    });

    it('routes to /business when "Add info" chip is clicked', async () => {
      mockPagesApiGetAll.mockResolvedValue({
        data: [
          {
            id: 'page-1',
            name: 'Test Page',
            facebookPageId: '123',
            autoReplyEnabled: true,
            knowledgeBase: null,
            ecommerceStoreId: null,
          },
        ],
      });

      renderPage(<PagesPage />);

      await waitFor(() => {
        expect(screen.getByText('Add info')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Add info'));

      await waitFor(() => {
        expect(mockRouterPush).toHaveBeenCalledWith('/business?page=page-1');
      });
    });
  });
});
