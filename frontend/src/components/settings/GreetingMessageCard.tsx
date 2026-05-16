import clsx from 'clsx';
import { MAX_TEMPLATE_MESSAGE_LENGTH } from '@jawab24/shared';
import { Card, InputFieldWrapper, CharCounter, Toggle } from '@/components/ui';
import { MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getLocaleDirection } from '@/utils/locale';
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
  const enabled = settings.greetingMessageEnabled ?? false;

  return (
    <Card className="border-none shadow-lg shadow-theme-border/50 p-4 landscape:p-3 h-full flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-3 landscape:mb-2">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl icon-bg-brand flex items-center justify-center shrink-0 landscape:w-9 landscape:h-9">
            <MessageCircle className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0 text-start">
            <h4 className="font-semibold text-foreground landscape:text-sm">{t('greetingMessage.title')}</h4>
            <p className="text-xs text-muted-foreground font-medium mt-0.5 landscape:hidden">{t('greetingMessage.desc')}</p>
          </div>
        </div>
        <Toggle
          enabled={enabled}
          onChange={(next) => setSettings({ ...settings, greetingMessageEnabled: next })}
          aria-label={t('greetingMessage.enabledLabel')}
        />
      </div>
      <InputFieldWrapper
        className={clsx('flex-1 transition-opacity duration-200', !enabled && 'opacity-50 pointer-events-none')}
        trailing={<CharCounter value={displayValue.length} max={maxChars} />}
      >
        <textarea
          aria-label={t('greetingMessage.title')}
          className={clsx(
            'w-full h-full bg-transparent border-none p-3 pe-14 rounded-2xl resize-none min-h-[120px]',
            'placeholder:text-muted-foreground placeholder:italic',
            'focus:outline-none focus:ring-0',
            currentLang === 'ar' && 'italic italic-arabic',
          )}
          rows={3}
          placeholder={placeholder}
          dir={displayValue ? 'auto' : getLocaleDirection(currentLang)}
          maxLength={maxChars}
          value={displayValue}
          disabled={!enabled}
          aria-disabled={!enabled}
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
