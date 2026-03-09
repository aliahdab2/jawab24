import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { useRouter } from 'next/router';
import AuthCallback from '@/pages/auth/callback';
import { useAuthStore, useUIStore } from '@/lib/store';

// Mock modules
vi.mock('next/router', () => ({ useRouter: vi.fn() }));

vi.mock('@/lib/store', () => ({
  useAuthStore: vi.fn(() => ({ setAuth: vi.fn() })),
  useUIStore: {
    getState: vi.fn(() => ({ setLanguage: vi.fn() })),
  },
}));

vi.mock('@/constants/auth', () => ({
  FB_CALLBACK_PATH: '/auth/callback',
}));

vi.mock('@/components/ui', () => ({
  AppSkeleton: ({ variant }: { variant: string }) => (
    <div data-testid="app-skeleton" className="animate-pulse">{variant}</div>
  ),
}));

vi.mock('@/lib/capacitor', () => ({
  isNativePlatform: vi.fn(() => false),
}));

vi.mock('@/lib/sentryHelpers', () => ({
  captureError: vi.fn(),
}));

describe('AuthCallback - edge cases', () => {
  let mockPush: ReturnType<typeof vi.fn>;
  let mockSetAuth: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPush = vi.fn();
    mockSetAuth = vi.fn();

    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: {},
      isReady: true,
      push: mockPush,
      pathname: '/auth/callback',
      asPath: '/auth/callback',
    });

    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      setAuth: mockSetAuth,
    });

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Helper: standard success response
  const successResponse = (overrides = {}) => ({
    ok: true,
    json: async () => ({
      user: { id: '1', name: 'Test', email: 'test@test.com', facebookId: 'fb1' },
      token: 'jwt-token',
      fbAccessToken: 'fb-token',
      ...overrides,
    }),
  });

  // ─── Facebook error parameter ────────────────────────────
  it('should show error and redirect when Facebook returns an error', async () => {
    vi.useFakeTimers();

    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: { error: 'access_denied', state: '/dashboard|web|ar' },
      isReady: true,
      push: mockPush,
    });

    render(<AuthCallback />);

    expect(screen.getByText('Login was cancelled')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    // Should redirect after 3 seconds
    vi.advanceTimersByTime(3000);
    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  // ─── Duplicate prevention ────────────────────────────────
  it('should prevent duplicate auth attempts on re-render', async () => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: { code: 'test-code-123' },
      isReady: true,
      push: mockPush,
    });

    fetchMock.mockResolvedValue(successResponse());

    await act(async () => {
      const { rerender } = render(<AuthCallback />);
      rerender(<AuthCallback />);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ─── Code exchange timeout ───────────────────────────────
  it('should timeout code exchange after 15 seconds', async () => {
    vi.useFakeTimers();

    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: { code: 'slow-code' },
      isReady: true,
      push: mockPush,
    });

    // Fetch that never resolves
    fetchMock.mockImplementation(() => new Promise(() => {}));

    render(<AuthCallback />);

    // Advance past the 15s timeout — wrap in act() so React processes state updates
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15100);
    });

    expect(screen.getByText('Facebook is not responding. Please try again.')).toBeInTheDocument();

    // Should redirect to login after 3s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  // ─── Non-ok API response ─────────────────────────────────
  it('should display API error message from response body', async () => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: { code: 'bad-code' },
      isReady: true,
      push: mockPush,
    });

    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Invalid authorization code' }),
    });

    await act(async () => {
      render(<AuthCallback />);
    });

    await waitFor(() => {
      expect(screen.getByText('Invalid authorization code')).toBeInTheDocument();
    });
  });

  // ─── Network error ───────────────────────────────────────
  it('should handle network errors with user-friendly message', async () => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: { code: 'offline-code' },
      isReady: true,
      push: mockPush,
    });

    fetchMock.mockRejectedValue(new Error('Failed to fetch'));

    await act(async () => {
      render(<AuthCallback />);
    });

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  // ─── State parameter parsing ─────────────────────────────
  it('should parse state parameter with all fields', async () => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: {
        code: 'valid-code',
        state: encodeURIComponent('/pages|mobile|en|reconnect'),
      },
      isReady: true,
      push: mockPush,
    });

    fetchMock.mockResolvedValue(successResponse());

    await act(async () => {
      render(<AuthCallback />);
    });

    await waitFor(() => {
      // Reconnect flow: should call pages/sync
      const syncCall = fetchMock.mock.calls.find((c: string[]) =>
        c[0]?.includes('/pages/sync')
      );
      expect(syncCall).toBeDefined();
    });
  });

  // ─── Safe URL validation ─────────────────────────────────
  it('should reject non-relative URLs in state and default to /dashboard', async () => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: {
        code: 'valid-code',
        state: encodeURIComponent('https://evil.com|web|ar'),
      },
      isReady: true,
      push: mockPush,
    });

    fetchMock.mockResolvedValue(successResponse());

    await act(async () => {
      render(<AuthCallback />);
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  // ─── Missing email → complete-profile ────────────────────
  it('should redirect to complete-profile when user has no email', async () => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: { code: 'valid-code' },
      isReady: true,
      push: mockPush,
    });

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        user: { id: '1', name: 'Test', facebookId: 'fb1' }, // no email
        token: 'jwt-token',
        fbAccessToken: 'fb-token',
      }),
    });

    await act(async () => {
      render(<AuthCallback />);
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining('/complete-profile')
      );
    });
  });

  // ─── Shopify onboarding redirect ─────────────────────────
  it('should redirect to shopify onboarding when flagged', async () => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: { code: 'valid-code' },
      isReady: true,
      push: mockPush,
    });

    fetchMock.mockResolvedValue(successResponse({ shopifyOnboarding: true }));

    await act(async () => {
      render(<AuthCallback />);
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/shopify/onboarding');
    });
  });

  // ─── Success: web navigation ─────────────────────────────
  it('should navigate to safe return URL on successful login', async () => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: {
        code: 'valid-code',
        state: encodeURIComponent('/rules|web|ar'),
      },
      isReady: true,
      push: mockPush,
    });

    fetchMock.mockResolvedValue(successResponse());

    await act(async () => {
      render(<AuthCallback />);
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/rules');
    });
  });

  // ─── Language sync from user settings ────────────────────
  it('should apply language from user settings over state param', async () => {
    const mockSetLanguage = vi.fn();
    (useUIStore as unknown as Record<string, unknown>).getState = vi.fn(() => ({
      setLanguage: mockSetLanguage,
    }));

    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: { code: 'valid-code', state: encodeURIComponent('/dashboard|web|ar') },
      isReady: true,
      push: mockPush,
    });

    fetchMock.mockResolvedValue(successResponse({ settings: { dashboardLanguage: 'en' } }));

    await act(async () => {
      render(<AuthCallback />);
    });

    await waitFor(() => {
      expect(mockSetLanguage).toHaveBeenCalledWith('en');
    });
  });

  // ─── AbortError suppressed ───────────────────────────────
  it('should not show error when request is aborted (navigation)', async () => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: { code: 'valid-code' },
      isReady: true,
      push: mockPush,
    });

    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    await act(async () => {
      render(<AuthCallback />);
    });

    // Should NOT show error UI for AbortError
    expect(screen.queryByText('Login failed. Please try again.')).not.toBeInTheDocument();
    expect(screen.queryByText('Network error')).not.toBeInTheDocument();
  });
});
