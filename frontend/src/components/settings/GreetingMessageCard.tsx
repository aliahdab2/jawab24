import clsx from 'clsx';
import { MAX_TEMPLATE_MESSAGE_LENGTH } from '@jawab24/shared';
import { Card, InputFieldWrapper, CharCounter } from '@/components/ui';
import { MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SettingsCardProps } from './types';

export function GreetingMessageCard({ settings, setSettings }: SettingsCardProps) {
  const t = useTranslations('settings');

  const currentLang = settings.dashboardLanguage;
  const value = settings.greetingMessageMulti?.[currentLang] || '';
  const sourceLang = settings.greetingMessageMulti?.sourceLang;
  const isAutoTranslated = sourceLang && sourceLang !== 'manual' && sourceLang !== currentLang;
  const displayValue = isAutoTranslated ? '' : value;
  const placeholder = isAutoTranslated && value ? value : t('greetingMessagePlaceholder');
  const maxChars = MAX_TEMPLATE_MESSAGE_LENGTH;

  return (
    <Card className="border-none shadow-lg shadow-theme-border/50 p-5 landscape:p-3">
      <div className="flex items-center gap-4 mb-4 landscape:mb-2">
        <div className="w-12 h-12 rounded-xl icon-bg-brand flex items-center justify-center landscape:w-10 landscape:h-10">
          <MessageCircle className="w-4 h-4" aria-hidden="true" />
        </div>
        <div className="text-start">
          <h4 className="font-bold text-foreground text-lg landscape:text-base">{t('greetingMessage.title')}</h4>
          <p className="text-xs text-muted-foreground font-medium landscape:hidden">{t('greetingMessage.desc')}</p>
        </div>
      </div>
      <InputFieldWrapper trailing={<CharCounter value={displayValue.length} max={maxChars} />}>
        <textarea
          aria-label={t('greetingMessage.title')}
          className={clsx(
            'w-full bg-transparent border-none p-3 pe-14 rounded-2xl resize-none',
            'placeholder:text-muted-foreground placeholder:italic',
            'focus:outline-none focus:ring-0',
            currentLang === 'ar' && 'italic italic-arabic',
          )}
          rows={3}
          placeholder={placeholder}
          dir={displayValue ? 'auto' : undefined}
          maxLength={maxChars}
          value={displayValue}
          onChange={(e) => {
            const newValue = e.target.value;
            setSettings({
              ...settings,
              greetingMessageMulti: {
                ...settings.greetingMessageMulti,
                [currentLang]: newValue,
                sourceLang: currentLang,
              },
            });
          }}
        />
      </InputFieldWrapper>
    </Card>
  );
}
