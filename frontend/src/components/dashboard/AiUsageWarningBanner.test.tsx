import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UsageSummary } from '@jawab24/shared';
import { AiUsageWarningBanner } from './AiUsageWarningBanner';

const mockIsIOSNative = vi.fn(() => false);
const mockIsNative = vi.fn(() => false);
vi.mock('@/lib/capacitor', () => ({
    isIOSNative: () => mockIsIOSNative(),
    isNativePlatform: () => mockIsNative(),
}));

function makeAiReplies(overrides: Partial<UsageSummary['aiReplies']> = {}): UsageSummary['aiReplies'] {
    return {
        used: 400,
        limit: 500,
        remaining: 100,
        percentUsed: 80,
        ...overrides,
    };
}

describe('AiUsageWarningBanner', () => {
    beforeEach(() => {
        localStorage.clear();
        mockIsIOSNative.mockReturnValue(false);
        mockIsNative.mockReturnValue(false);
    });

    it('renders nothing when limit is null (unlimited plan)', () => {
        const { container } = render(
            <AiUsageWarningBanner aiReplies={makeAiReplies({ limit: null, percentUsed: 0 })} />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing below 80%', () => {
        const { container } = render(
            <AiUsageWarningBanner aiReplies={makeAiReplies({ used: 300, percentUsed: 60 })} />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders as warning at exactly 80%', () => {
        render(<AiUsageWarningBanner aiReplies={makeAiReplies({ percentUsed: 80 })} />);
        const banner = screen.getByTestId('ai-usage-warning-banner');
        expect(banner).toHaveAttribute('data-severity', 'warning');
        expect(banner).toHaveTextContent(/approaching/i);
    });

    it('renders as critical at 100%', () => {
        render(
            <AiUsageWarningBanner
                aiReplies={makeAiReplies({ used: 500, remaining: 0, percentUsed: 100 })}
            />,
        );
        const banner = screen.getByTestId('ai-usage-warning-banner');
        expect(banner).toHaveAttribute('data-severity', 'critical');
        expect(banner).toHaveTextContent(/Smart Replies for this period.*Post Replies/i);
    });

    it('renders as critical past 100%', () => {
        render(
            <AiUsageWarningBanner
                aiReplies={makeAiReplies({ used: 520, remaining: 0, percentUsed: 104 })}
            />,
        );
        expect(screen.getByTestId('ai-usage-warning-banner')).toHaveAttribute('data-severity', 'critical');
    });

    it('shows used/limit counts', () => {
        render(<AiUsageWarningBanner aiReplies={makeAiReplies({ used: 420, percentUsed: 84 })} />);
        expect(screen.getByText(/420 of 500/)).toBeInTheDocument();
    });

    it('shows reset date when resetsAt is provided', () => {
        render(
            <AiUsageWarningBanner
                aiReplies={makeAiReplies({ percentUsed: 90 })}
                resetsAt="2026-05-15T00:00:00Z"
            />,
        );
        expect(screen.getByText(/resets on/i)).toBeInTheDocument();
    });

    it('omits reset-on copy when resetsAt is missing', () => {
        render(<AiUsageWarningBanner aiReplies={makeAiReplies({ percentUsed: 90 })} />);
        expect(screen.queryByText(/resets on/i)).not.toBeInTheDocument();
    });

    it('shows a dismiss button on warning and hides on critical', () => {
        const { rerender } = render(
            <AiUsageWarningBanner aiReplies={makeAiReplies({ percentUsed: 85 })} />,
        );
        expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();

        rerender(
            <AiUsageWarningBanner
                aiReplies={makeAiReplies({ used: 500, remaining: 0, percentUsed: 100 })}
            />,
        );
        expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
    });

    it('hides after dismiss is clicked (warning only)', () => {
        const { rerender } = render(
            <AiUsageWarningBanner aiReplies={makeAiReplies({ percentUsed: 85 })} />,
        );
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
        rerender(<AiUsageWarningBanner aiReplies={makeAiReplies({ percentUsed: 85 })} />);
        expect(screen.queryByTestId('ai-usage-warning-banner')).not.toBeInTheDocument();
    });

    it('does not honor a stale warning dismissal once the limit is reached', () => {
        // Simulate user dismissed the 80% warning earlier in the period
        localStorage.setItem('aiUsageWarning80DismissedAt', String(Date.now()));
        render(
            <AiUsageWarningBanner
                aiReplies={makeAiReplies({ used: 500, remaining: 0, percentUsed: 100 })}
            />,
        );
        expect(screen.getByTestId('ai-usage-warning-banner')).toHaveAttribute('data-severity', 'critical');
    });

    it('renders an upgrade CTA link', () => {
        render(<AiUsageWarningBanner aiReplies={makeAiReplies({ percentUsed: 85 })} />);
        // UpgradeCTA renders either a Link or a div[role=button]; just assert the upgrade label is visible
        expect(screen.getByText(/upgrade/i)).toBeInTheDocument();
    });

    it('hides the upgrade CTA on iOS native (App Store reader-app)', () => {
        mockIsNative.mockReturnValue(true);
        mockIsIOSNative.mockReturnValue(true);
        render(
            <AiUsageWarningBanner
                aiReplies={makeAiReplies({ used: 500, remaining: 0, percentUsed: 100 })}
            />,
        );
        // Banner itself still renders so the user knows their limit was reached.
        expect(screen.getByTestId('ai-usage-warning-banner')).toBeInTheDocument();
        // No upgrade link/button anywhere.
        expect(screen.queryByRole('link', { name: /upgrade/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument();
    });

    it('routes Pro customers at their limit to the hidden high-volume plans', () => {
        render(
            <AiUsageWarningBanner
                planSlug="pro"
                aiReplies={makeAiReplies({ used: 500, remaining: 0, percentUsed: 100 })}
            />,
        );
        const link = screen.getByRole('link', { name: /high-volume/i });
        expect(link).toHaveAttribute('href', '/pricing/scale');
        // Pro is the top public tier — the generic /pricing upgrade isn't offered.
        expect(screen.queryByText('Upgrade Plan')).not.toBeInTheDocument();
    });

    it('routes Scale customers at their limit to the high-volume plans too', () => {
        render(
            <AiUsageWarningBanner
                planSlug="scale-20k"
                aiReplies={makeAiReplies({ used: 20000, limit: 20000, remaining: 0, percentUsed: 100 })}
            />,
        );
        expect(screen.getByRole('link', { name: /high-volume/i })).toHaveAttribute('href', '/pricing/scale');
    });

    it('shows the generic /pricing upgrade (not high-volume) for lower tiers', () => {
        render(
            <AiUsageWarningBanner planSlug="starter" aiReplies={makeAiReplies({ percentUsed: 85 })} />,
        );
        expect(screen.getByRole('link', { name: /upgrade/i })).toHaveAttribute('href', '/pricing');
        expect(screen.queryByText(/high-volume/i)).not.toBeInTheDocument();
    });
});
