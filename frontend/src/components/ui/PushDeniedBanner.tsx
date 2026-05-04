import { Capacitor } from '@capacitor/core';
import { BellOff, X } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { isRTLLocale } from '@/utils/locale';

interface PushDeniedBannerProps {
  onDismiss: () => void;
}

export function PushDeniedBanner({ onDismiss }: PushDeniedBannerProps) {
  const t = useTranslations('notifications');
  const locale = useLocale();
  // iOS settings path differs from Android — Capacitor.getPlatform() returns
  // 'ios' | 'android' | 'web'. Banner only shows on native platforms (gated
  // by shouldShowPushDeniedBanner), so 'web' fall-through is unreachable.
  const platformBodyKey = Capacitor.getPlatform() === 'ios' ? 'deniedBanner.bodyIos' : 'deniedBanner.bodyAndroid';

  return (
    <div
      className="fixed bottom-6 inset-x-4 sm:inset-x-auto sm:end-6 sm:max-w-sm z-50"
      dir={isRTLLocale(locale) ? 'rtl' : 'ltr'}
      role="status"
      aria-live="polite"
    >
      <div className="relative bg-card rounded-2xl shadow-xl border border-theme-border/60 p-4">
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('deniedBanner.dismiss')}
          className="absolute top-3 end-3 p-1.5 rounded-full text-icon-muted hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <div className="flex items-start gap-3 pe-6">
          <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center flex-shrink-0">
            <BellOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground mb-1">
              {t('deniedBanner.title')}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t(platformBodyKey)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
