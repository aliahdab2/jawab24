import { useState } from 'react';
import clsx from 'clsx';
import { Card, Toggle } from '@/components/ui';
import { Sparkles, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SettingsCardProps } from './types';

const STYLES = ['professional', 'casual', 'enthusiastic'] as const;

export function ReplyStyleCard({ settings, setSettings }: SettingsCardProps) {
  const t = useTranslations('settings');
  const currentLangForVoice = settings.dashboardLanguage;
  const hasSavedVoiceNotes = !!(settings.brandVoiceNotesMulti?.[currentLangForVoice]);
  const [voiceNotesOpen, setVoiceNotesOpen] = useState(hasSavedVoiceNotes);

  return (
    <Card className="border-none shadow-md shadow-theme-border/30 p-4 landscape:p-3">
      <div className="flex items-center gap-4 mb-4 landscape:mb-3">
        <div className="w-12 h-12 rounded-xl icon-bg-brand flex items-center justify-center landscape:w-10 landscape:h-10">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="text-start">
          <h4 className="font-bold text-foreground text-lg landscape:text-base">{t('replyStyle.title')}</h4>
          <p className="text-xs text-muted-foreground font-medium landscape:hidden">{t('replyStyle.desc')}</p>
        </div>
      </div>

      {/* Style options */}
      <div className="flex gap-2 flex-wrap mb-4">
        {STYLES.map((style) => (
          <button
            key={style}
            onClick={() => setSettings({ ...settings, replyStyle: style })}
            className={clsx(
              'px-4 py-3 text-sm font-medium rounded-lg transition-all min-h-[44px] active:scale-[0.98] flex items-center gap-1.5',
              settings.replyStyle === style
                ? 'bg-brand-500 text-white shadow-lg hover:bg-brand-600'
                : 'bg-muted text-muted-foreground border border-theme-border hover:bg-muted/80 hover:shadow-md',
            )}
          >
            {settings.replyStyle === style && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic key from style list */}
            {t(`replyStyle.${style}` as any)}
          </button>
        ))}
      </div>

      {/* Brand voice notes (multi-language) — progressive disclosure */}
      <button
        type="button"
        onClick={() => setVoiceNotesOpen(!voiceNotesOpen)}
        className="text-sm font-medium text-brand-500 dark:text-brand-400 hover:text-brand-600 dark:hover:text-brand-300 transition-colors cursor-pointer min-h-[44px] flex items-center"
      >
        {voiceNotesOpen ? t('replyStyle.hideBrandVoice') : t('replyStyle.addBrandVoice')}
      </button>
      <div
        className={clsx(
          "overflow-hidden transition-all duration-300 ease-in-out",
          voiceNotesOpen ? 'max-h-[400px] opacity-100 pb-1' : 'max-h-0 opacity-0'
        )}
      >
        {(() => {
          const currentLang = settings.dashboardLanguage;
          const value = settings.brandVoiceNotesMulti?.[currentLang] || '';
          const sourceLang = settings.brandVoiceNotesMulti?.sourceLang;
          const isAutoTranslated = !!(sourceLang && sourceLang !== 'manual' && sourceLang !== 'default' && sourceLang !== currentLang && value);

          return (
            <>
              <label htmlFor="brandVoiceNotes" className="sr-only">
                {t('replyStyle.brandVoice')}
              </label>
              {isAutoTranslated && (
                <p className="text-xs text-muted-foreground mb-1">
                  {t('replyStyle.autoTranslated')}
                </p>
              )}
              <textarea
                id="brandVoiceNotes"
                aria-label={t('replyStyle.brandVoice')}
                className={clsx(
                  'input min-h-[56px] landscape:min-h-[44px] border-none bg-background focus:ring-2 focus:ring-brand-500 p-3 rounded-2xl placeholder:text-muted-foreground placeholder:italic',
                  isAutoTranslated && 'text-muted-foreground italic',
                  currentLang === 'ar' && 'italic-arabic',
                )}
                dir="auto"
                maxLength={500}
                rows={3}
                placeholder={t('replyStyle.brandVoicePlaceholder')}
                value={value}
                onChange={(e) => {
                  const newValue = e.target.value;
                  setSettings({
                    ...settings,
                    brandVoiceNotesMulti: {
                      ...settings.brandVoiceNotesMulti,
                      [currentLang]: newValue,
                      sourceLang: currentLang,
                    },
                  });
                }}
              />
              <p className="text-xs text-muted-foreground mt-1 text-end">
                {value.length}/500
              </p>
            </>
          );
        })()}
      </div>

      {/* Hold low-confidence toggle */}
      <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-theme-border">
        <div className="text-start">
          <p className="text-sm font-medium text-foreground/70">{t('replyStyle.holdLowConfidence')}</p>
          <p className="text-xs text-muted-foreground">{t('replyStyle.holdLowConfidenceDesc')}</p>
        </div>
        <Toggle
          enabled={settings.holdLowConfidence}
          onChange={(v) => setSettings({ ...settings, holdLowConfidence: v })}
          aria-label={t('replyStyle.holdLowConfidence')}
        />
      </div>
    </Card>
  );
}
