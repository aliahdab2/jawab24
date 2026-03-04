import clsx from 'clsx';
import {
  AlertTriangle,
  Check,
} from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import type { SettingsCardProps } from './types';

export function HandoffPauseCard({ settings, setSettings }: SettingsCardProps) {
  const { t } = useTranslation();

  const presets = [
    { value: 15, label: t('settings.duration15min' as TranslationKey) },
    { value: 30, label: t('settings.duration30min' as TranslationKey) },
    { value: 60, label: t('settings.duration1hr' as TranslationKey) },
    { value: 120, label: t('settings.duration2hr' as TranslationKey) },
    { value: 1440, label: t('settings.duration24hr' as TranslationKey) },
  ];

  return (
    <div className="rounded-2xl border-s-4 border-amber-400 alert-warning p-5 landscape:p-3 shadow-md">
      <div className="flex items-center gap-4 mb-4 landscape:mb-3">
        <div className="w-12 h-12 rounded-2xl icon-bg-amber flex items-center justify-center landscape:w-10 landscape:h-10 landscape:rounded-xl">
          <AlertTriangle className="w-6 h-6 landscape:w-5 landscape:h-5" />
        </div>
        <div className="text-start">
          <h3 className="font-bold text-foreground text-base landscape:text-sm">{t('settings.handoffPause.title')}</h3>
          <p className="text-xs text-amber-700 dark:text-amber-300 font-bold">{t('settings.handoffPause.warning' as TranslationKey)}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground font-medium mb-3">{t('settings.handoffPause.desc')}</p>
      <div className="flex flex-wrap gap-2">
        {presets.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setSettings({ ...settings, handoffPauseDurationMinutes: opt.value })}
            className={clsx(
              'px-4 py-3 rounded-xl text-sm font-bold transition-all border min-h-[44px] flex items-center gap-1.5',
              'active:scale-[0.98] hover:shadow-md',
              settings.handoffPauseDurationMinutes === opt.value
                ? 'bg-amber-500 text-white border-amber-600 shadow-lg hover:bg-amber-600'
                : 'bg-card text-muted-foreground border-theme-border hover:bg-muted hover:border-surface-300'
            )}
          >
            {settings.handoffPauseDurationMinutes === opt.value && <Check className="w-3.5 h-3.5" />}
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
