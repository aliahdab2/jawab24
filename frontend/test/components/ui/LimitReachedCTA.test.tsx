import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';

const mockOpenExternalUrl = vi.fn();
let mockIsNative = false;

vi.mock('@/lib/openExternalUrl', () => ({
  openExternalUrl: (...args: unknown[]) => mockOpenExternalUrl(...args),
}));

vi.mock('@/constants/brand', () => ({
  BRAND_ASSETS: { urls: { base: 'https://jawab24.com' } },
}));

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mockIsNative },
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key === 'limitReached' ? 'Limit Reached' : 'Upgrade',
  useLocale: () => 'en',
}));

// Import after mocks are set up
const { LimitReachedCTA } = await import('../../../src/components/ui/LimitReachedCTA');

describe('LimitReachedCTA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsNative = false;
  });

  it('renders upgrade link on web', () => {
    render(<LimitReachedCTA />);
    const link = screen.getByRole('link', { name: 'Upgrade' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/pricing');
  });

  it('does not call openExternalUrl on web', () => {
    render(<LimitReachedCTA />);
    expect(mockOpenExternalUrl).not.toHaveBeenCalled();
  });

  it('renders a button on native and calls openExternalUrl on click', () => {
    mockIsNative = true;
    render(<LimitReachedCTA />);
    const button = screen.getByRole('button', { name: 'Upgrade' });
    fireEvent.click(button);
    expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://jawab24.com/en/pricing');
  });

  it('does not render a link on native', () => {
    mockIsNative = true;
    render(<LimitReachedCTA />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
