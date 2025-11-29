import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardHeader, Button, Input, Toggle, PageHeader } from '@/components/ui';
import { 
  Globe,
  Bot,
  Bell,
  Shield,
  Save,
  RefreshCw,
  MessageSquare,
  MessageCircle,
  Clock
} from 'lucide-react';
import { useTranslation, useLanguage } from '@/i18n';

// Helper component for settings toggle rows
function SettingsToggleRow({ 
  icon, 
  title, 
  description, 
  enabled, 
  onChange 
}: { 
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-3">
        {icon}
        <div className="text-start">
          <p className="font-medium text-surface-900">{title}</p>
          <p className="text-sm text-surface-500">{description}</p>
        </div>
      </div>
      <Toggle enabled={enabled} onChange={onChange} />
    </div>
  );
}

export default function SettingsPage() {
  const { t, language } = useTranslation();
  const { setLanguage } = useLanguage();
  const isRTL = language === 'ar';
  
  const [settings, setSettings] = useState({
    dashboardLanguage: language,
    defaultReplyLanguage: 'ar',
    autoDetectLanguage: true,
    aiEnabled: true,
    aiModel: 'gpt-4o-mini',
    notificationsEnabled: true,
    emailNotifications: true,
    webhookRetries: 3,
    // Auto-reply settings
    commentsAutoReply: true,
    messagesAutoReply: true,
    businessHoursOnly: false,
    businessHoursStart: '09:00',
    businessHoursEnd: '18:00',
    awayMessage: '',
    replyDelay: 0,
    greetingMessage: '',
  });
  const [saving, setSaving] = useState(false);

  // Update dashboard language when setting changes
  useEffect(() => {
    if (settings.dashboardLanguage !== language) {
      setLanguage(settings.dashboardLanguage as 'ar' | 'en');
    }
  }, [settings.dashboardLanguage, language, setLanguage]);

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => setSaving(false), 1500);
  };

  return (
    <DashboardLayout title={t('settings.title')}>
      {/* Header */}
      <PageHeader 
        title={t('settings.title')} 
        description={t('settings.description')}
        action={
          <Button onClick={handleSave} loading={saving} icon={<Save className="w-4 h-4" />}>
            {t('settings.saveSettings')}
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Auto-Reply Settings - Most Important */}
        <Card className="lg:col-span-2">
          <CardHeader 
            title={t('settings.autoReplySettings')} 
            description={t('settings.autoReplyDescription')}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Comments Auto-Reply */}
            <div className="p-4 rounded-xl bg-surface-50 border border-surface-200">
              <SettingsToggleRow
                icon={<MessageSquare className="w-5 h-5 text-brand-600" />}
                title={t('settings.commentsAutoReply')}
                description={t('settings.commentsAutoReplyDesc')}
                enabled={settings.commentsAutoReply}
                onChange={(enabled) => setSettings({ ...settings, commentsAutoReply: enabled })}
              />
            </div>

            {/* Messages Auto-Reply */}
            <div className="p-4 rounded-xl bg-surface-50 border border-surface-200">
              <SettingsToggleRow
                icon={<MessageCircle className="w-5 h-5 text-brand-600" />}
                title={t('settings.messagesAutoReply')}
                description={t('settings.messagesAutoReplyDesc')}
                enabled={settings.messagesAutoReply}
                onChange={(enabled) => setSettings({ ...settings, messagesAutoReply: enabled })}
              />
            </div>

            {/* Business Hours */}
            <div className="p-4 rounded-xl bg-surface-50 border border-surface-200">
              <SettingsToggleRow
                icon={<Clock className="w-5 h-5 text-brand-600" />}
                title={t('settings.businessHours')}
                description={t('settings.businessHoursDesc')}
                enabled={settings.businessHoursOnly}
                onChange={(enabled) => setSettings({ ...settings, businessHoursOnly: enabled })}
              />
              {settings.businessHoursOnly && (
                <div className="mt-4 flex items-center gap-4">
                  <div>
                    <label className="label text-xs">{t('settings.businessHoursStart')}</label>
                    <Input
                      type="time"
                      value={settings.businessHoursStart}
                      onChange={(e) => setSettings({ ...settings, businessHoursStart: e.target.value })}
                      className="w-32"
                    />
                  </div>
                  <div>
                    <label className="label text-xs">{t('settings.businessHoursEnd')}</label>
                    <Input
                      type="time"
                      value={settings.businessHoursEnd}
                      onChange={(e) => setSettings({ ...settings, businessHoursEnd: e.target.value })}
                      className="w-32"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Reply Delay */}
            <div className="p-4 rounded-xl bg-surface-50 border border-surface-200">
              <div className="flex items-center gap-3 mb-3">
                <Clock className="w-5 h-5 text-brand-600" />
                <div className="text-start">
                  <p className="font-medium text-surface-900">{t('settings.responseTime')}</p>
                  <p className="text-sm text-surface-500">{t('settings.replyDelay')}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={60}
                  value={settings.replyDelay}
                  onChange={(e) => setSettings({ ...settings, replyDelay: parseInt(e.target.value) || 0 })}
                  className="w-24"
                />
                <span className="text-sm text-surface-500">{t('settings.seconds')}</span>
              </div>
            </div>

            {/* Away Message */}
            <div className="md:col-span-2">
              <label className="label">{t('settings.awayMessage')}</label>
              <p className="text-xs text-surface-500 mb-2">{t('settings.awayMessageDesc')}</p>
              <textarea
                className="input min-h-[80px]"
                placeholder={t('settings.awayMessagePlaceholder')}
                value={settings.awayMessage}
                onChange={(e) => setSettings({ ...settings, awayMessage: e.target.value })}
              />
            </div>

            {/* Greeting Message */}
            <div className="md:col-span-2">
              <label className="label">{t('settings.greetingMessage')}</label>
              <p className="text-xs text-surface-500 mb-2">{t('settings.greetingMessageDesc')}</p>
              <textarea
                className="input min-h-[80px]"
                placeholder={t('settings.greetingMessagePlaceholder')}
                value={settings.greetingMessage}
                onChange={(e) => setSettings({ ...settings, greetingMessage: e.target.value })}
              />
            </div>
          </div>
        </Card>

        {/* Language Settings */}
        <Card>
          <CardHeader 
            title={t('settings.language')} 
            description={t('settings.description')}
          />
          <div className="space-y-6">
            <div>
              <label className="label">{t('settings.language')}</label>
              <select
                className="input"
                value={settings.dashboardLanguage}
                onChange={(e) => setSettings({ ...settings, dashboardLanguage: e.target.value as 'ar' | 'en' })}
              >
                <option value="ar">العربية (Arabic)</option>
                <option value="en">English</option>
              </select>
            </div>

            <div>
              <label className="label">{t('settings.defaultReplyLanguage')}</label>
              <select
                className="input"
                value={settings.defaultReplyLanguage}
                onChange={(e) => setSettings({ ...settings, defaultReplyLanguage: e.target.value })}
              >
                <option value="ar">العربية (Arabic)</option>
                <option value="en">English</option>
              </select>
              <p className="text-xs text-surface-500 mt-1">
                {t('settings.description')}
              </p>
            </div>

            <SettingsToggleRow
              icon={<Globe className="w-5 h-5 text-brand-600" />}
              title={t('settings.autoDetect')}
              description={t('settings.description')}
              enabled={settings.autoDetectLanguage}
              onChange={(enabled) => setSettings({ ...settings, autoDetectLanguage: enabled })}
            />
          </div>
        </Card>

        {/* AI Settings */}
        <Card>
          <CardHeader 
            title={t('settings.aiSettings')} 
            description={t('settings.description')}
          />
          <div className="space-y-4">
            <SettingsToggleRow
              icon={<Bot className="w-5 h-5 text-brand-600" />}
              title={t('settings.enableAI')}
              description={t('settings.aiDescription')}
              enabled={settings.aiEnabled}
              onChange={(enabled) => setSettings({ ...settings, aiEnabled: enabled })}
            />
          </div>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader 
            title={t('settings.notifications')} 
            description={t('settings.description')}
          />
          <div className="space-y-4">
            <SettingsToggleRow
              icon={<Bell className="w-5 h-5 text-brand-600" />}
              title={t('settings.notifications')}
              description={t('settings.description')}
              enabled={settings.notificationsEnabled}
              onChange={(enabled) => setSettings({ ...settings, notificationsEnabled: enabled })}
            />

            <SettingsToggleRow
              icon={<Bell className="w-5 h-5 text-brand-600" />}
              title={t('settings.emailNotifications')}
              description={t('settings.description')}
              enabled={settings.emailNotifications}
              onChange={(enabled) => setSettings({ ...settings, emailNotifications: enabled })}
            />
          </div>
        </Card>

        {/* General Settings */}
        <Card>
          <CardHeader 
            title={t('settings.general')} 
            description={t('settings.description')}
          />
          <div className="space-y-6">
            <div className="p-4 rounded-xl bg-surface-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <RefreshCw className="w-5 h-5 text-brand-600" />
                  <div className="text-start">
                    <p className="font-medium text-surface-900">Webhook</p>
                    <p className="text-sm text-emerald-600">{t('common.active')}</p>
                  </div>
                </div>
                <Button variant="secondary" size="sm" icon={<RefreshCw className="w-4 h-4" />}>
                  {t('common.confirm')}
                </Button>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="p-4 rounded-xl border border-red-200 bg-red-50">
              <h4 className="font-medium text-red-700 mb-2">{t('settings.dangerZone')}</h4>
              <p className="text-sm text-red-600 mb-4">
                {t('settings.deleteAccountWarning')}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm">
                  {t('common.delete')}
                </Button>
                <Button variant="danger" size="sm">
                  {t('settings.deleteAccount')}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
