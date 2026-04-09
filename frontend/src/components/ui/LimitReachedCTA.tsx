import Link from 'next/link';
import { Capacitor } from '@capacitor/core';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { openExternalUrl } from '@/lib/openExternalUrl';
import { BRAND_ASSETS } from '@/constants/brand';

/**
 * Shown below the AI generate button when the user has hit their monthly reply limit.
 * Renders a "Limit Reached — Upgrade" inline link.
 * Handles web (Next.js Link) and native (external browser) routing.
 */
export function LimitReachedCTA() {
  const tPricing = useTranslations('pricing');
  const locale = useLocale();
  const isNative = Capacitor.isNativePlatform();

  return (
    <div className="flex items-center gap-1 mt-1">
      <span className="text-xs text-muted-foreground">{tPricing('limitReached')} —</span>
      {isNative ? (
        <button
          onClick={() => openExternalUrl(`${BRAND_ASSETS.urls.base}${locale === 'en' ? '/en' : ''}/pricing`)}
          className="text-xs text-brand-600 font-bold hover:underline"
        >
          {tPricing('upgrade')}
        </button>
      ) : (
        <Link href="/pricing" className="text-xs text-brand-600 font-bold hover:underline">
          {tPricing('upgrade')}
        </Link>
      )}
    </div>
  );
}
