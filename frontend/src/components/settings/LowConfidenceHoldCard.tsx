import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, Toggle } from '@/components/ui';
import { TitleWithInfo } from './TitleWithInfo';
import type { SettingsCardProps } from './types';

export function LowConfidenceHoldCard({ settings, setSettings }: SettingsCardProps) {
  const t = useTranslations('settings');

  return (
    <Card padding="none" className="border-none shadow-md shadow-theme-border/30 p-5 landscape:p-3">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl icon-bg-brand flex items-center justify-center landscape:w-10 landscape:h-10 landscape:rounded-xl shrink-0">
          <ShieldCheck className="w-6 h-6 landscape:w-5 landscape:h-5" />
        </div>
        <div className="flex-1 text-start">
          <div className="flex items-center justify-between gap-3 mb-1">
            <TitleWithInfo
              info={t('replyStyle.holdLowConfidenceInfo')}
              infoLabel={t('replyStyle.holdLowConfidence')}
            >
              <h3 className="font-bold text-foreground text-base landscape:text-sm">
                {t('replyStyle.holdLowConfidence')}
              </h3>
            </TitleWithInfo>
            <Toggle
              enabled={settings.holdLowConfidence}
              onChange={(v) => setSettings({ ...settings, holdLowConfidence: v })}
              aria-label={t('replyStyle.holdLowConfidence')}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t('replyStyle.holdLowConfidenceDesc')}
          </p>
        </div>
      </div>
    </Card>
  );
}
