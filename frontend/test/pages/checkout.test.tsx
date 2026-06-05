// Set env before module import so stripePromise initializes correctly
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_mock';

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
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
  BRAND_ASSETS: {
    meta: { appName: 'Jawab24' },
    urls: { base: 'https://jawab24.com', canonical: (p = '') => `https://jawab24.com${p}` },
  },
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

// Mock Stripe
vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="stripe-elements">{children}</div>
  ),
  PaymentElement: () => <div data-testid="payment-element">Payment Form</div>,
  useStripe: () => ({}),
  useElements: () => ({}),
}));

// These are the key mocks we control per-test
const mockGeoCheck = vi.fn();
vi.mock('@/utils/geoCheck', () => ({
  isUserSanctioned: () => mockGeoCheck(),
}));

const mockApiPost = vi.fn();
const mockApiGet = vi.fn();
const mockPublicApiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    post: (...args: unknown[]) => mockApiPost(...args),
    get: (...args: unknown[]) => mockApiGet(...args),
  },
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

    // Default: subscription intent creation succeeds
    mockApiPost.mockResolvedValue({
      data: { clientSecret: 'pi_test_123_secret', type: 'payment', subscriptionId: 'sub_test_123' },
    });
  });

  afterEach(async () => {
    // Unmount components before clearing mocks to stop any in-flight async effects
    // (e.g. createSession) from leaking into the next test's mock state.
    cleanup();
    await act(async () => {});
    vi.clearAllMocks();
  });

  // ─── Sanctions: geo check ────────────────────────────────
  it('should show loader while geo check is in progress', () => {
    // Geo check that never resolves
    mockGeoCheck.mockReturnValue(new Promise(() => {}));

    render(<CheckoutPage />);

    // Should not show plan or error — just loading
    expect(screen.queryByTestId('embedded-checkout')).not.toBeInTheDocument();
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

  it('should create subscription intent and render payment form', async () => {
    const { container } = render(<CheckoutPage />);

    // Wait for plan details to appear (means plan is loaded)
    await waitFor(() => {
      expect(screen.getByText('$15')).toBeInTheDocument();
    });

    // Wait for the subscription intent API call
    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        '/payment/create-subscription-intent',
        expect.objectContaining({ planId: 'plan-1' })
      );
    }, { timeout: 3000 });

    // After intent creation, PaymentElement should render inside Elements
    await waitFor(() => {
      expect(container.querySelector('[data-testid="payment-element"]')).toBeTruthy();
    }, { timeout: 3000 });
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
      expect(screen.getByText(/Smart Replies per month/)).toBeInTheDocument();
      expect(screen.getByText(/7 day free trial/)).toBeInTheDocument();
    });
  });

  // ─── Authentication ────────────────────────────────────
  it('should show login prompt for unauthenticated users', async () => {
    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isAuthenticated: false,
    });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('Log in to complete your subscription')).toBeInTheDocument();
      expect(screen.getByText('Log In')).toBeInTheDocument();
    });

    // Flush all pending async effects before asserting (plan may still be loading)
    await act(async () => {});

    // Should NOT create checkout session
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('should redirect to login when login button is clicked', async () => {
    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isAuthenticated: false,
    });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('Log In')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Log In'));

    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining('/login?redirect=')
    );
  });

  // ─── Session creation errors ───────────────────────────
  it('should block checkout when backend returns SANCTIONED_GEO_BLOCK', async () => {
    mockApiPost.mockRejectedValue({
      response: { data: { code: 'SANCTIONED_GEO_BLOCK' } },
    });

    render(<CheckoutPage />);

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
      expect(screen.getByText('Card declined')).toBeInTheDocument();
    });
  });

  // ─── Runaway retry-loop regression ─────────────────────
  // A non-geo / non-email failure used to re-fire the auto-create effect on
  // every error: `sessionLoading` toggling changed createSession's identity,
  // which re-ran the effect, which retried instantly with no backoff — flooding
  // /payment/create-*-intent until the rate limiter (10/min) tripped. The fix
  // moved the in-flight guard to a ref that's absent from the callback deps, so
  // the auto-create fires exactly once and retries are manual.
  it('does not auto-retry the intent after a generic error (regression)', async () => {
    mockApiPost.mockRejectedValue({
      response: { data: { error: 'Card declined' } },
    });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('Card declined')).toBeInTheDocument();
    });

    // Give any erroneous re-fire loop room to manifest across async cycles.
    for (let i = 0; i < 5; i++) {
      await act(async () => { await Promise.resolve(); });
    }

    const intentCalls = mockApiPost.mock.calls.filter(
      ([url]) => url === '/payment/create-subscription-intent'
    );
    expect(intentCalls).toHaveLength(1);
  });

  it('allows a manual retry via "Try Again" after a network error', async () => {
    // Network errors surface a manual retry button; auto-retry stays suppressed
    // but the explicit retry must issue a fresh intent request.
    mockApiPost.mockRejectedValueOnce({ code: 'ERR_NETWORK' });
    mockApiPost.mockResolvedValueOnce({
      data: { clientSecret: 'pi_test_123_secret', type: 'payment' },
    });

    render(<CheckoutPage />);

    const retryButton = await screen.findByText('Try Again');
    expect(
      mockApiPost.mock.calls.filter(([url]) => url === '/payment/create-subscription-intent')
    ).toHaveLength(1);

    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(
        mockApiPost.mock.calls.filter(([url]) => url === '/payment/create-subscription-intent')
      ).toHaveLength(2);
    });
  });

  // ─── Error-UX fast-follows (post-#240 review) ──────────
  it('shows a working retry on a generic (non-network) server error', async () => {
    // Regression: a generic 500 used to render no retry button (only network
    // errors did), stranding the user on a dead banner. Retry must now show and
    // re-issue the intent for any error.
    mockApiPost.mockRejectedValueOnce({ response: { data: { error: 'Server error' } } });
    mockApiPost.mockResolvedValueOnce({ data: { clientSecret: 'pi_test_123_secret', type: 'payment' } });

    render(<CheckoutPage />);

    const retryButton = await screen.findByText('Try Again');
    expect(intentCallCount()).toBe(1);

    fireEvent.click(retryButton);

    await waitFor(() => expect(intentCallCount()).toBe(2));
  });

  it('renders the server message (not an empty banner) when the error uses a boolean error flag', async () => {
    // Regression: `{ error: true, message }` (e.g. the rate limiter) used to make
    // `errorData.error || errorData.message` resolve to boolean true → setError(true)
    // → empty <p>. The message must be shown instead.
    mockApiPost.mockRejectedValue({
      response: { data: { error: true, message: 'Rate limit exceeded. Please try again later.', code: 'RATE_LIMIT_EXCEEDED' } },
    });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('Rate limit exceeded. Please try again later.')).toBeInTheDocument();
    });
  });

  // ─── Every outcome fires the intent exactly once ───────
  // The loop bug meant a non-terminal outcome could re-fire createSession on
  // every render. Lock in the once-only invariant across all branches.
  const intentCallCount = () =>
    mockApiPost.mock.calls.filter(([url]) => url === '/payment/create-subscription-intent').length;

  const flushAsyncCycles = async () => {
    for (let i = 0; i < 5; i++) {
      await act(async () => { await Promise.resolve(); });
    }
  };

  it('creates the intent exactly once on success (no double-fire)', async () => {
    const { container } = render(<CheckoutPage />);

    await waitFor(() => {
      expect(container.querySelector('[data-testid="payment-element"]')).toBeTruthy();
    }, { timeout: 3000 });

    await flushAsyncCycles();
    expect(intentCallCount()).toBe(1);
  });

  it('blocks after exactly one attempt on backend SANCTIONED_GEO_BLOCK', async () => {
    mockApiPost.mockRejectedValue({ response: { data: { code: 'SANCTIONED_GEO_BLOCK' } } });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByTestId('sanctions-notice')).toBeInTheDocument();
    });
    await flushAsyncCycles();
    expect(intentCallCount()).toBe(1);
  });

  it('blocks after exactly one attempt on backend GEO_VERIFICATION_REQUIRED', async () => {
    mockApiPost.mockRejectedValue({ response: { data: { code: 'GEO_VERIFICATION_REQUIRED' } } });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByTestId('sanctions-notice')).toBeInTheDocument();
    });
    await flushAsyncCycles();
    expect(intentCallCount()).toBe(1);
  });

  it('redirects once and does not retry on EMAIL_REQUIRED', async () => {
    mockApiPost.mockRejectedValue({ response: { data: { code: 'EMAIL_REQUIRED' } } });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/complete-profile?redirect='));
    });
    await flushAsyncCycles();
    expect(intentCallCount()).toBe(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('should show loading state while session is being created', async () => {
    mockApiPost.mockImplementation(() => new Promise(() => {})); // never resolves

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('Loading payment form...')).toBeInTheDocument();
    });
  });

  // ─── Top-up mode (?topup=5k) ─────────────────────────────
  describe('top-up checkout (?topup=5k)', () => {
    const topupConfigResponse = {
      data: {
        data: {
          enabled: true,
          packs: {
            '5k': { repliesAdded: 5000, priceCents: 4900 },
            '10k': { repliesAdded: 10000, priceCents: 7900 },
          },
          currency: 'usd',
          whatsappNumber: '',
        },
      },
    };

    beforeEach(() => {
      (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
        query: { topup: '5k' },
        push: mockPush,
        pathname: '/checkout',
        locale: 'en',
      });
      // Top-up config is fetched via the PUBLIC endpoint (like /plans/:id), so it
      // flows through publicApi.get — not the authenticated api instance.
      mockPublicApiGet.mockResolvedValue(topupConfigResponse);
    });

    it('fetches the pack via the public config endpoint, creates a top-up intent, and renders the form', async () => {
      const { container } = render(<CheckoutPage />);

      // Pack summary (price from topup config). The price big number is split
      // into "$49" + ".00" spans, so match the integer part.
      await waitFor(() => {
        expect(screen.getByText('$49')).toBeInTheDocument();
      });
      // Config came from the PUBLIC endpoint, not a plan fetch.
      expect(mockPublicApiGet).toHaveBeenCalledWith('/subscription/topup/config');

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith('/payment/create-topup-intent', { pack: '5k' });
      }, { timeout: 3000 });

      await waitFor(() => {
        expect(container.querySelector('[data-testid="payment-element"]')).toBeTruthy();
      }, { timeout: 3000 });
    });

    it('blocks sanctioned geos before any top-up call', async () => {
      mockGeoCheck.mockResolvedValue(true);

      render(<CheckoutPage />);

      await waitFor(() => {
        expect(screen.getByTestId('sanctions-notice')).toBeInTheDocument();
      });
      expect(mockPublicApiGet).not.toHaveBeenCalled();
      expect(mockApiPost).not.toHaveBeenCalled();
    });

    // Regression for the package-selection handoff: arriving with ?topup=10k must
    // resolve the 10k pack's price ($79) + reply count and create a 10k intent —
    // NOT silently fall back to 5k/$49. Pairs with the modal-side test in
    // TopUpRequestModal.test.tsx ("card link reflects the selected pack") to lock
    // the full select-pack → checkout handoff end to end.
    it('uses the 10k pack price + intent when arriving with ?topup=10k', async () => {
      (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
        query: { topup: '10k' },
        push: mockPush,
        pathname: '/checkout',
        locale: 'en',
      });

      render(<CheckoutPage />);

      // Summary shows the 10k pack price ($79), not the 5k price ($49).
      await waitFor(() => {
        expect(screen.getByText('$79')).toBeInTheDocument();
      });
      expect(screen.queryByText('$49')).not.toBeInTheDocument();
      // 10,000 reply count is surfaced in the summary (rendered in both the
      // mobile collapsed header and the desktop summary, so match all).
      expect(screen.getAllByText(/10,000/).length).toBeGreaterThan(0);

      // The created intent carries the 10k pack — the server prices off this, so a
      // wrong pack here would charge the wrong amount.
      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith('/payment/create-topup-intent', { pack: '10k' });
      }, { timeout: 3000 });
    });

    it('shows the unavailable message and creates no intent when the kill-switch is off', async () => {
      mockPublicApiGet.mockResolvedValue({
        data: { data: { ...topupConfigResponse.data.data, enabled: false } },
      });

      render(<CheckoutPage />);

      await waitFor(() => {
        expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
      });
      // Kill-switch: never attempt to create a PaymentIntent.
      expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('shows the login gate (not an error) for an unauthenticated top-up arrival, with no intent call', async () => {
      // Parity with the subscription flow: a logged-out visitor at
      // /checkout?topup=5k (deep link, expired session, iOS→web bounce) must get
      // the in-page login CTA, not a hard error / logout. The public config
      // endpoint makes the order summary + gate renderable while logged out.
      (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ isAuthenticated: false });

      render(<CheckoutPage />);

      await waitFor(() => {
        expect(screen.getByText('Log in to add replies')).toBeInTheDocument();
      });
      // No payment intent is created until the user logs in.
      expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('redirects to complete-profile (preserving the top-up) when EMAIL_REQUIRED', async () => {
      mockApiPost.mockRejectedValue({ response: { data: { code: 'EMAIL_REQUIRED' } } });

      render(<CheckoutPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('topup%3D5k'));
      });
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
