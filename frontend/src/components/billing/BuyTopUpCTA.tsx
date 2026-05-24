import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui';
import { isIOSNative } from '@/lib/capacitor';
import { TopUpRequestModal } from './TopUpRequestModal';

interface BuyTopUpCTAProps {
    /** Pre-fills the WhatsApp message body so support knows who to credit. */
    userEmail?: string;
    /** Free plan users can't buy top-ups — hides the CTA entirely. */
    planSlug?: string;
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
 */
export function BuyTopUpCTA({ userEmail, planSlug, variant = 'primary', size = 'sm' }: BuyTopUpCTAProps) {
    const t = useTranslations('topup');
    const [isOpen, setIsOpen] = useState(false);

    if (isIOSNative()) return null;
    if (planSlug === 'free') return null;

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
