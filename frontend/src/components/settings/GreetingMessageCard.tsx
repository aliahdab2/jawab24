import { Card } from '@/components/ui';
import { MessageCircle } from 'lucide-react';
import { useTranslation } from '@/i18n';
import type { SettingsCardProps } from './types';

export function GreetingMessageCard({ settings, setSettings }: SettingsCardProps) {
  const { t } = useTranslation();

  const currentLang = settings.dashboardLanguage;
  const value = settings.greetingMessageMulti?.[currentLang] || '';
  const sourceLang = settings.greetingMessageMulti?.sourceLang;
  const isAutoTranslated = sourceLang && sourceLang !== 'manual' && sourceLang !== currentLang;
  const displayValue = isAutoTranslated ? '' : value;
  const placeholder = isAutoTranslated && value ? value : t('settings.greetingMessagePlaceholder');

  return (
    <Card className="border-none shadow-lg shadow-surface-200/50 p-5 landscape:p-3">
      <div className="flex items-center gap-4 mb-4 landscape:mb-2">
        <div className="w-12 h-12 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center landscape:w-10 landscape:h-10">
          <MessageCircle className="w-4 h-4" />
        </div>
        <div className="text-start">
          <h4 className="font-bold text-surface-900 text-lg landscape:text-base">{t('settings.greetingMessage.title')}</h4>
          <p className="text-xs text-surface-500 font-medium landscape:hidden">{t('settings.greetingMessage.desc')}</p>
        </div>
      </div>
      <textarea
        className={`input min-h-[56px] landscape:min-h-[44px] border-none bg-surface-50 focus:ring-2 focus:ring-brand-500 p-3 rounded-2xl placeholder:text-surface-400 placeholder:italic ${currentLang === 'ar' ? 'italic italic-arabic rtl' : 'ltr'}`}
        placeholder={placeholder}
        dir={currentLang === 'ar' ? "rtl" : "ltr"}
        value={displayValue}
        onChange={(e) => {
          const newValue = e.target.value;
          setSettings({
            ...settings,
            greetingMessageMulti: {
              ...settings.greetingMessageMulti,
              [currentLang]: newValue,
              sourceLang: currentLang
            }
          });
        }}
      />
    </Card>
  );
}
