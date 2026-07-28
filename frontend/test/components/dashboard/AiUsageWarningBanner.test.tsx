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
    expect(screen.getByText(/10,000 top-up left/)).toBeInTheDocument();

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

  it('shows the amber warning near the cap when there is no balance behind it', () => {
    render(<AiUsageWarningBanner aiReplies={aiReplies({ used: 9000, percentUsed: 90 })} topupBalance={0} />);
    expect(screen.getByTestId('ai-usage-warning-banner')).toHaveAttribute('data-severity', 'warning');
  });

  /**
   * The plan cap is a billing boundary, not the wall. These two cases are the
   * whole point of deriving state from plan + top-up: an identical 90%-of-cap
   * merchant is warned or not depending on whether the balance behind the cap
   * actually changes the outcome.
   */
  it('stays silent near the cap when the top-up balance comfortably absorbs the overflow', () => {
    // 9,000 of 10,000 with 10,000 banked — 19k of runway. Warning the merchant
    // that "replies will stop" here is simply false. This asserted 'warning'
    // before, which is the live false alarm it was written from.
    const { container } = render(
      <AiUsageWarningBanner aiReplies={aiReplies({ used: 9000, percentUsed: 90 })} topupBalance={10000} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('still warns near the cap when the balance is too thin to change the outcome', () => {
    // 8,500 used against a 10,500 real runway — past 80% of it, so the wall is real.
    render(<AiUsageWarningBanner aiReplies={aiReplies({ used: 8500, percentUsed: 85 })} topupBalance={500} />);
    expect(screen.getByTestId('ai-usage-warning-banner')).toHaveAttribute('data-severity', 'warning');
  });

  it('warns instead of reassuring when the top-up balance is nearly drained', () => {
    // At the cap with 100 replies left: the calm "no interruption" notice would be
    // a false promise moments before Smart Replies stop.
    render(<AiUsageWarningBanner aiReplies={aiReplies()} topupBalance={100} />);

    const banner = screen.getByTestId('ai-usage-warning-banner');
    expect(banner).toHaveAttribute('data-severity', 'topup-low');
    expect(screen.getByText(/almost gone/i)).toBeInTheDocument();
    expect(screen.getByText(/Only 100 top-up replies left/)).toBeInTheDocument();
    // Explicitly NOT the calm notice.
    expect(screen.queryByText("You're now using your top-up balance")).not.toBeInTheDocument();
  });
});
