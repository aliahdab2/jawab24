import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Globe } from 'lucide-react';
import { detectTimezone, formatTimeInZone, getTimezoneOptions } from '@jawab24/shared';
import { Card, Select } from '@/components/ui';
import { TitleWithInfo } from './TitleWithInfo';
import type { SettingsCardProps } from './types';

interface TimezoneCardProps extends SettingsCardProps {
  currentTime: Date;
}

/**
 * Workspace timezone — a General setting, deliberately NOT inside the reply
 * schedule card.
 *
 * It used to live in `BusinessHoursCard`, which put it in the wrong place three
 * times over: disabled whenever that card's toggle was off, buried inside the
 * Advanced section (collapsed by default), and framed as if it only governed
 * that one feature. It governs every time-based behaviour in the product — the
 * AI's "today's date" line, the Post-Reply hours gate, the reply schedule, and
 * the working hours quoted to customers from /business — so a wrong value
 * silently shifts all of them.
 *
 * Sits with dashboard language: same class of setting (how this workspace is
 * configured), same always-visible placement. One value, one home (D-043);
 * everything else shows it read-only and links here.
 */
export function TimezoneCard({ settings, setSettings, currentTime }: TimezoneCardProps) {
  const t = useTranslations('settings');

  // Derived once per stored/detected zone rather than per render: the full IANA
  // list is ~400 entries and each label formats an offset.
  const detectedTimezone = useMemo(() => detectTimezone(), []);
  const timezoneOptions = useMemo(
    () => getTimezoneOptions([settings.timezone, detectedTimezone]),
    [settings.timezone, detectedTimezone],
  );
  const nowTime = formatTimeInZone(settings.timezone, currentTime);

  return (
    <Card className="border-none shadow-md shadow-surface-200/30 p-4 landscape:p-3">
      <TitleWithInfo info={t('businessHours.timezoneInfo')} infoLabel={t('businessHours.timezone')}>
        <label
          id="business-hours-timezone-label"
          // Deep-link target (the /business working-hours sheet links here).
          // scroll-mt clears the fixed mobile top bar (h-14 sm:h-16) that the
          // content scrolls under; on lg that bar doesn't exist.
          className="block scroll-mt-20 lg:scroll-mt-6 text-[10px] font-bold text-muted-foreground uppercase tracking-widest"
        >
          {t('businessHours.timezone')}
        </label>
      </TitleWithInfo>
      <div className="mb-1.5" />
      <Select
        aria-labelledby="business-hours-timezone-label"
        value={settings.timezone}
        onChange={(val) => setSettings({ ...settings, timezone: val })}
        options={timezoneOptions}
        searchable
        searchPlaceholder={t('businessHours.timezoneSearch')}
        noResultsLabel={t('businessHours.timezoneNoResults')}
        className="!py-3 font-bold border-none bg-card shadow-sm"
      />
      <div className="flex items-center gap-1.5 mt-2">
        <Globe className="w-3.5 h-3.5 text-icon-muted flex-shrink-0" aria-hidden="true" />
        <p className="text-[11px] text-muted-foreground font-medium">
          {t('businessHours.localTimeNow', { time: nowTime })}
        </p>
      </div>
    </Card>
  );
}
