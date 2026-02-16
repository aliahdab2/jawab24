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
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center landscape:w-8 landscape:h-8 ${settings.businessHoursOnly ? 'bg-brand-100 text-brand-600' : 'bg-surface-100 text-surface-500'}`}>
            <Clock className="w-4 h-4" />
          </div>
          <div className="text-start">
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-surface-900 text-lg landscape:text-base">{t('settings.businessHours')}</h4>
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
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        : 'bg-red-100 text-red-700 hover:bg-red-200'
                    )}
                  >
                    {isActive ? '🟢' : '🔴'} {isActive ? t('settings.businessHours.statusActive' as TranslationKey) : t('settings.businessHours.statusInactive' as TranslationKey)}
                  </button>
                );
              })()}
            </div>
            <p className="text-xs text-surface-500 font-medium landscape:hidden">{t('settings.businessHoursDesc')}</p>
          </div>
        </div>
        <Toggle enabled={settings.businessHoursOnly} onChange={handleToggle} />
      </div>

      <div
        className={clsx(
          "space-y-4 transition-opacity duration-300",
          !settings.businessHoursOnly && "opacity-50 pointer-events-none"
        )}
      >
          {/* Visual Flow */}
          <div className="mt-3 mb-4 space-y-3 p-4 rounded-xl bg-surface-50 border border-surface-100">
            {/* During Hours */}
            <div className="flex items-center justify-center gap-3">
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center">
                  <Clock className="w-7 h-7 text-green-600" />
                </div>
                <span className="text-xs font-bold text-surface-700 text-center leading-tight max-w-[80px]">
                  {t('settings.businessHours.duringLabel')}
                </span>
              </div>
              <ArrowRight className="w-5 h-5 text-surface-400 flex-shrink-0 rtl:rotate-180" />
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-14 h-14 rounded-2xl bg-brand-100 flex items-center justify-center">
                  <Zap className="w-7 h-7 text-brand-600" />
                </div>
                <span className="text-xs font-bold text-surface-700 text-center leading-tight max-w-[80px]">
                  {t('settings.businessHours.autoReplyActive')}
                </span>
              </div>
            </div>

            {/* Outside Hours */}
            <div className="flex items-center justify-center gap-3">
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-14 h-14 rounded-2xl bg-purple-100 flex items-center justify-center">
                  <Clock className="w-7 h-7 text-purple-600" />
                </div>
                <span className="text-xs font-bold text-surface-700 text-center leading-tight max-w-[80px]">
                  {t('settings.businessHours.outsideLabel')}
                </span>
              </div>
              <ArrowRight className="w-5 h-5 text-surface-400 flex-shrink-0 rtl:rotate-180" />
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-14 h-14 rounded-2xl bg-orange-100 flex items-center justify-center">
                  <Mail className="w-7 h-7 text-orange-600" />
                </div>
                <span className="text-xs font-bold text-surface-700 text-center leading-tight max-w-[80px]">
                  {t('settings.businessHours.awayMessage')}
                </span>
              </div>
            </div>
          </div>

          {/* Time pickers */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-6 landscape:gap-4 p-5 landscape:p-3 rounded-2xl bg-surface-50 border border-surface-100">
              <div>
                <label className="block text-[10px] font-bold text-surface-500 uppercase tracking-widest mb-2">{t('settings.businessHoursStart')}</label>
                <Select
                  value={settings.businessHoursStart}
                  onChange={(val) => setSettings({ ...settings, businessHoursStart: val })}
                  options={timeSlots}
                  disabled={!settings.businessHoursOnly}
                  className={clsx(
                    "!py-3 font-bold border-none bg-white shadow-sm",
                    hasError && settings.businessHoursOnly && "!border-2 !border-red-300"
                  )}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-surface-500 uppercase tracking-widest mb-2">{t('settings.businessHoursEnd')}</label>
                <Select
                  value={settings.businessHoursEnd}
                  onChange={(val) => setSettings({ ...settings, businessHoursEnd: val })}
                  options={timeSlots}
                  disabled={!settings.businessHoursOnly}
                  className={clsx(
                    "!py-3 font-bold border-none bg-white shadow-sm",
                    hasError && settings.businessHoursOnly && "!border-2 !border-red-300"
                  )}
                />
              </div>
            </div>

            {/* Error Message */}
            {hasError && settings.businessHoursOnly && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 animate-in fade-in slide-in-from-top-1">
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-red-700">{t('settings.businessHoursError' as TranslationKey)}</p>
                  <p className="text-xs text-red-600 mt-0.5">{t('settings.businessHoursError.hint' as TranslationKey)}</p>
                </div>
              </div>
            )}
          </div>

          {/* Away Message */}
          <div className="p-5 landscape:p-3 rounded-2xl bg-surface-50 border border-surface-100">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-surface-200 text-surface-500 flex items-center justify-center">
                <MessageCircle className="w-4 h-4" />
              </div>
              <div className="text-start">
                  <h5 className="font-bold text-surface-800 text-sm">{t('settings.awayMessage.title')}</h5>
                <p className="text-[11px] text-surface-600 font-medium">{t('settings.awayMessage.desc')}</p>
              </div>
            </div>

            {(() => {
              const currentLang = settings.dashboardLanguage;
              const value = settings.awayMessageMulti?.[currentLang] || '';
              const sourceLang = settings.awayMessageMulti?.sourceLang;
              const isAutoTranslated = sourceLang && sourceLang !== 'manual' && sourceLang !== currentLang;
              const displayValue = isAutoTranslated ? '' : value;
              const placeholder = isAutoTranslated ? value : t('settings.awayMessagePlaceholder');

              return (
                <textarea
                  disabled={!settings.businessHoursOnly}
                  className={`input min-h-[80px] landscape:min-h-[50px] border-none bg-white focus:ring-2 focus:ring-brand-500 p-4 rounded-xl text-sm placeholder:text-surface-400 placeholder:italic ${currentLang === 'ar' ? 'rtl' : 'ltr'}`}
                  placeholder={placeholder}
                  dir={currentLang === 'ar' ? "rtl" : "ltr"}
                  value={displayValue}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    setSettings({
                      ...settings,
                      awayMessageMulti: {
                        ...settings.awayMessageMulti,
                        [currentLang]: newValue
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
