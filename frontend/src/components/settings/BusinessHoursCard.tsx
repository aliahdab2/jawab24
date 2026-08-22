import clsx from 'clsx';
import { MAX_TEMPLATE_MESSAGE_LENGTH, formatTimeInZone } from '@jawab24/shared';
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
import { useMultilingualSettingsField } from '@/hooks/useMultilingualSettingsField';
import type { SettingsCardProps } from './types';

interface BusinessHoursCardProps extends SettingsCardProps {
  currentTime: Date;
}

export function BusinessHoursCard({ settings, setSettings, currentTime }: BusinessHoursCardProps) {
  const t = useTranslations('settings');
  const awayField = useMultilingualSettingsField(settings.awayMessageMulti);
  const { currentLang } = awayField;

  const handleToggle = (enabled: boolean) => {
    const updates: Record<string, unknown> = { businessHoursOnly: enabled };
    if (enabled) {
      // The page-locale t() and the page-locale key move together, so the seeded
      // default is always stored under the language it is written in.
      const defaultMsg = t('awayMessageDefault');
      if (!settings.awayMessageMulti?.[currentLang]) {
        updates.awayMessageMulti = {
          ...settings.awayMessageMulti,
          [currentLang]: defaultMsg
        };
      }
      // The placeholder-timezone seed that used to live here is gone: settings.tsx
      // now replaces PLACEHOLDER_TIMEZONE with the device zone at LOAD, for every
      // merchant, so by the time this toggle runs the value can never still be the
      // placeholder. Seeding here as well would have been unreachable code.
    }
    setSettings({ ...settings, ...updates });
  };

  const timeSlots = Array.from({ length: 48 }, (_, i) => {
    const h = String(Math.floor(i / 2)).padStart(2, '0');
    const m = i % 2 === 0 ? '00' : '30';
    return { value: `${h}:${m}`, label: `${h}:${m}` };
  });

  const hasError = settings.businessHoursEnd <= settings.businessHoursStart;

  // Compute current status
  const nowTime = formatTimeInZone(settings.timezone, currentTime);
  const isActive = settings.businessHoursOnly && nowTime >= settings.businessHoursStart && nowTime < settings.businessHoursEnd;

  // Character limit for away messages (Messenger recommendation)
  const awayValue = awayField.value;
  const isAutoTranslated = awayField.isAutoTranslated;
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

      {/* The zone itself is a General setting (TimezoneCard) — it governs far
          more than this schedule. Echoed read-only here so the hours are never
          read without the clock they are measured against. */}
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium mb-4">
        <Globe className="w-3.5 h-3.5 text-icon-muted flex-shrink-0" aria-hidden="true" />
        {t('businessHours.timezoneEcho', { timezone: settings.timezone.split('/').pop()?.replace(/_/g, ' ') ?? settings.timezone })}
      </p>

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
              <div className="w-9 h-9 rounded-xl icon-bg-emerald flex items-center justify-center flex-shrink-0">
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
              <div className="w-9 h-9 rounded-xl icon-bg-violet flex items-center justify-center flex-shrink-0">
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
                setSettings({ ...settings, awayMessageMulti: awayField.withValue(e.target.value) });
              }}
            />
          </InputFieldWrapper>
        </div>
      </div>
    </Card>
  );
}
