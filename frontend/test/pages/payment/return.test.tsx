// Set env before module import
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_mock';

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/router';
import PaymentReturnPage from '@/pages/payment/return';

vi.mock('next/router', () => ({ useRouter: vi.fn() }));
vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/ui', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@/lib/sentryHelpers', () => ({
  captureError: vi.fn(),
}));

const mockRetrievePaymentIntent = vi.fn();
const mockRetrieveSetupIntent = vi.fn();

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({
    retrievePaymentIntent: mockRetrievePaymentIntent,
    retrieveSetupIntent: mockRetrieveSetupIntent,
  })),
}));

const mockApiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}));

describe('PaymentReturnPage', () => {
  let mockPush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPush = vi.fn();
    mockApiGet.mockReset();
    mockRetrievePaymentIntent.mockReset();
    mockRetrieveSetupIntent.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should show success when payment_intent succeeded', async () => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: { payment_intent: 'pi_123', payment_intent_client_secret: 'pi_123_secret' },
      push: mockPush,
      isReady: true,
    });

    mockRetrievePaymentIntent.mockResolvedValue({
      paymentIntent: { status: 'succeeded' },
    });

    render(<PaymentReturnPage />);

    await waitFor(() => {
      expect(screen.getByText('Payment Successful!')).toBeInTheDocument();
    });

    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('should show success when setup_intent succeeded', async () => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: { setup_intent: 'seti_123', setup_intent_client_secret: 'seti_123_secret' },
      push: mockPush,
      isReady: true,
    });

    mockRetrieveSetupIntent.mockResolvedValue({
      setupIntent: { status: 'succeeded' },
    });

    render(<PaymentReturnPage />);

    await waitFor(() => {
      expect(screen.getByText('Payment Successful!')).toBeInTheDocument();
    });
  });

  it('should show incomplete when payment_intent requires action', async () => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: { payment_intent: 'pi_123', payment_intent_client_secret: 'pi_123_secret' },
      push: mockPush,
      isReady: true,
    });

    mockRetrievePaymentIntent.mockResolvedValue({
      paymentIntent: { status: 'requires_payment_method' },
    });

    render(<PaymentReturnPage />);

    await waitFor(() => {
      expect(screen.getByText('Payment Incomplete')).toBeInTheDocument();
    });
  });

  // Legacy flow: session_id param
  it('should show success for legacy session_id flow', async () => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: { session_id: 'cs_test_123' },
      push: mockPush,
      isReady: true,
    });

    mockApiGet.mockResolvedValue({
      data: { status: 'complete', paymentStatus: 'paid' },
    });

    render(<PaymentReturnPage />);

    await waitFor(() => {
      expect(screen.getByText('Payment Successful!')).toBeInTheDocument();
    });
  });

  it('should show incomplete when no valid params and router is ready', async () => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: {},
      push: mockPush,
      isReady: true,
    });

    render(<PaymentReturnPage />);

    await waitFor(() => {
      expect(screen.getByText('Payment Incomplete')).toBeInTheDocument();
    });

    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('should show loading while checking', () => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: { payment_intent_client_secret: 'pi_123_secret' },
      push: mockPush,
      isReady: true,
    });

    mockRetrievePaymentIntent.mockReturnValue(new Promise(() => {}));

    render(<PaymentReturnPage />);

    expect(screen.getByText('Verifying your payment...')).toBeInTheDocument();
  });
});
