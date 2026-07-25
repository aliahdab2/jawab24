import clsx from 'clsx';
import { useMemo } from 'react';
import {
  MAX_TEMPLATE_MESSAGE_LENGTH,
  PLACEHOLDER_TIMEZONE,
  detectTimezone,
  formatTimeInZone,
  getTimezoneOptions,
} from '@jawab24/shared';
import { Card, Toggle, Select, InputFieldWrapper, CharCounter } from '@/components/ui';
import {
  Clock,
  Zap,
  AlertTriangle,
  ArrowRight,
  Globe,
  Mail,
  Sun,
  Moon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { TitleWithInfo } from './TitleWithInfo';
import type { SettingsCardProps } from './types';

interface BusinessHoursCardProps extends SettingsCardProps {
  currentTime: Date;
}

export function BusinessHoursCard({ settings, setSettings, currentTime }: BusinessHoursCardProps) {
  const t = useTranslations('settings');

  const handleToggle = (enabled: boolean) => {
    const updates: Record<string, unknown> = { businessHoursOnly: enabled };
    if (enabled) {
      const defaultMsg = t('awayMessageDefault');
      const currentLang = settings.dashboardLanguage;
      if (!settings.awayMessageMulti?.[currentLang]) {
        updates.awayMessageMulti = {
          ...settings.awayMessageMulti,
          [currentLang]: defaultMsg
        };
      }
      // The schedule is meaningless without a timezone, and until now nothing ever
      // wrote one — merchants silently inherited the DB placeholder, so a Libyan
      // shop ran on Riyadh time and lost an hour every day. Switching the schedule
      // ON is the moment the value starts to matter, so seed it from this device.
      // Only ever applied when the stored value is still the untouched placeholder,
      // and the picker directly below shows the result — visible, not silent.
      const detected = detectTimezone();
      if (detected && settings.timezone === PLACEHOLDER_TIMEZONE) {
        updates.timezone = detected;
      }
    }
    setSettings({ ...settings, ...updates });
  };

  const timeSlots = Array.from({ length: 48 }, (_, i) => {
    const h = String(Math.floor(i / 2)).padStart(2, '0');
    const m = i % 2 === 0 ? '00' : '30';
    return { value: `${h}:${m}`, label: `${h}:${m}` };
  });

  const hasError = settings.businessHoursEnd <= settings.businessHoursStart;

  // Timezone options are derived once per stored/detected zone rather than per
  // render: the full IANA list is ~400 entries and each label formats an offset.
  const detectedTimezone = useMemo(() => detectTimezone(), []);
  const timezoneOptions = useMemo(
    () => getTimezoneOptions([settings.timezone, detectedTimezone]),
    [settings.timezone, detectedTimezone],
  );
  // Offered as a hint, never auto-applied: silently rewriting the stored zone from
  // whatever device happens to open Settings is how it became invisible to begin with.
  const timezoneMismatch = !!detectedTimezone && detectedTimezone !== settings.timezone;

  // Compute current status
  const nowTime = formatTimeInZone(settings.timezone, currentTime);
  const isActive = settings.businessHoursOnly && nowTime >= settings.businessHoursStart && nowTime < settings.businessHoursEnd;

  // Character limit for away messages (Messenger recommendation)
  const currentLang = settings.dashboardLanguage;
  const awayValue = settings.awayMessageMulti?.[currentLang] || '';
  const sourceLang = settings.awayMessageMulti?.sourceLang;
  const isAutoTranslated = sourceLang && sourceLang !== 'manual' && sourceLang !== currentLang;
  const displayValue = isAutoTranslated ? '' : awayValue;
  const placeholder = isAutoTranslated && awayValue ? awayValue : t('awayMessagePlaceholder');
  const maxChars = MAX_TEMPLATE_MESSAGE_LENGTH;

  return (
    <Card className="border-none shadow-md shadow-surface-200/30 p-4 landscape:p-3 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 landscape:mb-3">
        <div className="flex items-center gap-3">
          <div className={clsx(
            'w-10 h-10 rounded-xl flex items-center justify-center landscape:w-8 landscape:h-8',
            settings.businessHoursOnly ? 'icon-bg-brand' : 'bg-muted text-muted-foreground'
          )}>
            <Clock className="w-4 h-4" />
          </div>
          <div className="text-start">
            <TitleWithInfo info={t('businessHours.info')} infoLabel={t('businessHoursLabel')}>
              <h4 className="font-bold text-foreground text-lg landscape:text-base">{t('businessHoursLabel')}</h4>
            </TitleWithInfo>
            <p className="text-xs text-muted-foreground font-medium landscape:hidden">{t('businessHoursDesc')}</p>
          </div>
        </div>
        <Toggle enabled={settings.businessHoursOnly} onChange={handleToggle} aria-label={t('businessHoursLabel')} />
      </div>

      {/* Timezone — OUTSIDE the toggle-gated body on purpose. It is workspace
          level, not a business-hours setting: it drives the AI's "today's date"
          line, the Post-Reply hours gate, and the working hours on /business,
          all of which stay live when this card's toggle is off. Gating it meant
          a merchant who follows the hint from /business, or who simply never
          turned this feature on, landed on a control they could not touch.
          Placed above the schedule so it reads zone → hours. */}
      <div className="rounded-xl bg-muted border border-theme-border p-4 landscape:p-3 mb-4">
        <TitleWithInfo info={t('businessHours.timezoneInfo')} infoLabel={t('businessHours.timezone')}>
          <label
            id="business-hours-timezone-label"
            // scroll-mt: deep-link target (/business hours sheet). Mobile needs
            // to clear the fixed top bar (h-14 sm:h-16) the content scrolls
            // under; on lg that bar doesn't exist.
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
        {timezoneMismatch && detectedTimezone && (
          <button
            type="button"
            onClick={() => setSettings({ ...settings, timezone: detectedTimezone })}
            className="mt-2 text-[11px] font-semibold text-brand-600 hover:underline text-start"
          >
            {t('businessHours.useDetectedTimezone', { timezone: detectedTimezone.replace(/_/g, ' ') })}
          </button>
        )}
      </div>

      <div
        className={clsx(
          'space-y-4 transition-all duration-300',
          !settings.businessHoursOnly && 'opacity-50 pointer-events-none'
        )}
      >
        {/* Inline Status + Visual Flow — compact */}
        <div className="rounded-xl bg-muted border border-theme-border p-4 landscape:p-3">
          {/* Status indicator */}
          {settings.businessHoursOnly && (
            <div className={clsx(
              'flex items-center gap-2 mb-3 px-3 py-2 rounded-lg text-xs font-semibold',
              isActive
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
            )}>
              <span className={clsx(
                'w-2 h-2 rounded-full flex-shrink-0',
                isActive ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
              )} />
              {isActive ? t('businessHours.statusActive') : t('businessHours.statusInactive')}
              {!isActive && (
                <span className="text-muted-foreground font-normal ms-auto">
                  {t('businessHours.resumesAt', { time: settings.businessHoursStart })}
                </span>
              )}
            </div>
          )}

          {/* Compact flow: two rows side by side */}
          <div className="grid grid-cols-2 gap-3">
            {/* During hours */}
            <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-card">
              <div className="w-9 h-9 rounded-xl icon-bg-green flex items-center justify-center flex-shrink-0">
                <Sun className="w-4 h-4" />
              </div>
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 rtl:rotate-180" />
                <div className="w-7 h-7 rounded-lg icon-bg-brand flex items-center justify-center flex-shrink-0">
                  <Zap className="w-3.5 h-3.5" />
                </div>
                <span className="text-[11px] font-semibold text-foreground truncate">{t('businessHours.autoReplyActive')}</span>
              </div>
            </div>

            {/* Outside hours */}
            <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-card">
              <div className="w-9 h-9 rounded-xl icon-bg-purple flex items-center justify-center flex-shrink-0">
                <Moon className="w-4 h-4" />
              </div>
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 rtl:rotate-180" />
                <div className="w-7 h-7 rounded-lg icon-bg-orange flex items-center justify-center flex-shrink-0">
                  <Mail className="w-3.5 h-3.5" />
                </div>
                <span className="text-[11px] font-semibold text-foreground truncate">{t('businessHours.awayMessage')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Time pickers — inline style */}
        <div className="rounded-2xl bg-muted border border-theme-border p-5 landscape:p-3">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">{t('businessHoursStart')}</label>
              <Select
                value={settings.businessHoursStart}
                onChange={(val) => setSettings({ ...settings, businessHoursStart: val })}
                options={timeSlots}
                disabled={!settings.businessHoursOnly}
                className={clsx(
                  '!py-3 font-bold border-none bg-card shadow-sm',
                  hasError && settings.businessHoursOnly && '!border-2 !border-red-300'
                )}
              />
            </div>
            <div className="text-muted-foreground font-bold text-lg mt-5">–</div>
            <div className="flex-1">
              <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">{t('businessHoursEnd')}</label>
              <Select
                value={settings.businessHoursEnd}
                onChange={(val) => setSettings({ ...settings, businessHoursEnd: val })}
                options={timeSlots}
                disabled={!settings.businessHoursOnly}
                className={clsx(
                  '!py-3 font-bold border-none bg-card shadow-sm',
                  hasError && settings.businessHoursOnly && '!border-2 !border-red-300'
                )}
              />
            </div>
          </div>

          {/* Error Message */}
          {hasError && settings.businessHoursOnly && (
            <div className="flex items-start gap-2 p-3 mt-3 rounded-xl alert-error border animate-in fade-in slide-in-from-top-1">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-bold text-red-700">{t('businessHoursErrorMsg')}</p>
                <p className="text-xs text-red-600 mt-0.5">{t('businessHoursError.hint')}</p>
              </div>
            </div>
          )}

        </div>

        {/* Away Message */}
        <div className="p-5 landscape:p-3 rounded-2xl bg-muted border border-theme-border">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg icon-bg-orange flex items-center justify-center">
              <Mail className="w-4 h-4" />
            </div>
            <div className="text-start flex-1">
              <TitleWithInfo info={t('awayMessage.info')} infoLabel={t('awayMessage.title')}>
                <h5 className="font-bold text-foreground text-sm">{t('awayMessage.title')}</h5>
              </TitleWithInfo>
              <p className="text-[11px] text-muted-foreground font-medium">{t('awayMessage.desc')}</p>
            </div>
          </div>

          <InputFieldWrapper
            disabled={!settings.businessHoursOnly}
            trailing={<CharCounter value={displayValue.length} max={maxChars} />}
          >
            <textarea
              disabled={!settings.businessHoursOnly}
              aria-label={t('awayMessage.title')}
              className={clsx(
                'w-full bg-transparent border-none p-3 pe-14 rounded-2xl resize-none text-sm',
                'placeholder:text-muted-foreground placeholder:italic',
                'focus:outline-none focus:ring-0',
              )}
              rows={3}
              placeholder={placeholder}
              dir={displayValue ? 'auto' : undefined}
              maxLength={maxChars}
              value={displayValue}
              onChange={(e) => {
                const newValue = e.target.value;
                setSettings({
                  ...settings,
                  awayMessageMulti: {
                    ...settings.awayMessageMulti,
                    [currentLang]: newValue,
                    sourceLang: currentLang
                  }
                });
              }}
            />
          </InputFieldWrapper>
        </div>
      </div>
    </Card>
  );
}
