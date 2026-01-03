import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Input, Toggle, PageHeader, PageSpinner } from '@/components/ui';
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

// Simple toggle row component with better design
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
    <div className={`flex items-center justify-between gap-4 p-5 rounded-2xl border transition-all duration-300 ${enabled ? 'bg-brand-50/30 border-brand-100 shadow-sm' : 'bg-white border-surface-200'
      }`}>
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <div className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${enabled ? 'bg-brand-100 text-brand-600' : 'bg-surface-100 text-surface-400'
          }`}>
          {icon}
        </div>
        <div className="text-start min-w-0">
          <p className={`font-bold ${enabled ? 'text-brand-900' : 'text-surface-900'}`}>{title}</p>
          <p className="text-xs font-medium text-surface-500 leading-relaxed">{description}</p>
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

      {/* Main Settings - Simplified */}
      <div className="space-y-6 mb-8">
        {/* Language Selection */}
        <Card className="border-none shadow-xl shadow-surface-200/50 p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-brand-600 text-white flex items-center justify-center shadow-lg shadow-brand-100">
              <Globe className="w-7 h-7" />
            </div>
            <div className="text-start">
              <h3 className="font-bold text-surface-900 text-xl">{t('settings.language')}</h3>
              <p className="text-surface-500 text-sm font-medium">
                {t('settings.languageDescription')}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={() => setSettings({ ...settings, dashboardLanguage: 'ar' })}
              className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${settings.dashboardLanguage === 'ar'
                  ? 'border-brand-500 bg-brand-50/50 shadow-md ring-1 ring-brand-500'
                  : 'border-surface-100 bg-surface-50 hover:bg-surface-100'
                }`}
            >
              <span className={`font-bold ${settings.dashboardLanguage === 'ar' ? 'text-brand-900' : 'text-surface-600'}`}>العربية (Arabic)</span>
              {settings.dashboardLanguage === 'ar' && <Check className="w-5 h-5 text-brand-500" />}
            </button>

            <button
              onClick={() => setSettings({ ...settings, dashboardLanguage: 'en' })}
              className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${settings.dashboardLanguage === 'en'
                  ? 'border-brand-500 bg-brand-50/50 shadow-md ring-1 ring-brand-500'
                  : 'border-surface-100 bg-surface-50 hover:bg-surface-100'
                }`}
            >
              <span className={`font-bold ${settings.dashboardLanguage === 'en' ? 'text-brand-900' : 'text-surface-600'}`}>English</span>
              {settings.dashboardLanguage === 'en' && <Check className="w-5 h-5 text-brand-500" />}
            </button>
          </div>
        </Card>

        {/* Auto Reply Toggles */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SimpleToggle
            icon={<MessageSquare className="w-6 h-6" />}
            title={t('settings.commentsAutoReply')}
            description={t('settings.commentsAutoReplyDesc')}
            enabled={settings.commentsAutoReply}
            onChange={(enabled) => setSettings({ ...settings, commentsAutoReply: enabled })}
          />

          <SimpleToggle
            icon={<MessageCircle className="w-6 h-6" />}
            title={t('settings.messagesAutoReply')}
            description={t('settings.messagesAutoReplyDesc')}
            enabled={settings.messagesAutoReply}
            onChange={(enabled) => setSettings({ ...settings, messagesAutoReply: enabled })}
          />
        </div>

        <SimpleToggle
          icon={<Bot className="w-6 h-6" />}
          title={t('settings.enableAI')}
          description={t('settings.aiDescription')}
          enabled={settings.aiEnabled}
          onChange={(enabled) => setSettings({ ...settings, aiEnabled: enabled })}
        />
      </div>

      {/* Advanced Settings Toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className={`w-full flex items-center justify-between p-5 rounded-2xl border-2 transition-all duration-300 mb-6 ${showAdvanced ? 'bg-surface-900 border-surface-900 shadow-lg' : 'bg-white border-surface-200 hover:border-brand-300'
          }`}
      >
        <div className="flex items-center gap-4">
          <div className={`p-2.5 rounded-xl ${showAdvanced ? 'bg-surface-800 text-brand-400' : 'bg-surface-100 text-surface-500'}`}>
            <Settings2 className="w-6 h-6" />
          </div>
          <div className="text-start">
            <span className={`block font-bold text-lg ${showAdvanced ? 'text-white' : 'text-surface-700'}`}>
              {showAdvanced ? t('settings.hideAdvanced') : t('settings.showAdvanced')}
            </span>
            <p className={`text-xs ${showAdvanced ? 'text-surface-400' : 'text-surface-500'}`}>
              {t('settings.advancedDescription')}
            </p>
          </div>
        </div>
        {showAdvanced ? (
          <ChevronUp className="w-6 h-6 text-brand-400" />
        ) : (
          <ChevronDown className="w-6 h-6 text-surface-400" />
        )}
      </button>

      {/* Advanced Settings - Hidden by default */}
      {showAdvanced && (
        <div className="space-y-6 animate-slide-up pb-12">
          {/* Templates & Rules Links - Prominent Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link href="/templates" className="group">
              <Card className="h-full border-none shadow-lg shadow-surface-200/50 hover:shadow-xl hover:-translate-y-1 transition-all p-6 group-hover:bg-brand-50/10">
                <div className="flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-2xl bg-violet-100 text-violet-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-inner">
                    <BookTemplate className="w-8 h-8" />
                  </div>
                  <h4 className="text-lg font-bold text-surface-900 mb-1">{t('nav.templates')}</h4>
                  <p className="text-sm text-surface-500 mb-6">
                    {t('settings.templatesCardDesc')}
                  </p>
                  <div className="mt-auto flex items-center gap-1 text-violet-600 font-bold text-sm uppercase tracking-widest">
                    <span>{t('settings.viewTemplates')}</span>
                    <ChevronRight className={`w-4 h-4 ${language === 'ar' ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              </Card>
            </Link>

            <Link href="/rules" className="group">
              <Card className="h-full border-none shadow-lg shadow-surface-200/50 hover:shadow-xl hover:-translate-y-1 transition-all p-6 group-hover:bg-amber-50/10">
                <div className="flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-inner">
                    <Zap className="w-8 h-8" />
                  </div>
                  <h4 className="text-lg font-bold text-surface-900 mb-1">{t('nav.rules')}</h4>
                  <p className="text-sm text-surface-500 mb-6">
                    {t('settings.rulesCardDesc')}
                  </p>
                  <div className="mt-auto flex items-center gap-1 text-amber-600 font-bold text-sm uppercase tracking-widest">
                    <span>{t('settings.viewRules')}</span>
                    <ChevronRight className={`w-4 h-4 ${language === 'ar' ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              </Card>
            </Link>
          </div>

          {/* Business Hours */}
          <Card className="border-none shadow-lg shadow-surface-200/50 p-6 overflow-hidden">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${settings.businessHoursOnly ? 'bg-brand-100 text-brand-600 shadow-inner' : 'bg-surface-100 text-surface-400'}`}>
                  <Clock className="w-6 h-6" />
                </div>
                <div className="text-start">
                  <h4 className="font-bold text-surface-900 text-lg">{t('settings.businessHours')}</h4>
                  <p className="text-xs text-surface-500 font-medium">{t('settings.businessHoursDesc')}</p>
                </div>
              </div>
              <Toggle enabled={settings.businessHoursOnly} onChange={(enabled) => setSettings({ ...settings, businessHoursOnly: enabled })} />
            </div>

            {settings.businessHoursOnly && (
              <div className="grid grid-cols-2 gap-6 p-5 rounded-2xl bg-surface-50 border border-surface-100 animate-slide-up">
                <div>
                  <label className="block text-[10px] font-bold text-surface-400 uppercase tracking-widest mb-2">{t('settings.businessHoursStart')}</label>
                  <div className="relative">
                    <Clock className="absolute top-1/2 -translate-y-1/2 start-4 w-4 h-4 text-surface-400" />
                    <Input
                      type="time"
                      value={settings.businessHoursStart}
                      onChange={(e) => setSettings({ ...settings, businessHoursStart: e.target.value })}
                      className="ps-10 py-4 font-bold border-none bg-white shadow-sm focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-surface-400 uppercase tracking-widest mb-2">{t('settings.businessHoursEnd')}</label>
                  <div className="relative">
                    <Clock className="absolute top-1/2 -translate-y-1/2 start-4 w-4 h-4 text-surface-400" />
                    <Input
                      type="time"
                      value={settings.businessHoursEnd}
                      onChange={(e) => setSettings({ ...settings, businessHoursEnd: e.target.value })}
                      className="ps-10 py-4 font-bold border-none bg-white shadow-sm focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                </div>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Reply Delay */}
            <Card className="border-none shadow-lg shadow-surface-200/50 p-6">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center shadow-inner">
                  <Zap className="w-6 h-6" />
                </div>
                <div className="text-start">
                  <h4 className="font-bold text-surface-900 text-lg">{t('settings.responseTime')}</h4>
                  <p className="text-xs text-surface-500 font-medium">{t('settings.replyDelay')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={0}
                  max={60}
                  value={settings.replyDelay}
                  onChange={(e) => setSettings({ ...settings, replyDelay: parseInt(e.target.value) || 0 })}
                  className="w-full py-4 text-center font-bold text-lg border-none bg-surface-50 focus:ring-2 focus:ring-brand-500"
                />
                <span className="text-sm font-bold text-surface-400 uppercase tracking-widest">{t('settings.seconds')}</span>
              </div>
            </Card>

            {/* Notifications */}
            <Card className="border-none shadow-lg shadow-surface-200/50 p-6 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${settings.notificationsEnabled ? 'bg-brand-100 text-brand-600 shadow-inner' : 'bg-surface-100 text-surface-400'}`}>
                    <Bell className="w-6 h-6" />
                  </div>
                  <div className="text-start">
                    <h4 className="font-bold text-surface-900 text-lg">{t('settings.notifications')}</h4>
                    <p className="text-xs text-surface-500 font-medium">{t('settings.emailNotifications')}</p>
                  </div>
                </div>
                <Toggle enabled={settings.notificationsEnabled} onChange={(enabled) => setSettings({ ...settings, notificationsEnabled: enabled })} />
              </div>
            </Card>
          </div>

          {/* Messaging */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="border-none shadow-lg shadow-surface-200/50 p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center shadow-inner">
                  <MessageCircle className="w-6 h-6" />
                </div>
                <div className="text-start">
                  <h4 className="font-bold text-surface-900 text-lg">{t('settings.greetingMessage')}</h4>
                  <p className="text-xs text-surface-500 font-medium">{t('settings.greetingMessageDesc')}</p>
                </div>
              </div>
              <textarea
                className="input min-h-[100px] border-none bg-surface-50 focus:ring-2 focus:ring-brand-500 p-4 rounded-2xl italic italic-arabic"
                placeholder={t('settings.greetingMessagePlaceholder')}
                value={settings.greetingMessage}
                onChange={(e) => setSettings({ ...settings, greetingMessage: e.target.value })}
              />
            </Card>

            <Card className="border-none shadow-lg shadow-surface-200/50 p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-surface-100 text-surface-600 flex items-center justify-center shadow-inner">
                  <Clock className="w-6 h-6" />
                </div>
                <div className="text-start">
                  <h4 className="font-bold text-surface-900 text-lg">{t('settings.awayMessage')}</h4>
                  <p className="text-xs text-surface-500 font-medium">{t('settings.awayMessageDesc')}</p>
                </div>
              </div>
              <textarea
                className="input min-h-[100px] border-none bg-surface-50 focus:ring-2 focus:ring-brand-500 p-4 rounded-2xl italic italic-arabic"
                placeholder={t('settings.awayMessagePlaceholder')}
                value={settings.awayMessage}
                onChange={(e) => setSettings({ ...settings, awayMessage: e.target.value })}
              />
            </Card>
          </div>

          {/* Delete Account */}
          <Card className="border-none shadow-lg shadow-red-100/50 bg-red-50/30 p-8">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="text-center sm:text-start">
                <h4 className="font-bold text-red-700 text-lg">{t('settings.dangerZone')}</h4>
                <p className="text-sm text-red-600/80 font-medium mt-1">{t('settings.deleteAccountWarning')}</p>
              </div>
              <Button variant="danger" className="px-8 py-4 shadow-lg shadow-red-200">
                {t('settings.deleteAccount')}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </DashboardLayout>
  );
}
