import { AlertCircle, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/lib/store';
import { isIOSNative } from '@/lib/capacitor';
import { buildWhatsAppUrl, DEFAULT_SUPPORT_WHATSAPP_NUMBER } from '@/lib/whatsapp';
import { getCachedGeoCountry, hasLocalPaymentAlternative } from '@/utils/geoCheck';

/**
 * PaymentsUnavailableNotice Component
 * 
 * Displays a neutral message when payments are not available
 * due to geographic restrictions (sanctions compliance).
 * 
 * Includes a WhatsApp button with pre-filled email for manual upgrade requests.
 * 
 * Used in:
 * - Pricing page
 * - Checkout page
 * - Any upgrade modals
 */
export function PaymentsUnavailableNotice() {
    const t = useTranslations('payment');
    const { user } = useAuthStore();
    const userEmail = user?.email || '';
    const country = getCachedGeoCountry();

    // App Store Guideline 3.1.1: no payment/upgrade steering (incl. WhatsApp routing) on iOS native.
    if (isIOSNative()) {
        return null;
    }

    // Translated, and it names payment explicitly — support answers one number
    // from several entry points and needs to know which one this came from.
    const whatsappMessage = userEmail
        ? `${t('unavailable.whatsappMessageCheckout')}\n${t('unavailable.whatsappEmailLine', { email: userEmail })}`
        : t('unavailable.whatsappMessageCheckout');
    const whatsappUrl = buildWhatsAppUrl(DEFAULT_SUPPORT_WHATSAPP_NUMBER, whatsappMessage);

    return (
        <div className="max-w-md mx-auto p-6 bg-card border border-theme-border rounded-2xl shadow-sm">
            <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                    <AlertCircle className="w-6 h-6 text-muted-foreground" />
                </div>
                <div className="flex-1">
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                        {t('unavailable.title')}
                    </h3>
                    <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                        {t('unavailable.message')}
                    </p>

                    {/* Region-specific rail (Syria → Sham Cash). Hidden when the
                        country is unknown — never guess a merchant into a
                        payment method they can't use. */}
                    {hasLocalPaymentAlternative(country) && (
                        <p className="text-foreground text-sm leading-relaxed mb-4 font-medium">
                            {t('unavailable.localAlternative')}
                        </p>
                    )}

                    {/* WhatsApp Contact Button - Pre-fills user's email */}
                    <a
                        href={whatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors text-sm shadow-lg shadow-green-900/30"
                    >
                        <MessageCircle className="w-4 h-4" />
                        {t('unavailable.contactWhatsApp')}
                    </a>
                    
                    <p className="text-subtle text-xs mt-4">
                        {t('unavailable.support')}
                    </p>
                </div>
            </div>
        </div>
    );
}
