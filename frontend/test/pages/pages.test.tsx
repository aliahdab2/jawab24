import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

// Mock Next.js router
vi.mock('next/router', () => ({
  useRouter: vi.fn(() => ({
    query: {},
    push: vi.fn(),
    replace: vi.fn(),
    pathname: '/pages',
  })),
}));

// Mock translation hook
vi.mock('@/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    language: 'en',
    setLanguage: vi.fn(),
    isRTL: false,
  }),
}));

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
      render(<PagesPage />);

      await waitFor(() => {
        expect(screen.getByText('pages.noPages')).toBeInTheDocument();
      });
    });

    it('should show connect button in empty state', async () => {
      render(<PagesPage />);

      await waitFor(() => {
        // The empty state should have a connect button
        const buttons = screen.getAllByText('pages.connectPage');
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

      render(<PagesPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Test Page')[0]).toBeInTheDocument();
      });

      // Empty state should NOT be shown
      expect(screen.queryByText('pages.noPages')).not.toBeInTheDocument();
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

      render(<PagesPage />);

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

      render(<PagesPage />);

      await waitFor(() => {
        expect(screen.getByText('pages.noPages')).toBeInTheDocument();
      });

      // Click connect button
      const connectButtons = screen.getAllByText('pages.connectPage');
      fireEvent.click(connectButtons[0]);

      // Confirmation dialog should appear
      await waitFor(() => {
        expect(screen.getByText('pages.connectDialogTitle')).toBeInTheDocument();
        expect(screen.getByText('pages.connectDialogBody')).toBeInTheDocument();
        expect(screen.getByText('pages.continueToFacebook')).toBeInTheDocument();
      });
    });

    it('should close dialog when cancel is clicked', async () => {
      mockPagesApiGetAll.mockResolvedValue({ data: [] });

      render(<PagesPage />);

      await waitFor(() => {
        expect(screen.getByText('pages.noPages')).toBeInTheDocument();
      });

      // Open dialog
      const connectButtons = screen.getAllByText('pages.connectPage');
      fireEvent.click(connectButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('pages.connectDialogTitle')).toBeInTheDocument();
      });

      // Click cancel
      fireEvent.click(screen.getByText('common.cancel'));

      await waitFor(() => {
        expect(screen.queryByText('pages.connectDialogTitle')).not.toBeInTheDocument();
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
          },
        ],
      });

      render(<PagesPage />);

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

  describe('Knowledge Base Modal', () => {
    it('should open knowledge base modal when business info is clicked', async () => {
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

      render(<PagesPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Test Page')[0]).toBeInTheDocument();
      });

      // Click the "Add business info" button
      const businessInfoButton = screen.getByText('pages.addBusinessInfo');
      fireEvent.click(businessInfoButton);

      // Modal should be open
      await waitFor(() => {
        expect(screen.getByText('kb.title')).toBeInTheDocument();
      });
    });
  });
});
