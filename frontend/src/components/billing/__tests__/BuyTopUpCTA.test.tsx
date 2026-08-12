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
        render(<BuyTopUpCTA planSlug="business" marketplaceBilled />);
        expect(cta()).not.toBeInTheDocument();
    });

    /**
     * The reason the prop was generalized: a Zid merchant used to fall through
     * both old checks (`paymentMethod === 'shopify'` and `sallaBilled`) and see
     * a CTA whose only possible ending was a 400 `ZID_BILLED`.
     */
    it('is hidden for a Zid merchant (App Market)', () => {
        render(<BuyTopUpCTA planSlug="business" paymentMethod="zid" marketplaceBilled />);
        expect(cta()).not.toBeInTheDocument();
    });

    it('still renders for a marketplace-connected merchant who is exempt (marketplaceBilled false)', () => {
        render(<BuyTopUpCTA planSlug="business" marketplaceBilled={false} />);
        expect(cta()).toBeInTheDocument();
    });
});
