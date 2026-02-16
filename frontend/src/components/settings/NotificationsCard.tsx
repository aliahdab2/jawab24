import clsx from 'clsx';
import { Card, Toggle } from '@/components/ui';
import {
  Bell,
  Clock,
  Check,
} from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import type { SettingsCardProps } from './types';

export function NotificationsCard({ settings, setSettings }: SettingsCardProps) {
  const { t } = useTranslation();

  const durationPresets = [
    { value: 15, label: t('settings.duration15min' as TranslationKey) },
    { value: 30, label: t('settings.duration30min' as TranslationKey) },
    { value: 60, label: t('settings.duration1hr' as TranslationKey) },
    { value: 120, label: t('settings.duration2hr' as TranslationKey) },
    { value: 240, label: t('settings.duration4hr' as TranslationKey) },
  ];

  return (
    <Card className="border-none shadow-md shadow-surface-200/30 p-4 landscape:p-3">
      <div className="flex items-center justify-between mb-4 landscape:mb-3">
        <div className="flex items-center gap-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center landscape:w-8 landscape:h-8 ${settings.notificationsEnabled ? 'bg-brand-100 text-brand-600' : 'bg-surface-100 text-surface-500'}`}>
            <Bell className="w-4 h-4" />
          </div>
          <div className="text-start">
            <h4 className="font-bold text-surface-900 text-lg landscape:text-base">{t('settings.reminders.title')}</h4>
            <p className="text-xs text-surface-500 font-medium landscape:hidden">{t('settings.reminders.desc')}</p>
          </div>
        </div>
        <Toggle enabled={settings.notificationsEnabled} onChange={(enabled) => setSettings({ ...settings, notificationsEnabled: enabled })} />
      </div>
      <div
        className={clsx(
          "transition-opacity duration-300",
          !settings.notificationsEnabled && "opacity-50 pointer-events-none"
        )}
      >
      <p className="text-xs text-surface-600 font-medium mb-3">{t('settings.reminders.helpText')}</p>
      <div className="space-y-4">
        {/* Comment reminder presets */}
        <div>
          <label className="block text-[10px] font-bold text-surface-500 uppercase tracking-widest mb-2">{t('settings.reminders.commentLabel')}</label>
          <div className="flex flex-wrap gap-2">
            {durationPresets.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSettings({ ...settings, commentEscalationMinutes: opt.value })}
                disabled={!settings.notificationsEnabled}
                className={clsx(
                  'px-3 py-2.5 rounded-xl text-xs font-bold transition-all border min-h-[40px] flex items-center gap-1.5',
                  'active:scale-[0.98]',
                  settings.commentEscalationMinutes === opt.value
                    ? 'bg-brand-500 text-white border-brand-600 shadow-md'
                    : 'bg-surface-50 text-surface-600 border-surface-200 hover:bg-surface-100'
                )}
              >
                {settings.commentEscalationMinutes === opt.value ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3 text-surface-400" />}
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {/* Message reminder presets */}
        <div>
          <label className="block text-[10px] font-bold text-surface-500 uppercase tracking-widest mb-2">{t('settings.reminders.messageLabel')}</label>
          <div className="flex flex-wrap gap-2">
            {durationPresets.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSettings({ ...settings, messageEscalationMinutes: opt.value })}
                disabled={!settings.notificationsEnabled}
                className={clsx(
                  'px-3 py-2.5 rounded-xl text-xs font-bold transition-all border min-h-[40px] flex items-center gap-1.5',
                  'active:scale-[0.98]',
                  settings.messageEscalationMinutes === opt.value
                    ? 'bg-brand-500 text-white border-brand-600 shadow-md'
                    : 'bg-surface-50 text-surface-600 border-surface-200 hover:bg-surface-100'
                )}
              >
                {settings.messageEscalationMinutes === opt.value ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3 text-surface-400" />}
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      </div>
    </Card>
  );
}
