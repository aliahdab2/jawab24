import clsx from 'clsx';
import { Card, Toggle, Select } from '@/components/ui';
import {
  Clock,
  Zap,
  AlertTriangle,
  ArrowRight,
  MessageCircle,
  Mail,
} from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import type { SettingsCardProps } from './types';

interface BusinessHoursCardProps extends SettingsCardProps {
  currentTime: Date;
}

export function BusinessHoursCard({ settings, setSettings, currentTime }: BusinessHoursCardProps) {
  const { t } = useTranslation();

  const handleToggle = (enabled: boolean) => {
    const updates: Record<string, unknown> = { businessHoursOnly: enabled };
    if (enabled) {
      const defaultMsg = t('settings.awayMessageDefault' as TranslationKey);
      const currentLang = settings.dashboardLanguage;
      if (!settings.awayMessageMulti?.[currentLang]) {
        updates.awayMessageMulti = {
          ...settings.awayMessageMulti,
          [currentLang]: defaultMsg
        };
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

  return (
    <Card className="border-none shadow-md shadow-surface-200/30 p-4 landscape:p-3 overflow-hidden">
      <div className="flex items-center justify-between mb-6 landscape:mb-3">
        <div className="flex items-center gap-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center landscape:w-8 landscape:h-8 ${settings.businessHoursOnly ? 'icon-bg-brand' : 'bg-muted text-muted-foreground'}`}>
            <Clock className="w-4 h-4" />
          </div>
          <div className="text-start">
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-foreground text-lg landscape:text-base">{t('settings.businessHours')}</h4>
              {settings.businessHoursOnly && (() => {
                const parts = new Intl.DateTimeFormat('en-US', {
                  timeZone: settings.timezone,
                  hour: '2-digit', minute: '2-digit', hour12: false,
                }).formatToParts(currentTime);
                const now = `${parts.find(p => p.type === 'hour')?.value || '00'}:${parts.find(p => p.type === 'minute')?.value || '00'}`;
                const isActive = now >= settings.businessHoursStart && now < settings.businessHoursEnd;
                return (
                  <button
                    onClick={() => {
                      const updates: Record<string, unknown> = { businessHoursOnly: !settings.businessHoursOnly };
                      if (!settings.businessHoursOnly) {
                        const defaultMsg = t('settings.awayMessageDefault' as TranslationKey);
                        const currentLang = settings.dashboardLanguage;
                        if (!settings.awayMessageMulti?.[currentLang]) {
                          updates.awayMessageMulti = {
                            ...settings.awayMessageMulti,
                            [currentLang]: defaultMsg
                          };
                        }
                      }
                      setSettings({ ...settings, ...updates });
                    }}
                    className={clsx(
                      'px-2 py-0.5 rounded-full text-[10px] font-bold transition-all animate-in fade-in',
                      isActive
                        ? 'status-success hover:bg-emerald-200 dark:hover:bg-emerald-900/50'
                        : 'status-error hover:bg-red-200 dark:hover:bg-red-900/50'
                    )}
                  >
                    {isActive ? '🟢' : '🔴'} {isActive ? t('settings.businessHours.statusActive' as TranslationKey) : t('settings.businessHours.statusInactive' as TranslationKey)}
                  </button>
                );
              })()}
            </div>
            <p className="text-xs text-muted-foreground font-medium landscape:hidden">{t('settings.businessHoursDesc')}</p>
          </div>
        </div>
        <Toggle enabled={settings.businessHoursOnly} onChange={handleToggle} aria-label={t('settings.businessHours')} />
      </div>

      <div
        className={clsx(
          "space-y-4 transition-opacity duration-300",
          !settings.businessHoursOnly && "opacity-50 pointer-events-none"
        )}
      >
          {/* Visual Flow */}
          <div className="mt-3 mb-4 space-y-3 p-4 rounded-xl bg-muted border border-theme-border">
            {/* During Hours */}
            <div className="flex items-center justify-center gap-3">
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-14 h-14 rounded-2xl icon-bg-green flex items-center justify-center">
                  <Clock className="w-7 h-7" />
                </div>
                <span className="text-xs font-bold text-foreground text-center leading-tight max-w-[80px]">
                  {t('settings.businessHours.duringLabel')}
                </span>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground flex-shrink-0 rtl:rotate-180" />
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-14 h-14 rounded-2xl icon-bg-brand flex items-center justify-center">
                  <Zap className="w-7 h-7" />
                </div>
                <span className="text-xs font-bold text-foreground text-center leading-tight max-w-[80px]">
                  {t('settings.businessHours.autoReplyActive')}
                </span>
              </div>
            </div>

            {/* Outside Hours */}
            <div className="flex items-center justify-center gap-3">
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-14 h-14 rounded-2xl icon-bg-purple flex items-center justify-center">
                  <Clock className="w-7 h-7" />
                </div>
                <span className="text-xs font-bold text-foreground text-center leading-tight max-w-[80px]">
                  {t('settings.businessHours.outsideLabel')}
                </span>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground flex-shrink-0 rtl:rotate-180" />
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-14 h-14 rounded-2xl icon-bg-orange flex items-center justify-center">
                  <Mail className="w-7 h-7" />
                </div>
                <span className="text-xs font-bold text-foreground text-center leading-tight max-w-[80px]">
                  {t('settings.businessHours.awayMessage')}
                </span>
              </div>
            </div>
          </div>

          {/* Time pickers */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-6 landscape:gap-4 p-5 landscape:p-3 rounded-2xl bg-muted border border-theme-border">
              <div>
                <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">{t('settings.businessHoursStart')}</label>
                <Select
                  value={settings.businessHoursStart}
                  onChange={(val) => setSettings({ ...settings, businessHoursStart: val })}
                  options={timeSlots}
                  disabled={!settings.businessHoursOnly}
                  className={clsx(
                    "!py-3 font-bold border-none bg-card shadow-sm",
                    hasError && settings.businessHoursOnly && "!border-2 !border-red-300"
                  )}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">{t('settings.businessHoursEnd')}</label>
                <Select
                  value={settings.businessHoursEnd}
                  onChange={(val) => setSettings({ ...settings, businessHoursEnd: val })}
                  options={timeSlots}
                  disabled={!settings.businessHoursOnly}
                  className={clsx(
                    "!py-3 font-bold border-none bg-card shadow-sm",
                    hasError && settings.businessHoursOnly && "!border-2 !border-red-300"
                  )}
                />
              </div>
            </div>

            {/* Error Message */}
            {hasError && settings.businessHoursOnly && (
              <div className="flex items-start gap-2 p-3 rounded-xl alert-error border animate-in fade-in slide-in-from-top-1">
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-red-700">{t('settings.businessHoursError' as TranslationKey)}</p>
                  <p className="text-xs text-red-600 mt-0.5">{t('settings.businessHoursError.hint' as TranslationKey)}</p>
                </div>
              </div>
            )}
          </div>

          {/* Away Message */}
          <div className="p-5 landscape:p-3 rounded-2xl bg-muted border border-theme-border">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center">
                <MessageCircle className="w-4 h-4" />
              </div>
              <div className="text-start">
                  <h5 className="font-bold text-foreground text-sm">{t('settings.awayMessage.title')}</h5>
                <p className="text-[11px] text-muted-foreground font-medium">{t('settings.awayMessage.desc')}</p>
              </div>
            </div>

            {(() => {
              const currentLang = settings.dashboardLanguage;
              const value = settings.awayMessageMulti?.[currentLang] || '';
              const sourceLang = settings.awayMessageMulti?.sourceLang;
              const isAutoTranslated = sourceLang && sourceLang !== 'manual' && sourceLang !== currentLang;
              const displayValue = isAutoTranslated ? '' : value;
              const placeholder = isAutoTranslated && value ? value : t('settings.awayMessagePlaceholder');

              return (
                <textarea
                  disabled={!settings.businessHoursOnly}
                  aria-label={t('settings.awayMessage.title')}
                  className="input min-h-[56px] landscape:min-h-[44px] border-none bg-card focus:ring-2 focus:ring-brand-500 p-3 rounded-xl text-sm placeholder:text-surface-400 placeholder:italic"
                  placeholder={placeholder}
                  dir={displayValue ? 'auto' : undefined}
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
              );
            })()}
          </div>
        </div>
      </Card>
  );
}
