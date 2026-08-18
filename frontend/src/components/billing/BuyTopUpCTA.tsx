import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PlusCircle } from 'lucide-react';
// Direct import, NOT the '@/components/ui' barrel — this CTA renders on the
// public /pricing/scale page. See components/layout/PublicLayout.tsx.
import { Button } from '@/components/ui/Button';
import { isIOSNative } from '@/lib/capacitor';
import { TopUpRequestModal } from './TopUpRequestModal';

interface BuyTopUpCTAProps {
    /** Pre-fills the WhatsApp message body so support knows who to credit. */
    userEmail?: string;
    /** Free plan users can't buy top-ups — hides the CTA entirely. */
    planSlug?: string;
    paymentMethod?: string;
    /**
     * True when a MARKETPLACE owns this account's paid plans (D-073) — Shopify
     * App Pricing, Salla Article 5, or the Zid App Market. Every Stripe top-up
     * surface is hidden, because the backend refuses them all with a 400.
     *
     * Replaces the old `sallaBilled` + `paymentMethod === 'shopify'` pair, which
     * knew nothing about Zid and so showed a Zid merchant a CTA that could only
     * end in a generic error.
     */
    marketplaceBilled?: boolean;
    /** Override default 'primary' button variant. */
    variant?: 'primary' | 'secondary';
    size?: 'sm' | 'md';
}

/**
 * "Add replies" CTA that opens the TopUpRequestModal.
 *
 * Hidden when:
 *   - User is on iOS native (App Store Guideline 3.1.1: no in-app billing UI)
 *   - User is on the Free plan (must subscribe first before topping up)
 *   - The workspace is Shopify-billed (D-G: no Stripe surfaces beside
 *     Shopify-managed billing)
 *   - The merchant came from Salla (Article 5: paid plans must be billed
 *     through Salla, so no Stripe top-up either)
 */
export function BuyTopUpCTA({ userEmail, planSlug, paymentMethod, marketplaceBilled, variant = 'primary', size = 'sm' }: BuyTopUpCTAProps) {
    const t = useTranslations('topup');
    const [isOpen, setIsOpen] = useState(false);

    if (isIOSNative()) return null;
    if (planSlug === 'free') return null;
    // Kept alongside marketplaceBilled: a shopify mirror is a marketplace by
    // definition, but this also covers a stale/undefined summary where the
    // payment method is the only signal we have.
    if (paymentMethod === 'shopify') return null;
    if (marketplaceBilled) return null;

    return (
        <>
            <Button
                variant={variant}
                size={size}
                icon={<PlusCircle className="w-4 h-4" aria-hidden="true" />}
                onClick={() => setIsOpen(true)}
            >
                {t('cta.buyAddReplies')}
            </Button>
            <TopUpRequestModal
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                userEmail={userEmail}
            />
        </>
    );
}
