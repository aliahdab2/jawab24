import { PauseCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui';
import { TitleWithInfo } from './TitleWithInfo';
import { DurationPresetPicker } from './DurationPresetPicker';
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
      {/* Neutral treatment: this is a feature (auto-reply pauses while you take
          over), not a warning — so a calm muted icon/text, not amber. */}
      <div className="flex items-center gap-4 mb-4 landscape:mb-3">
        <div className="w-12 h-12 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center landscape:w-10 landscape:h-10 landscape:rounded-xl">
          <PauseCircle className="w-6 h-6 landscape:w-5 landscape:h-5" />
        </div>
        <div className="text-start">
          <TitleWithInfo info={t('handoffPause.info')} infoLabel={t('handoffPause.title')}>
            <h3 className="font-bold text-foreground text-base landscape:text-sm">{t('handoffPause.title')}</h3>
          </TitleWithInfo>
          <p className="text-xs text-muted-foreground font-semibold">{t('handoffPause.warning')}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground font-medium mb-3">{t('handoffPause.desc')}</p>
      <DurationPresetPicker
        options={presets}
        value={settings.handoffPauseDurationMinutes}
        onChange={(v) => setSettings({ ...settings, handoffPauseDurationMinutes: v })}
        size="md"
        ariaLabel={t('handoffPause.title')}
      />
    </Card>
  );
}
