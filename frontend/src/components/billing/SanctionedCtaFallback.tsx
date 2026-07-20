import { useTranslations } from 'next-intl';
import { buildWhatsAppUrl, DEFAULT_SUPPORT_WHATSAPP_NUMBER } from '@/lib/whatsapp';

/**
 * Shown in place of a payment CTA when the user is in a sanctioned region
 * (Stripe legally can't process the charge). Offers a WhatsApp support link
 * instead. Shared by the public pricing grid (`PlanCard`) and the hidden
 * high-volume page (`ScalePlanCard`).
 */
export function SanctionedCtaFallback() {
  const tPayment = useTranslations('payment');
  const tLanding = useTranslations('landing');

  return (
    <div className="text-center p-3 bg-slate-50 dark:bg-surface-200 rounded-xl border border-theme-border">
      <p className="text-xs font-bold text-muted-foreground mb-1">{tPayment('unavailable.message')}</p>
      <a
        href={buildWhatsAppUrl(DEFAULT_SUPPORT_WHATSAPP_NUMBER, tLanding('footer.whatsappMessage'))}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-brand-600 font-bold hover:underline"
      >
        {tPayment('unavailable.supportLink')}
      </a>
    </div>
  );
}
