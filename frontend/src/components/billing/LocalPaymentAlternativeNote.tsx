import { useTranslations } from 'next-intl';
import { getCachedGeoCountry, hasLocalPaymentAlternative } from '@/utils/geoCheck';

/**
 * "You can still pay via <local rail>" line for a blocked region that has one
 * (today: Syria → Sham Cash).
 *
 * Its one consumer is `PaymentsUnavailableNotice`, which still reaches a
 * Syrian merchant in the cases the self-serve panel cannot serve — a reply
 * top-up (a claim is filed against a plan), a plan that failed to load, or the
 * rail switched off — where "contact support" is the honest next step. The
 * pricing grids no longer render it: there a Syrian merchant gets the real
 * payment CTA, which routes to the Sham Cash checkout.
 *
 * Owns the whole decision — resolve the country, apply the predicate, pick the
 * string — so a second consumer cannot drift from the first; `className` is
 * for typography only.
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
