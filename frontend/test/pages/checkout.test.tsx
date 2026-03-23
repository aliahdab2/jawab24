import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useRouter } from 'next/router';
import CheckoutPage from '@/pages/checkout';
import { useAuthStore } from '@/lib/store';

// Mock modules
vi.mock('next/router', () => ({ useRouter: vi.fn() }));
vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: vi.fn(() => ({ isAuthenticated: true })),
}));

vi.mock('@/constants/brand', () => ({
  BRAND_ASSETS: { meta: { appName: 'Jawab24' } },
}));

vi.mock('@/components/ui', () => ({
  Button: ({ children, disabled, onClick, ...props }: any) => (
    <button disabled={disabled} onClick={onClick} {...props}>{children}</button>
  ),
  BrandLogo: () => <span>Logo</span>,
}));

vi.mock('@/components/PaymentsUnavailableNotice', () => ({
  PaymentsUnavailableNotice: () => <div data-testid="sanctions-notice">Payments unavailable</div>,
}));

vi.mock('@/lib/sentryHelpers', () => ({
  captureError: vi.fn(),
}));

// These are the key mocks we control per-test
const mockGeoCheck = vi.fn();
vi.mock('@/utils/geoCheck', () => ({
  isUserSanctioned: () => mockGeoCheck(),
}));

const mockApiPost = vi.fn();
const mockPublicApiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { post: (...args: unknown[]) => mockApiPost(...args) },
  publicApi: { get: (...args: unknown[]) => mockPublicApiGet(...args) },
}));

describe('CheckoutPage', () => {
  let mockPush: ReturnType<typeof vi.fn>;

  const mockPlan = {
    id: 'plan-1',
    name: 'Business',
    slug: 'business',
    description: 'For growing businesses',
    price: 1500,
    maxPages: 5,
    maxAiRepliesPerMonth: 1000,
    trialDays: 7,
  };

  beforeEach(() => {
    // Disable maintenance mode for checkout tests
    process.env.NEXT_PUBLIC_CHECKOUT_MAINTENANCE = 'false';
    mockPush = vi.fn();

    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: { planId: 'plan-1' },
      push: mockPush,
      pathname: '/checkout',
    });

    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isAuthenticated: true,
    });

    // Default: not sanctioned
    mockGeoCheck.mockResolvedValue(false);

    // Default: plan loads OK
    mockPublicApiGet.mockResolvedValue({
      data: { data: mockPlan },
    });

    mockApiPost.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Sanctions: geo check ────────────────────────────────
  it('should show loader while geo check is in progress', () => {
    // Geo check that never resolves
    mockGeoCheck.mockReturnValue(new Promise(() => {}));

    render(<CheckoutPage />);

    // Should not show plan or error — just loading
    expect(screen.queryByText('Continue to Payment')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sanctions-notice')).not.toBeInTheDocument();
  });

  it('should block sanctioned geos with PaymentsUnavailableNotice', async () => {
    mockGeoCheck.mockResolvedValue(true);

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByTestId('sanctions-notice')).toBeInTheDocument();
    });

    // Plan fetch should NOT be called
    expect(mockPublicApiGet).not.toHaveBeenCalled();
  });

  it('should allow non-sanctioned geos to proceed', async () => {
    mockGeoCheck.mockResolvedValue(false);

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('Continue to Payment')).toBeInTheDocument();
    });
  });

  // ─── Plan loading ────────────────────────────────────────
  it('should show error when plan fetch fails', async () => {
    mockGeoCheck.mockResolvedValue(false);
    mockPublicApiGet.mockRejectedValue(new Error('Network error'));

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load plan details. Please try again later.')).toBeInTheDocument();
    });
  });

  it('should redirect to dashboard for free plans', async () => {
    mockGeoCheck.mockResolvedValue(false);
    mockPublicApiGet.mockResolvedValue({
      data: { data: { ...mockPlan, price: 0 } },
    });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('should display plan details when loaded', async () => {
    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('$15')).toBeInTheDocument();
      expect(screen.getByText(/5 Pages/)).toBeInTheDocument();
      expect(screen.getByText(/AI Replies per month/)).toBeInTheDocument();
      expect(screen.getByText(/7 day free trial/)).toBeInTheDocument();
    });
  });

  // ─── Checkout button ─────────────────────────────────────
  it('should redirect unauthenticated users to login with return URL', async () => {
    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isAuthenticated: false,
    });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('Continue to Payment')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Continue to Payment'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining('/login?redirect=')
      );
    });
  });

  it('should disable button while checkout is in progress', async () => {
    mockApiPost.mockImplementation(() => new Promise(() => {})); // never resolves

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('Continue to Payment')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Continue to Payment'));

    await waitFor(() => {
      expect(screen.getByText('Processing...')).toBeInTheDocument();
    });
  });

  it('should block checkout for sanctioned users even if button is clicked', async () => {
    // Start not sanctioned, then backend catches it
    mockGeoCheck.mockResolvedValue(false);
    mockApiPost.mockRejectedValue({
      response: { data: { code: 'SANCTIONED_GEO_BLOCK' } },
    });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('Continue to Payment')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Continue to Payment'));

    await waitFor(() => {
      expect(screen.getByTestId('sanctions-notice')).toBeInTheDocument();
    });
  });

  it('should redirect to complete-profile when EMAIL_REQUIRED', async () => {
    mockApiPost.mockRejectedValue({
      response: { data: { code: 'EMAIL_REQUIRED' } },
    });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('Continue to Payment')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Continue to Payment'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining('/complete-profile?redirect=')
      );
    });
  });

  it('should show error on general checkout failure', async () => {
    mockApiPost.mockRejectedValue({
      response: { data: { error: 'Card declined' } },
    });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('Continue to Payment')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Continue to Payment'));

    await waitFor(() => {
      expect(screen.getByText('Card declined')).toBeInTheDocument();
    });
  });

  // ─── Missing planId ──────────────────────────────────────
  it('should not crash when planId is missing', async () => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: {},
      push: mockPush,
      pathname: '/checkout',
    });

    render(<CheckoutPage />);

    // Let the geo check promise settle
    await act(async () => {});

    // Should not crash — plan fetch won't fire without planId
    expect(mockPublicApiGet).not.toHaveBeenCalled();
  });
});
