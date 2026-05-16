import clsx from 'clsx';
import {
  AlertTriangle,
  Check,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui';
import type { SettingsCardProps } from './types';

export function HandoffPauseCard({ settings, setSettings }: SettingsCardProps) {
  const t = useTranslations('settings');

  const presets = [
    { value: 15, label: t('duration15min') },
    { value: 30, label: t('duration30min') },
    { value: 60, label: t('duration1hr') },
    { value: 120, label: t('duration2hr') },
    { value: 1440, label: t('duration24hr') },
  ];

  return (
    <Card padding="none" className="border-none shadow-md shadow-theme-border/30 p-5 landscape:p-3">
      <div className="flex items-center gap-4 mb-4 landscape:mb-3">
        <div className="w-12 h-12 rounded-2xl icon-bg-amber flex items-center justify-center landscape:w-10 landscape:h-10 landscape:rounded-xl">
          <AlertTriangle className="w-6 h-6 landscape:w-5 landscape:h-5" />
        </div>
        <div className="text-start">
          <h3 className="font-bold text-foreground text-base landscape:text-sm">{t('handoffPause.title')}</h3>
          <p className="text-xs text-amber-700 dark:text-amber-300 font-bold">{t('handoffPause.warning')}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground font-medium mb-3">{t('handoffPause.desc')}</p>
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
    </Card>
  );
}
