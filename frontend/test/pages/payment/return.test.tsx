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

const mockApiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}));

describe('PaymentReturnPage', () => {
  let mockPush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPush = vi.fn();
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: { session_id: 'cs_test_123' },
      push: mockPush,
      isReady: true,
    });
    mockApiGet.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should show loading state while checking session', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}));

    render(<PaymentReturnPage />);

    expect(screen.getByText('Verifying your payment...')).toBeInTheDocument();
  });

  it('should show success when session is complete', async () => {
    mockApiGet.mockResolvedValue({
      data: { status: 'complete', paymentStatus: 'paid' },
    });

    render(<PaymentReturnPage />);

    await waitFor(() => {
      expect(screen.getByText('Payment Successful!')).toBeInTheDocument();
      expect(screen.getByText('Go to Dashboard')).toBeInTheDocument();
    });
  });

  it('should show incomplete when session is open', async () => {
    mockApiGet.mockResolvedValue({
      data: { status: 'open', paymentStatus: 'unpaid' },
    });

    render(<PaymentReturnPage />);

    await waitFor(() => {
      expect(screen.getByText('Payment Incomplete')).toBeInTheDocument();
    });
  });

  it('should show expired when session is expired', async () => {
    mockApiGet.mockResolvedValue({
      data: { status: 'expired', paymentStatus: 'unpaid' },
    });

    render(<PaymentReturnPage />);

    await waitFor(() => {
      expect(screen.getByText('Session Expired')).toBeInTheDocument();
    });
  });

  it('should fall back to open status on API error', async () => {
    mockApiGet.mockRejectedValue(new Error('Network error'));

    render(<PaymentReturnPage />);

    await waitFor(() => {
      expect(screen.getByText('Payment Incomplete')).toBeInTheDocument();
    });
  });

  it('should show incomplete when session_id is missing and router is ready', async () => {
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
});
