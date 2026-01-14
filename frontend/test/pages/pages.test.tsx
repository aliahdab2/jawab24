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

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('PagesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return empty pages
    mockedAxios.get.mockResolvedValue({ data: [] });
    mockedAxios.post.mockResolvedValue({ data: { success: true } });
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
      mockedAxios.get.mockResolvedValue({
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
        expect(screen.getByText('Test Page')).toBeInTheDocument();
      });

      // Empty state should NOT be shown
      expect(screen.queryByText('pages.noPages')).not.toBeInTheDocument();
    });

    it('should show Facebook badge on page cards', async () => {
      mockedAxios.get.mockResolvedValue({
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
        expect(screen.getByText('My Business Page')).toBeInTheDocument();
      });

      // Then check for Facebook badge (there may be multiple "Facebook" texts in the UI)
      expect(screen.getAllByText('Facebook').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Sync Functionality', () => {
    it('should call sync API when connect button is clicked', async () => {
      mockedAxios.get.mockResolvedValue({ data: [] });
      mockedAxios.post.mockResolvedValue({ data: { success: true } });

      render(<PagesPage />);

      await waitFor(() => {
        expect(screen.getByText('pages.noPages')).toBeInTheDocument();
      });

      // Click connect button in header or empty state
      const connectButtons = screen.getAllByText('pages.connectPage');
      fireEvent.click(connectButtons[0]);

      await waitFor(() => {
        expect(mockedAxios.post).toHaveBeenCalledWith(
          expect.stringContaining('/pages/sync'),
          expect.objectContaining({ accessToken: 'test-fb-token' }),
          expect.any(Object)
        );
      });
    });
  });

  describe('Auto-reply Toggle', () => {
    it('should toggle auto-reply when switch is clicked', async () => {
      mockedAxios.get.mockResolvedValue({
        data: [
          {
            id: 'page-1',
            name: 'Test Page',
            facebookPageId: '123',
            autoReplyEnabled: false,
          },
        ],
      });
      mockedAxios.patch.mockResolvedValue({ data: { success: true } });

      render(<PagesPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Page')).toBeInTheDocument();
      });

      // Find and click the toggle button (role="switch")
      const toggles = screen.getAllByRole('switch');
      expect(toggles.length).toBeGreaterThanOrEqual(1);
      
      fireEvent.click(toggles[0]);

      await waitFor(() => {
        expect(mockedAxios.patch).toHaveBeenCalledWith(
          expect.stringContaining('/pages/page-1/auto-reply'),
          expect.objectContaining({ enabled: true }),
          expect.any(Object)
        );
      });
    });
  });

  describe('Knowledge Base Modal', () => {
    it('should open knowledge base modal when business info is clicked', async () => {
      mockedAxios.get.mockResolvedValue({
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
        expect(screen.getByText('Test Page')).toBeInTheDocument();
      });

      // Click the "Add business info" button
      const businessInfoButton = screen.getByText('pages.addBusinessInfo');
      fireEvent.click(businessInfoButton);

      // Modal should be open
      await waitFor(() => {
        expect(screen.getByText('pages.businessInfo')).toBeInTheDocument();
      });
    });
  });
});
