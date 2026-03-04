import clsx from 'clsx';
import { Card, Textarea, Toggle } from '@/components/ui';
import { Sparkles, Check } from 'lucide-react';
import { useTranslation } from '@/i18n';
import type { SettingsCardProps } from './types';

const STYLES = ['professional', 'casual', 'enthusiastic'] as const;

export function ReplyStyleCard({ settings, setSettings }: SettingsCardProps) {
  const { t } = useTranslation();

  return (
    <Card className="border-none shadow-md shadow-theme-border/30 p-4 landscape:p-3">
      <div className="flex items-center gap-4 mb-4 landscape:mb-3">
        <div className="w-12 h-12 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center landscape:w-10 landscape:h-10">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="text-start">
          <h4 className="font-bold text-foreground text-lg landscape:text-base">{t('settings.replyStyle.title')}</h4>
          <p className="text-xs text-muted-foreground font-medium landscape:hidden">{t('settings.replyStyle.desc')}</p>
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
            {t(`settings.replyStyle.${style}`)}
          </button>
        ))}
      </div>

      {/* Brand voice notes */}
      <label htmlFor="brandVoiceNotes" className="block text-sm font-medium text-foreground/70 mb-1">
        {t('settings.replyStyle.brandVoice')}
      </label>
      <Textarea
        id="brandVoiceNotes"
        dir="auto"
        maxLength={500}
        rows={3}
        placeholder={t('settings.replyStyle.brandVoicePlaceholder')}
        value={settings.brandVoiceNotes}
        onChange={(e) => setSettings({ ...settings, brandVoiceNotes: e.target.value })}
        className="w-full text-sm border-theme-border bg-background focus:ring-2 focus:ring-brand-500"
      />
      <p className="text-xs text-muted-foreground mt-1 text-end">
        {settings.brandVoiceNotes.length}/500
      </p>

      {/* Hold low-confidence toggle */}
      <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-theme-border">
        <div className="text-start">
          <p className="text-sm font-medium text-foreground/70">{t('settings.replyStyle.holdLowConfidence')}</p>
          <p className="text-xs text-muted-foreground">{t('settings.replyStyle.holdLowConfidenceDesc')}</p>
        </div>
        <Toggle
          enabled={settings.holdLowConfidence}
          onChange={(v) => setSettings({ ...settings, holdLowConfidence: v })}
          aria-label={t('settings.replyStyle.holdLowConfidence')}
        />
      </div>
    </Card>
  );
}
