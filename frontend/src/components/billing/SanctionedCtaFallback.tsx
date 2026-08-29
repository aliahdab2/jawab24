import { useTranslations } from 'next-intl';
import { buildWhatsAppUrl, DEFAULT_SUPPORT_WHATSAPP_NUMBER } from '@/lib/whatsapp';

/**
 * Shown in place of a payment CTA when the user is in a sanctioned region
 * (Stripe legally can't process the charge). Offers a WhatsApp support link
 * instead. Shared by the public pricing grid (`PlanCard`) and the hidden
 * high-volume page (`ScalePlanCard`).
 *
 * It never names a local rail: both grids render this ONLY when
 * `useLocalPaymentRail` says the visitor has none (a Syrian merchant gets the
 * real payment CTA, which routes to the Sham Cash checkout instead), so a
 * "you can still pay via Sham Cash" line here could never be true.
 *
 * The WhatsApp message names pricing/payment deliberately: support answers one
 * number from several entry points, and a generic "I want to ask about
 * Jawab24" gives them no way to tell a billing question from a product one.
 */
export function SanctionedCtaFallback() {
  const t = useTranslations('payment');

  return (
    <div className="text-center p-3 bg-slate-50 dark:bg-surface-200 rounded-xl border border-theme-border">
      <p className="text-xs font-bold text-muted-foreground mb-1">{t('unavailable.message')}</p>
      <a
        href={buildWhatsAppUrl(DEFAULT_SUPPORT_WHATSAPP_NUMBER, t('unavailable.whatsappMessagePricing'))}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-brand-600 font-bold hover:underline"
      >
        {t('unavailable.supportLink')}
      </a>
    </div>
  );
}
