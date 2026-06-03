import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AiUsageWarningBanner } from '@/components/dashboard/AiUsageWarningBanner';

// next-intl is mocked globally in test/setup.ts → assertions use real EN strings.

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

// BuyTopUpCTA pulls in the top-up modal + API client + Capacitor — stub it so the
// test stays focused on the banner's own state → copy logic.
vi.mock('@/components/billing/BuyTopUpCTA', () => ({
  BuyTopUpCTA: () => <button type="button">Add replies</button>,
}));

// Capacitor native guards → behave as web.
vi.mock('@/lib/capacitor', () => ({
  isIOSNative: () => false,
  isNativePlatform: () => false,
}));

const aiReplies = (overrides: Partial<{ used: number; limit: number | null; remaining: number | null; percentUsed: number }> = {}) => ({
  used: 10000,
  limit: 10000,
  remaining: 0,
  percentUsed: 100,
  ...overrides,
});

describe('AiUsageWarningBanner — top-up awareness', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders nothing below 80% usage', () => {
    const { container } = render(<AiUsageWarningBanner aiReplies={aiReplies({ used: 100, percentUsed: 10 })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the calm top-up notice (not the red wall) at 100% when a top-up balance exists', () => {
    render(<AiUsageWarningBanner aiReplies={aiReplies()} topupBalance={10000} />);

    const banner = screen.getByTestId('ai-usage-warning-banner');
    expect(banner).toHaveAttribute('data-severity', 'topup');
    expect(screen.getByText("You're now using your top-up balance")).toBeInTheDocument();
    expect(screen.getByText(/10,000 top-up replies left/)).toBeInTheDocument();

    // The misleading "used all Smart Replies" wall copy and the fallback prompt
    // (the fallback never fires while top-up covers replies) must NOT appear.
    expect(screen.queryByText(/used all Smart Replies for this period/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Customize fallback reply/i)).not.toBeInTheDocument();
  });

  it('shows the red critical wall at 100% when there is no top-up balance', () => {
    render(<AiUsageWarningBanner aiReplies={aiReplies()} topupBalance={0} />);

    const banner = screen.getByTestId('ai-usage-warning-banner');
    expect(banner).toHaveAttribute('data-severity', 'critical');
    expect(screen.getByText(/used all Smart Replies for this period/i)).toBeInTheDocument();
    expect(screen.getByText(/Customize fallback reply/i)).toBeInTheDocument();
  });

  it('treats a negative (refunded) balance as the critical wall', () => {
    render(<AiUsageWarningBanner aiReplies={aiReplies()} topupBalance={-50} />);
    expect(screen.getByTestId('ai-usage-warning-banner')).toHaveAttribute('data-severity', 'critical');
  });

  it('treats a missing top-up balance as the critical wall', () => {
    render(<AiUsageWarningBanner aiReplies={aiReplies()} />);
    expect(screen.getByTestId('ai-usage-warning-banner')).toHaveAttribute('data-severity', 'critical');
  });

  it('shows the amber warning between 80% and 100% regardless of balance', () => {
    render(<AiUsageWarningBanner aiReplies={aiReplies({ used: 9000, percentUsed: 90 })} topupBalance={10000} />);
    expect(screen.getByTestId('ai-usage-warning-banner')).toHaveAttribute('data-severity', 'warning');
  });
});
