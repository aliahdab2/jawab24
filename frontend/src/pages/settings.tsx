import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardHeader, Button, Input, Toggle, PageHeader, PageSpinner } from '@/components/ui';
import { useAuthStore } from '@/lib/store';
import axios from 'axios';
import { 
  Globe,
  Bot,
  Bell,
  Save,
  MessageSquare,
  MessageCircle,
  Clock,
  Check,
  ChevronDown,
  ChevronUp,
  Settings2,
  BookTemplate,
  Zap,
  ChevronRight
} from 'lucide-react';
import Link from 'next/link';
import { useTranslation, useLanguage } from '@/i18n';

// Simple toggle row component
function SimpleToggle({ 
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
    <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-surface-50 border border-surface-200">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center">
          {icon}
        </div>
        <div className="text-start min-w-0">
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
  const { token } = useAuthStore();
  const isRTL = language === 'ar';
  
  // Show/hide advanced settings
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  const [settings, setSettings] = useState({
    dashboardLanguage: language,
    defaultReplyLanguage: 'ar',
    autoDetectLanguage: true,
    aiEnabled: true,
    aiModel: 'gpt-4o-mini',
    notificationsEnabled: true,
    emailNotifications: true,
    webhookRetries: 3,
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
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

  const fetchSettings = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const response = await axios.get(`${apiUrl}/settings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = response.data;
      setSettings(prev => ({
        ...prev,
        dashboardLanguage: data.dashboardLanguage || prev.dashboardLanguage,
        defaultReplyLanguage: data.defaultReplyLanguage || prev.defaultReplyLanguage,
        autoDetectLanguage: data.autoDetectLanguage ?? prev.autoDetectLanguage,
        aiEnabled: data.aiEnabled ?? prev.aiEnabled,
        aiModel: data.aiModel || prev.aiModel,
        commentsAutoReply: data.commentsAutoReply ?? prev.commentsAutoReply,
        messagesAutoReply: data.messagesAutoReply ?? prev.messagesAutoReply,
        businessHoursOnly: data.businessHoursOnly ?? prev.businessHoursOnly,
        businessHoursStart: data.businessHoursStart || prev.businessHoursStart,
        businessHoursEnd: data.businessHoursEnd || prev.businessHoursEnd,
        awayMessage: data.awayMessage || '',
        replyDelay: data.replyDelay ?? prev.replyDelay,
        greetingMessage: data.greetingMessage || '',
      }));
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  }, [token, apiUrl]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (settings.dashboardLanguage !== language) {
      setLanguage(settings.dashboardLanguage as 'ar' | 'en');
    }
  }, [settings.dashboardLanguage, language, setLanguage]);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    setSaved(false);
    try {
      await axios.put(`${apiUrl}/settings`, settings, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout title={t('settings.title')}>
        <div className="flex items-center justify-center h-64">
          <PageSpinner />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t('settings.title')}>
      {/* Header */}
      <PageHeader 
        title={t('settings.title')} 
        description={t('settings.description')}
        action={
          <Button 
            onClick={handleSave} 
            loading={saving} 
            icon={saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            variant={saved ? 'secondary' : 'primary'}
            size="lg"
          >
            {saved ? t('settings.settingsSaved') : t('settings.saveSettings')}
          </Button>
        }
      />

      {/* Main Settings - Simple */}
      <div className="space-y-4 mb-6">
        {/* Language - Most important */}
        <Card>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-xl bg-brand-100 flex items-center justify-center">
              <Globe className="w-6 h-6 text-brand-600" />
            </div>
            <div>
              <h3 className="font-semibold text-surface-900 text-lg">{t('settings.language')}</h3>
              <p className="text-surface-500 text-sm">
                {isRTL ? 'اختر لغة التطبيق والردود' : 'Choose app and reply language'}
              </p>
            </div>
          </div>
          <select
            className="input text-lg"
            value={settings.dashboardLanguage}
            onChange={(e) => setSettings({ ...settings, dashboardLanguage: e.target.value as 'ar' | 'en' })}
          >
            <option value="ar">العربية (Arabic)</option>
            <option value="en">English</option>
          </select>
        </Card>

        {/* Auto Reply Toggles - Simple cards */}
        <SimpleToggle
          icon={<MessageSquare className="w-5 h-5 text-brand-600" />}
          title={t('settings.commentsAutoReply')}
          description={t('settings.commentsAutoReplyDesc')}
          enabled={settings.commentsAutoReply}
          onChange={(enabled) => setSettings({ ...settings, commentsAutoReply: enabled })}
        />

        <SimpleToggle
          icon={<MessageCircle className="w-5 h-5 text-brand-600" />}
          title={t('settings.messagesAutoReply')}
          description={t('settings.messagesAutoReplyDesc')}
          enabled={settings.messagesAutoReply}
          onChange={(enabled) => setSettings({ ...settings, messagesAutoReply: enabled })}
        />

        <SimpleToggle
          icon={<Bot className="w-5 h-5 text-brand-600" />}
          title={t('settings.enableAI')}
          description={t('settings.aiDescription')}
          enabled={settings.aiEnabled}
          onChange={(enabled) => setSettings({ ...settings, aiEnabled: enabled })}
        />
      </div>

      {/* Advanced Settings Toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="w-full flex items-center justify-between p-4 rounded-xl bg-surface-100 hover:bg-surface-200 transition-colors mb-4"
      >
        <div className="flex items-center gap-3">
          <Settings2 className="w-5 h-5 text-surface-500" />
          <span className="font-medium text-surface-700">
            {showAdvanced ? t('settings.hideAdvanced') : t('settings.showAdvanced')}
          </span>
        </div>
        {showAdvanced ? (
          <ChevronUp className="w-5 h-5 text-surface-500" />
        ) : (
          <ChevronDown className="w-5 h-5 text-surface-500" />
        )}
      </button>

      {/* Advanced Settings - Hidden by default */}
      {showAdvanced && (
        <div className="space-y-4 animate-slide-up">
          {/* Templates & Rules Links */}
          <Card>
            <h4 className="font-semibold text-surface-900 mb-4">
              {isRTL ? 'إدارة الردود' : 'Manage Replies'}
            </h4>
            <div className="space-y-2">
              <Link
                href="/templates"
                className="flex items-center justify-between p-3 rounded-xl bg-surface-50 hover:bg-surface-100 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center">
                    <BookTemplate className="w-5 h-5 text-violet-600" />
                  </div>
                  <div>
                    <p className="font-medium text-surface-900">{t('nav.templates')}</p>
                    <p className="text-sm text-surface-500">
                      {isRTL ? 'إنشاء ردود جاهزة للاستخدام السريع' : 'Create ready-made replies'}
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-surface-400 group-hover:text-surface-600 transition-colors rtl:rotate-180" />
              </Link>
              
              <Link
                href="/rules"
                className="flex items-center justify-between p-3 rounded-xl bg-surface-50 hover:bg-surface-100 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="font-medium text-surface-900">{t('nav.rules')}</p>
                    <p className="text-sm text-surface-500">
                      {isRTL ? 'قواعد للرد التلقائي بناءً على الكلمات' : 'Auto-reply rules based on keywords'}
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-surface-400 group-hover:text-surface-600 transition-colors rtl:rotate-180" />
              </Link>
            </div>
          </Card>

          {/* Business Hours */}
          <Card>
            <SimpleToggle
              icon={<Clock className="w-5 h-5 text-brand-600" />}
              title={t('settings.businessHours')}
              description={t('settings.businessHoursDesc')}
              enabled={settings.businessHoursOnly}
              onChange={(enabled) => setSettings({ ...settings, businessHoursOnly: enabled })}
            />
            {settings.businessHoursOnly && (
              <div className="mt-4 flex items-center gap-4 ps-14">
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
          </Card>

          {/* Reply Delay */}
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center">
                <Clock className="w-5 h-5 text-brand-600" />
              </div>
              <div>
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
          </Card>

          {/* Greeting Message */}
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center">
                <MessageCircle className="w-5 h-5 text-brand-600" />
              </div>
              <div>
                <p className="font-medium text-surface-900">{t('settings.greetingMessage')}</p>
                <p className="text-sm text-surface-500">{t('settings.greetingMessageDesc')}</p>
              </div>
            </div>
            <textarea
              className="input min-h-[80px]"
              placeholder={t('settings.greetingMessagePlaceholder')}
              value={settings.greetingMessage}
              onChange={(e) => setSettings({ ...settings, greetingMessage: e.target.value })}
            />
          </Card>

          {/* Away Message */}
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-surface-100 flex items-center justify-center">
                <Clock className="w-5 h-5 text-surface-600" />
              </div>
              <div>
                <p className="font-medium text-surface-900">{t('settings.awayMessage')}</p>
                <p className="text-sm text-surface-500">{t('settings.awayMessageDesc')}</p>
              </div>
            </div>
            <textarea
              className="input min-h-[80px]"
              placeholder={t('settings.awayMessagePlaceholder')}
              value={settings.awayMessage}
              onChange={(e) => setSettings({ ...settings, awayMessage: e.target.value })}
            />
          </Card>

          {/* Notifications */}
          <SimpleToggle
            icon={<Bell className="w-5 h-5 text-brand-600" />}
            title={t('settings.notifications')}
            description={t('settings.emailNotifications')}
            enabled={settings.notificationsEnabled}
            onChange={(enabled) => setSettings({ ...settings, notificationsEnabled: enabled })}
          />

          {/* Delete Account */}
          <Card className="border-red-200 bg-red-50/50">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="font-medium text-red-700">{t('settings.dangerZone')}</h4>
                <p className="text-sm text-red-600 mt-1">{t('settings.deleteAccountWarning')}</p>
              </div>
              <Button variant="danger" size="sm">
                {t('settings.deleteAccount')}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </DashboardLayout>
  );
}
