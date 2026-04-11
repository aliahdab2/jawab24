import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { Capacitor } from '@capacitor/core';
import { openExternalUrl } from '@/lib/openExternalUrl';

/**
 * Upgrade CTA shown when a plan limit is reached.
 * On web: renders a Next.js Link to /pricing.
 * On native: opens the pricing page in an external browser.
 */
export function LimitReachedCTA({ className }: { className?: string }) {
    const t = useTranslations('subscription');
    const locale = useLocale();

    if (Capacitor.isNativePlatform()) {
        return (
            <button
                className={className}
                onClick={() => openExternalUrl(`https://jawab24.com/${locale}/pricing`)}
            >
                {t('upgradePlan')}
            </button>
        );
    }

    return (
        <Link href="/pricing" className={className}>
            {t('upgradePlan')}
        </Link>
    );
}
