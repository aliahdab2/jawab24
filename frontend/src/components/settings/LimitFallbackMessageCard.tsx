import clsx from 'clsx';
import { MAX_TEMPLATE_MESSAGE_LENGTH } from '@jawab24/shared';
import { Card } from '@/components/ui';
import { MessageSquareOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SettingsCardProps } from './types';

export function LimitFallbackMessageCard({ settings, setSettings }: SettingsCardProps) {
  const t = useTranslations('settings');

  const currentLang = settings.dashboardLanguage;
  const value = settings.limitFallbackMessageMulti?.[currentLang] || '';
  const sourceLang = settings.limitFallbackMessageMulti?.sourceLang;
  const isAutoTranslated = sourceLang && sourceLang !== 'manual' && sourceLang !== currentLang;
  const displayValue = isAutoTranslated ? '' : value;
  const placeholder = isAutoTranslated && value ? value : t('limitFallbackMessagePlaceholder');
  const maxChars = MAX_TEMPLATE_MESSAGE_LENGTH;

  return (
    <Card className="border-none shadow-lg shadow-theme-border/50 p-5 landscape:p-3">
      <div className="flex items-center gap-4 mb-4 landscape:mb-2">
        <div className="w-12 h-12 rounded-xl icon-bg-brand flex items-center justify-center landscape:w-10 landscape:h-10">
          <MessageSquareOff className="w-4 h-4" />
        </div>
        <div className="text-start">
          <h4 className="font-bold text-foreground text-lg landscape:text-base">{t('limitFallbackMessage.title')}</h4>
          <p className="text-xs text-muted-foreground font-medium landscape:hidden">{t('limitFallbackMessage.desc')}</p>
        </div>
      </div>
      <textarea
        aria-label={t('limitFallbackMessage.title')}
        className={`input min-h-[56px] landscape:min-h-[44px] border-none bg-background focus:ring-2 focus:ring-brand-500 p-3 rounded-2xl placeholder:text-muted-foreground placeholder:italic ${currentLang === 'ar' ? 'italic italic-arabic' : ''}`}
        placeholder={placeholder}
        dir={displayValue ? 'auto' : undefined}
        maxLength={maxChars}
        value={displayValue}
        onChange={(e) => {
          const newValue = e.target.value;
          setSettings({
            ...settings,
            limitFallbackMessageMulti: {
              ...settings.limitFallbackMessageMulti,
              [currentLang]: newValue,
              sourceLang: currentLang
            }
          });
        }}
      />
      <p className={clsx(
        'text-xs mt-1 text-end font-medium',
        displayValue.length > maxChars * 0.9 ? 'text-red-500' : 'text-muted-foreground',
      )}>
        {displayValue.length}/{maxChars}
      </p>
    </Card>
  );
}
