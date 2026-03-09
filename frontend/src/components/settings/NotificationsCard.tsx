import clsx from 'clsx';
import { Card, Toggle } from '@/components/ui';
import {
  Bell,
  Clock,
  Check,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SettingsCardProps } from './types';

export function NotificationsCard({ settings, setSettings }: SettingsCardProps) {
  const t = useTranslations('settings');

  const durationPresets = [
    { value: 15, label: t('duration15min') },
    { value: 30, label: t('duration30min') },
    { value: 60, label: t('duration1hr') },
    { value: 120, label: t('duration2hr') },
    { value: 240, label: t('duration4hr') },
  ];

  return (
    <Card className="border-none shadow-md shadow-theme-border/30 p-4 landscape:p-3">
      <div className="flex items-center justify-between mb-4 landscape:mb-3">
        <div className="flex items-center gap-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center landscape:w-8 landscape:h-8 ${settings.notificationsEnabled ? 'icon-bg-brand' : 'bg-muted text-muted-foreground'}`}>
            <Bell className="w-4 h-4" />
          </div>
          <div className="text-start">
            <h4 className="font-bold text-foreground text-lg landscape:text-base">{t('reminders.title')}</h4>
            <p className="text-xs text-muted-foreground font-medium landscape:hidden">{t('reminders.desc')}</p>
          </div>
        </div>
        <Toggle enabled={settings.notificationsEnabled} onChange={(enabled) => setSettings({ ...settings, notificationsEnabled: enabled })} aria-label={t('reminders.title')} />
      </div>
      <div
        className={clsx(
          "transition-opacity duration-300",
          !settings.notificationsEnabled && "opacity-50 pointer-events-none"
        )}
      >
      <p className="text-xs text-muted-foreground font-medium mb-3">{t('reminders.helpText')}</p>
      <div className="space-y-4">
        {/* Comment reminder presets */}
        <div>
          <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">{t('reminders.commentLabel')}</label>
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
                    : 'bg-background text-muted-foreground border-theme-border hover:bg-muted'
                )}
              >
                {settings.commentEscalationMinutes === opt.value ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3 text-muted-foreground" />}
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {/* Message reminder presets */}
        <div>
          <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">{t('reminders.messageLabel')}</label>
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
                    : 'bg-background text-muted-foreground border-theme-border hover:bg-muted'
                )}
              >
                {settings.messageEscalationMinutes === opt.value ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3 text-muted-foreground" />}
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
