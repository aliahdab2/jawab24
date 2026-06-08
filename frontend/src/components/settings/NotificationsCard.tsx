import clsx from 'clsx';
import { Card, Toggle } from '@/components/ui';
import {
  Bell,
  UserPlus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DurationPresetPicker } from './DurationPresetPicker';
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
        <DurationPresetPicker
          label={t('reminders.commentLabel')}
          options={durationPresets}
          value={settings.commentEscalationMinutes}
          onChange={(v) => setSettings({ ...settings, commentEscalationMinutes: v })}
          disabled={!settings.notificationsEnabled}
        />
        <DurationPresetPicker
          label={t('reminders.messageLabel')}
          options={durationPresets}
          value={settings.messageEscalationMinutes}
          onChange={(v) => setSettings({ ...settings, messageEscalationMinutes: v })}
          disabled={!settings.notificationsEnabled}
        />
      </div>
      </div>
      {/* New lead alerts — independent channel, controllable even when reply reminders are off */}
      <div className="flex items-center justify-between gap-4 mt-4 pt-4 border-t border-theme-border/60">
        <div className="flex items-center gap-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center landscape:w-8 landscape:h-8 ${settings.newLeadAlertsEnabled ? 'icon-bg-brand' : 'bg-muted text-muted-foreground'}`}>
            <UserPlus className="w-4 h-4" />
          </div>
          <div className="text-start">
            <h4 className="font-bold text-foreground text-base">{t('newLeadAlerts.title')}</h4>
            <p className="text-xs text-muted-foreground font-medium">{t('newLeadAlerts.desc')}</p>
          </div>
        </div>
        <Toggle enabled={settings.newLeadAlertsEnabled} onChange={(enabled) => setSettings({ ...settings, newLeadAlertsEnabled: enabled })} aria-label={t('newLeadAlerts.title')} />
      </div>
    </Card>
  );
}
