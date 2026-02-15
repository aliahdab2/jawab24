import { useState } from 'react';
import clsx from 'clsx';
import { useTranslation, type TranslationKey } from '@/i18n';

const LANG_LABEL_KEY: Record<'ar' | 'en', TranslationKey> = {
  ar: 'common.langArabic',
  en: 'common.langEnglish',
};

interface MultilingualTextareaProps {
  valueAr: string;
  valueEn: string;
  onChange: (language: 'ar' | 'en', value: string) => void;
  onAutoTranslate: (fromLang: 'ar' | 'en') => Promise<void>;
  placeholder?: { ar: string; en: string };
  maxLength?: number;
  minHeight?: string;
  translating?: boolean;
}

export function MultilingualTextarea({
  valueAr,
  valueEn,
  onChange,
  onAutoTranslate,
  placeholder,
  maxLength,
  minHeight = 'min-h-[100px]',
  translating = false
}: MultilingualTextareaProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'ar' | 'en'>('ar');

  const currentValue = activeTab === 'ar' ? valueAr : valueEn;
  const otherLang = activeTab === 'ar' ? 'en' : 'ar';
  const otherValue = activeTab === 'ar' ? valueEn : valueAr;

  return (
    <div>
      {/* Language Tabs */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-1 p-1 bg-surface-100 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('ar')}
            className={clsx(
              'px-3 py-1.5 rounded-md text-sm font-bold transition-all',
              activeTab === 'ar'
                ? 'bg-white text-brand-600 shadow-sm'
                : 'text-surface-600 hover:text-surface-900'
            )}
          >
            {t('common.langArabic')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('en')}
            className={clsx(
              'px-3 py-1.5 rounded-md text-sm font-bold transition-all',
              activeTab === 'en'
                ? 'bg-white text-brand-600 shadow-sm'
                : 'text-surface-600 hover:text-surface-900'
            )}
          >
            {t('common.langEnglish')}
          </button>
        </div>

        {/* Auto-translate button */}
        {currentValue && !otherValue && (
          <button
            type="button"
            onClick={() => onAutoTranslate(activeTab)}
            disabled={translating}
            className="text-xs text-brand-600 hover:text-brand-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {translating ? t('common.loading') : `↗ ${t('settings.autoTranslateTo')} ${t(LANG_LABEL_KEY[otherLang])}`}
          </button>
        )}
      </div>

      {/* Textarea */}
      <textarea
        dir={activeTab === 'ar' ? 'rtl' : 'ltr'}
        value={currentValue}
        onChange={(e) => onChange(activeTab, e.target.value)}
        placeholder={placeholder?.[activeTab]}
        maxLength={maxLength}
        className={clsx(
          'input w-full border-none bg-surface-50 focus:ring-2 focus:ring-brand-500 p-4 rounded-xl',
          minHeight,
          activeTab === 'ar' && 'italic-arabic'
        )}
      />

      {/* Character count */}
      {maxLength && (
        <p className={clsx(
          'text-xs mt-1 text-end',
          currentValue.length > maxLength * 0.9 ? 'text-orange-600' : 'text-surface-400'
        )}>
          {currentValue.length} / {maxLength}
        </p>
      )}
    </div>
  );
}
