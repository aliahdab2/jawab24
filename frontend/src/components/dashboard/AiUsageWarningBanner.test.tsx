import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UsageSummary } from '@jawab24/shared';
import { AiUsageWarningBanner } from './AiUsageWarningBanner';

// jsdom has no PointerEvent, so testing-library's fireEvent.pointer* drops
// clientX. Dispatch a MouseEvent typed as a pointer event instead — it carries
// clientX and still matches the component's pointer listeners by type string.
function firePointer(target: Window | Element, type: string, clientX: number) {
    fireEvent(target, new MouseEvent(type, { clientX, bubbles: true }));
}

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

    it('no longer renders a dismiss button (dismissal is now a swipe gesture)', () => {
        render(<AiUsageWarningBanner aiReplies={makeAiReplies({ percentUsed: 85 })} />);
        expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
    });

    it('dismisses the warning when swiped past the 100px threshold and keeps it dismissed', () => {
        vi.useFakeTimers();
        try {
            const { rerender } = render(
                <AiUsageWarningBanner aiReplies={makeAiReplies({ percentUsed: 85 })} />,
            );
            const banner = screen.getByTestId('ai-usage-warning-banner');
            firePointer(banner, 'pointerdown', 100);
            firePointer(window, 'pointermove', 260);
            firePointer(window, 'pointerup', 260); // dragged 160px > 100px
            // Exit animation runs for 0.3s before the dismissal is persisted.
            act(() => { vi.advanceTimersByTime(300); });
            expect(screen.queryByTestId('ai-usage-warning-banner')).not.toBeInTheDocument();

            // Re-render with the same warning: it stays dismissed (persisted 24h).
            rerender(<AiUsageWarningBanner aiReplies={makeAiReplies({ percentUsed: 85 })} />);
            expect(screen.queryByTestId('ai-usage-warning-banner')).not.toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it('snaps back (stays visible) when the swipe is below the threshold', () => {
        vi.useFakeTimers();
        try {
            render(<AiUsageWarningBanner aiReplies={makeAiReplies({ percentUsed: 85 })} />);
            const banner = screen.getByTestId('ai-usage-warning-banner');
            firePointer(banner, 'pointerdown', 100);
            firePointer(window, 'pointermove', 150);
            firePointer(window, 'pointerup', 150); // dragged 50px < 100px
            act(() => { vi.advanceTimersByTime(300); });
            expect(screen.getByTestId('ai-usage-warning-banner')).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not dismiss the critical banner on swipe (Smart Replies are paused — it must stay)', () => {
        vi.useFakeTimers();
        try {
            render(
                <AiUsageWarningBanner
                    aiReplies={makeAiReplies({ used: 500, remaining: 0, percentUsed: 100 })}
                />,
            );
            const banner = screen.getByTestId('ai-usage-warning-banner');
            firePointer(banner, 'pointerdown', 100);
            firePointer(window, 'pointermove', 400);
            firePointer(window, 'pointerup', 400); // far past threshold
            act(() => { vi.advanceTimersByTime(300); });
            expect(screen.getByTestId('ai-usage-warning-banner')).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
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

    it('routes Pro customers at their limit to the hidden Scale plans', () => {
        render(
            <AiUsageWarningBanner
                planSlug="pro"
                aiReplies={makeAiReplies({ used: 500, remaining: 0, percentUsed: 100 })}
            />,
        );
        const link = screen.getByRole('link', { name: /scale plans/i });
        expect(link).toHaveAttribute('href', '/pricing/scale');
        // Pro is the top public tier — the generic /pricing upgrade isn't offered.
        expect(screen.queryByText('Upgrade Plan')).not.toBeInTheDocument();
    });

    it('routes Scale customers at their limit to the Scale plans too', () => {
        render(
            <AiUsageWarningBanner
                planSlug="scale-20k"
                aiReplies={makeAiReplies({ used: 20000, limit: 20000, remaining: 0, percentUsed: 100 })}
            />,
        );
        expect(screen.getByRole('link', { name: /scale plans/i })).toHaveAttribute('href', '/pricing/scale');
    });

    it('shows the generic /pricing upgrade (not Scale plans) for lower tiers', () => {
        render(
            <AiUsageWarningBanner planSlug="starter" aiReplies={makeAiReplies({ percentUsed: 85 })} />,
        );
        expect(screen.getByRole('link', { name: /upgrade/i })).toHaveAttribute('href', '/pricing');
        expect(screen.queryByText(/scale plans/i)).not.toBeInTheDocument();
    });
});
