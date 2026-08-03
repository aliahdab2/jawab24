import { useTranslations } from 'next-intl';
import { getCachedGeoCountry, hasLocalPaymentAlternative } from '@/utils/geoCheck';

/**
 * "You can still pay via <local rail>" line for a blocked region that has one
 * (today: Syria → Sham Cash).
 *
 * Owns the whole decision — resolve the country, apply the predicate, pick the
 * string — so the two sanctioned surfaces (`SanctionedCtaFallback` on the
 * pricing grid, `PaymentsUnavailableNotice` on checkout, plus any upgrade modal
 * that adopts it later) cannot drift apart. They differ only in typography,
 * which is what `className` is for.
 *
 * Renders nothing when the country is unknown. That is not a fallback, it is
 * the rule: `isUserSanctioned()` fails CLOSED, so a merchant can be blocked
 * without us ever resolving where they are, and naming a payment rail there
 * would send someone to a method they cannot use.
 */
export function LocalPaymentAlternativeNote({ className }: { className?: string }) {
  const t = useTranslations('payment');

  if (!hasLocalPaymentAlternative(getCachedGeoCountry())) {
    return null;
  }

  return <p className={className}>{t('unavailable.localAlternative')}</p>;
}
