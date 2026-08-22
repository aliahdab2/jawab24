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

/**
 * Regression: a manual (cash/transfer) plan whose coverage has lapsed.
 *
 * The production shape, from the owner's own account on 2026-08-14: entitlement
 * ends at UTC midnight of the period-end day, the usage window closes at the same
 * instant, getCurrentUsage then matches no row and `used` falls back to 0. Every
 * quota-derived signal therefore reads "0 of 4,500 — healthy", and this banner —
 * which was the only loud surface the merchant had — hid itself while every reply
 * was being refused. The gate verdict is the only input that can see it.
 */
describe('AiUsageWarningBanner — billing paused (gate refuses)', () => {
    beforeEach(() => {
        localStorage.clear();
        mockIsIOSNative.mockReturnValue(false);
        mockIsNative.mockReturnValue(false);
    });

    // The exact closed-window artifact: zero used against a full plan cap.
    const lapsed = () => makeAiReplies({ used: 0, limit: 4500, remaining: 4500, percentUsed: 0 });
    const blocked = { allowed: false, code: 'subscription_inactive' as const };

    it('renders a blocking banner when the gate refuses, even though usage reads 0 of 4,500', () => {
        render(<AiUsageWarningBanner aiReplies={lapsed()} autoReply={blocked} />);
        const banner = screen.getByTestId('ai-usage-warning-banner');
        expect(banner).toHaveAttribute('data-severity', 'billing-paused');
        expect(banner).toHaveTextContent(/subscription has ended/i);
    });

    it('does not present the closed window as a healthy quota', () => {
        render(<AiUsageWarningBanner aiReplies={lapsed()} autoReply={blocked} />);
        // "0 of 4,500 Smart Replies used" would read as a full, fresh allowance.
        expect(screen.queryByText(/0 of 4,500/)).not.toBeInTheDocument();
    });

    it('is announced to assistive tech and cannot be swiped away', () => {
        vi.useFakeTimers();
        try {
            render(<AiUsageWarningBanner aiReplies={lapsed()} autoReply={blocked} />);
            const banner = screen.getByTestId('ai-usage-warning-banner');
            expect(banner).toHaveAttribute('role', 'alert');

            firePointer(banner, 'pointerdown', 100);
            firePointer(window, 'pointermove', 400);
            firePointer(window, 'pointerup', 400);
            act(() => { vi.advanceTimersByTime(300); });

            expect(screen.getByTestId('ai-usage-warning-banner')).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it('offers renewal as the primary action and never a top-up', () => {
        render(<AiUsageWarningBanner planSlug="starter" aiReplies={lapsed()} autoReply={blocked} />);
        expect(screen.getByRole('link', { name: /renew subscription/i })).toHaveAttribute('href', '/pricing');
        // The gate runs before any quota or balance is consulted, so a top-up
        // would take the merchant's money and leave the replies just as frozen.
        expect(screen.queryByRole('button', { name: /add replies/i })).not.toBeInTheDocument();
    });

    it('shows when coverage actually ended, not when the period nominally renews', () => {
        render(
            <AiUsageWarningBanner
                aiReplies={lapsed()}
                autoReply={blocked}
                entitlementEndsAt="2026-08-14T00:00:00Z"
            />,
        );
        expect(screen.getByText(/coverage ended/i)).toBeInTheDocument();
    });

    it('still fires on an unmetered plan, where limit is null', () => {
        render(
            <AiUsageWarningBanner
                aiReplies={makeAiReplies({ used: 0, limit: null, remaining: null, percentUsed: 0 })}
                autoReply={blocked}
            />,
        );
        expect(screen.getByTestId('ai-usage-warning-banner')).toHaveAttribute('data-severity', 'billing-paused');
    });

    it('never leaves an iOS merchant with a pinned alert and nowhere to go', () => {
        // UpgradeCTA returns null on iOS (Guideline 3.1.1) and the top-up CTA is
        // suppressed in this state, so the banner had NO action at all — pinned,
        // undismissable, and silent about where renewal happens.
        mockIsIOSNative.mockReturnValue(true);
        render(<AiUsageWarningBanner planSlug="starter" aiReplies={lapsed()} autoReply={blocked} />);

        expect(screen.queryByRole('link', { name: /renew subscription/i })).not.toBeInTheDocument();
        expect(screen.getByText(/renew from the jawab24 website/i)).toBeInTheDocument();
    });

    it('states what the block has cost — the unanswered-message count', () => {
        // The line that turns an accounting statement into a decision. The fleet
        // audit behind it (2026-08-22) found four pages showing auto-reply ON
        // while 1,204 customer messages went unanswered in a single week.
        render(
            <AiUsageWarningBanner aiReplies={lapsed()} autoReply={blocked} unansweredSinceBlock={579} />,
        );
        expect(screen.getByText(/579 customer messages have arrived since then and gone unanswered/i)).toBeInTheDocument();
    });

    it('says nothing about volume when nothing has gone unanswered', () => {
        // "0 messages have gone unanswered" is an argument FOR waiting — the
        // opposite of what this line exists to do.
        render(
            <AiUsageWarningBanner aiReplies={lapsed()} autoReply={blocked} unansweredSinceBlock={0} />,
        );
        expect(screen.queryByText(/gone unanswered/i)).not.toBeInTheDocument();
        // The banner itself still fires — replies ARE frozen.
        expect(screen.getByTestId('ai-usage-warning-banner')).toHaveAttribute('data-severity', 'billing-paused');
    });

    it('omits the count when the backend did not send one (older API build)', () => {
        render(<AiUsageWarningBanner aiReplies={lapsed()} autoReply={blocked} />);
        expect(screen.queryByText(/gone unanswered/i)).not.toBeInTheDocument();
    });

    it('tells an expired TRIAL to choose a plan — never to "renew" something it never had', () => {
        // 19 of the 20 blocked accounts on prod (2026-08-22) were expired trials
        // reading "your subscription has ended — Renew subscription".
        render(
            <AiUsageWarningBanner planSlug="starter" aiReplies={lapsed()} autoReply={blocked} cause="trial_expired" />,
        );
        expect(screen.getByText(/your free trial has ended/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /choose a plan/i })).toHaveAttribute('href', '/pricing');
        expect(screen.queryByText(/subscription has ended/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /renew subscription/i })).not.toBeInTheDocument();
    });

    it('keeps the renewal copy for a lapsed PAID subscription (no cause)', () => {
        render(<AiUsageWarningBanner planSlug="starter" aiReplies={lapsed()} autoReply={blocked} />);
        expect(screen.getByText(/subscription has ended/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /renew subscription/i })).toBeInTheDocument();
    });

    it('leaves quota behaviour untouched when the gate allows', () => {
        const { container } = render(
            <AiUsageWarningBanner aiReplies={lapsed()} autoReply={{ allowed: true }} />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('leaves quota behaviour untouched when the API omits the verdict entirely', () => {
        // Older bundled app builds predate the field — they must not start
        // accusing healthy accounts of being blocked.
        render(<AiUsageWarningBanner aiReplies={makeAiReplies({ percentUsed: 80 })} />);
        expect(screen.getByTestId('ai-usage-warning-banner')).toHaveAttribute('data-severity', 'warning');
    });
});
