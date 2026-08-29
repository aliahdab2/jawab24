import { PauseCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui';
import { TitleWithInfo } from './TitleWithInfo';
import { DurationPresetPicker } from './DurationPresetPicker';
import type { SettingsCardProps } from './types';

export function HandoffPauseCard({ settings, setSettings }: SettingsCardProps) {
  const t = useTranslations('settings');

  const presets = [
    // 5 is the floor the shared schema already enforces (settings.ts: min(5)).
    // Offered because the pause window is ROLLING — every new manual reply
    // re-arms it — so a short window never expires mid-handoff: it only ends
    // once the merchant has actually gone quiet for the full duration.
    { value: 5, label: t('duration5min') },
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
      {/* The window is ROLLING — it restarts on every manual reply — and nothing
          on this card said so. A merchant reading only the chip concludes the AI
          is muted from the moment he touches the conversation, when it is really
          muted from the moment he STOPS. Stated inline rather than behind the (i)
          because that misreading is what a support case turned on (D-109: make
          the pause clearer, not different). `select` and not `plural`: the labels
          switch unit (minutes → hours) and Arabic needs «ساعتين» here, not the
          «ساعتان» the chip shows. */}
      <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
        {t('handoffPause.resumeNote', { minutes: String(settings.handoffPauseDurationMinutes) })}
      </p>
    </Card>
  );
}
