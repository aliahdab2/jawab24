import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BuyTopUpCTA } from '../BuyTopUpCTA';
import en from '@/i18n/en/topup.json';

const mockIsIOSNative = vi.fn(() => false);
vi.mock('@/lib/capacitor', () => ({
    isIOSNative: () => mockIsIOSNative(),
    isNativePlatform: () => false,
}));

/**
 * Every gate on this CTA exists because showing it would breach somebody's
 * policy or dead-end the merchant, and all four fail SILENTLY — the button
 * renders, the merchant clicks, and the refusal (or the store rejection)
 * happens somewhere else. So each one gets an explicit row.
 */
describe('BuyTopUpCTA', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsIOSNative.mockReturnValue(false);
    });

    const cta = () => screen.queryByRole('button', { name: en.cta.buyAddReplies });

    it('renders for a paying merchant on a normal Stripe rail', () => {
        render(<BuyTopUpCTA planSlug="business" />);
        expect(cta()).toBeInTheDocument();
    });

    it('is hidden on iOS native (App Store Guideline 3.1.1)', () => {
        mockIsIOSNative.mockReturnValue(true);
        render(<BuyTopUpCTA planSlug="business" />);
        expect(cta()).not.toBeInTheDocument();
    });

    it('is hidden on the Free plan (must subscribe before topping up)', () => {
        render(<BuyTopUpCTA planSlug="free" />);
        expect(cta()).not.toBeInTheDocument();
    });

    it('is hidden for a Shopify-billed workspace (D-G)', () => {
        render(<BuyTopUpCTA planSlug="business" paymentMethod="shopify" />);
        expect(cta()).not.toBeInTheDocument();
    });

    /**
     * Salla apps-policy Article 5: a Salla merchant's paid surfaces must go
     * through Salla. A Stripe top-up is exactly the off-platform payment the
     * policy forbids, and the backend refuses it with SALLA_BILLED — this hides
     * it so they never reach that refusal.
     */
    it('is hidden for a Salla merchant (Article 5)', () => {
        render(<BuyTopUpCTA planSlug="business" sallaBilled />);
        expect(cta()).not.toBeInTheDocument();
    });

    it('still renders for a Salla-connected merchant who is exempt (sallaBilled false)', () => {
        render(<BuyTopUpCTA planSlug="business" sallaBilled={false} />);
        expect(cta()).toBeInTheDocument();
    });
});
