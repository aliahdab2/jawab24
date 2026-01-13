import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PagesPage from '@/pages/pages';
import axios from 'axios';

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

// Mock Capacitor Core
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn().mockReturnValue(false),
    getPlatform: vi.fn().mockReturnValue('web'),
  },
}));

// Mock Facebook Login Plugin
vi.mock('@capacitor-community/facebook-login', () => ({
  FacebookLogin: {
    initialize: vi.fn().mockResolvedValue(undefined),
    login: vi.fn().mockResolvedValue({ accessToken: { token: 'new-fb-token' } }),
    logout: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock Store
vi.mock('@/lib/store', () => ({
  useAuthStore: vi.fn((selector) => {
    const store = {
      token: 'test-jwt-token',
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

// Mock sonner - must be inline to avoid hoisting issues
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('PagesPage', () => {
  let originalOpen: typeof window.open;
  let mockToast: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    originalOpen = window.open;
    window.open = vi.fn();

    // Get the mocked toast
    const { toast } = await import('sonner');
    mockToast = toast as typeof mockToast;

    // Default: return empty pages
    mockedAxios.get.mockResolvedValue({ data: [] });
    mockedAxios.post.mockResolvedValue({ data: { success: true } });
  });

  afterEach(() => {
    window.open = originalOpen;
  });

  describe('Empty State', () => {
    it('should show empty state title when no pages', async () => {
      render(<PagesPage />);

      await waitFor(() => {
        expect(screen.getByText('pages.noPages')).toBeInTheDocument();
      });
    });

    it('should show reconnect and create buttons in empty state', async () => {
      render(<PagesPage />);

      await waitFor(() => {
        // Use getAllByText since both empty state and modal may have these buttons
        const reconnectButtons = screen.getAllByText('pages.reconnectFacebook');
        expect(reconnectButtons.length).toBeGreaterThanOrEqual(1);

        const createButtons = screen.getAllByText('pages.createPage');
        expect(createButtons.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should open Facebook page creation in new tab when Create Page clicked', async () => {
      render(<PagesPage />);

      await waitFor(() => {
        expect(screen.getAllByText('pages.createPage').length).toBeGreaterThanOrEqual(1);
      });

      // Click the first "Create Page" button found
      const createButtons = screen.getAllByText('pages.createPage');
      fireEvent.click(createButtons[0]);

      expect(window.open).toHaveBeenCalledWith(
        'https://www.facebook.com/pages/create',
        '_blank'
      );
      expect(mockToast.info).toHaveBeenCalledWith('pages.openingFacebook');
    });
  });

  describe('Connection Modal', () => {
    it('should show connection modal title after sync attempt with no pages', async () => {
      mockedAxios.get.mockResolvedValue({ data: [] });
      mockedAxios.post.mockResolvedValue({ data: { success: true } });

      render(<PagesPage />);

      // Wait for the modal title to appear
      await waitFor(
        () => {
          expect(screen.getByText('pages.noPagesFoundTitle')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('should have a close button on the modal', async () => {
      mockedAxios.get.mockResolvedValue({ data: [] });

      render(<PagesPage />);

      await waitFor(() => {
        expect(screen.getByText('pages.noPagesFoundTitle')).toBeInTheDocument();
      });

      // Close button should exist
      const closeButton = screen.getByLabelText('Close');
      expect(closeButton).toBeInTheDocument();
    });

    it('should display modal description and reasons', async () => {
      mockedAxios.get.mockResolvedValue({ data: [] });

      render(<PagesPage />);

      await waitFor(() => {
        expect(screen.getByText('pages.noPagesFoundDesc')).toBeInTheDocument();
        expect(screen.getByText('pages.noPagesReasons')).toBeInTheDocument();
      });
    });
  });

  describe('Sync Error Handling', () => {
    it('should show toast when sync fails', async () => {
      mockedAxios.get.mockResolvedValue({ data: [] });
      mockedAxios.post.mockRejectedValue(new Error('Sync failed'));

      render(<PagesPage />);

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('pages.sessionExpired');
      });
    });
  });

  describe('Pages Display', () => {
    it('should display pages when available', async () => {
      mockedAxios.get.mockResolvedValue({
        data: [
          {
            id: 'page-1',
            name: 'Test Page',
            category: 'Business',
            autoReplyEnabled: true,
            accessToken: 'token',
          },
        ],
      });

      render(<PagesPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Page')).toBeInTheDocument();
      });

      // Empty state should NOT be shown
      expect(screen.queryByText('pages.noPages')).not.toBeInTheDocument();
    });
  });
});
