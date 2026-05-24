import { AlertCircle, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/lib/store';
import { isIOSNative } from '@/lib/capacitor';
import { buildWhatsAppUrl, DEFAULT_SUPPORT_WHATSAPP_NUMBER } from '@/lib/whatsapp';

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

    // App Store Guideline 3.1.1: no payment/upgrade steering (incl. WhatsApp routing) on iOS native.
    if (isIOSNative()) {
        return null;
    }

    const whatsappMessage = userEmail
        ? `Hi! I'd like to upgrade my Jawab24 account.\nEmail: ${userEmail}`
        : `Hi! I'd like to upgrade my Jawab24 account.`;
    const whatsappUrl = buildWhatsAppUrl(DEFAULT_SUPPORT_WHATSAPP_NUMBER, whatsappMessage);

    return (
        <div className="max-w-md mx-auto p-6 bg-slate-800/50 border border-slate-700 rounded-2xl">
            <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                    <AlertCircle className="w-6 h-6 text-slate-400" />
                </div>
                <div className="flex-1">
                    <h3 className="text-lg font-semibold text-white mb-2">
                        {t('unavailable.title')}
                    </h3>
                    <p className="text-slate-300 text-sm leading-relaxed mb-4">
                        {t('unavailable.message')}
                    </p>
                    
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
                    
                    <p className="text-slate-400 text-xs mt-4">
                        {t('unavailable.support')}
                    </p>
                </div>
            </div>
        </div>
    );
}
