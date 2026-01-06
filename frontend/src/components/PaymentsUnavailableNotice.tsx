import { AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n';

/**
 * PaymentsUnavailableNotice Component
 * 
 * Displays a neutral message when payments are not available
 * due to geographic restrictions (sanctions compliance).
 * 
 * Used in:
 * - Pricing page
 * - Checkout page
 * - Any upgrade modals
 */
export function PaymentsUnavailableNotice() {
    const { t } = useTranslation();

    return (
        <div className="max-w-md mx-auto p-6 bg-slate-800/50 border border-slate-700 rounded-lg">
            <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                    <AlertCircle className="w-6 h-6 text-slate-400" />
                </div>
                <div className="flex-1">
                    <h3 className="text-lg font-semibold text-white mb-2">
                        {t('payment.unavailable.title')}
                    </h3>
                    <p className="text-slate-300 text-sm leading-relaxed mb-4">
                        {t('payment.unavailable.message')}
                    </p>
                    <p className="text-slate-400 text-xs">
                        {t('payment.unavailable.support')}
                    </p>
                </div>
            </div>
        </div>
    );
}
