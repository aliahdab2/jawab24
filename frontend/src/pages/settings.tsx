import { useState, useEffect, useCallback, useRef } from 'react';
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
  ChevronRight,
  MessagesSquare,
  Send
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
    <div className={`flex items-center justify-between gap-4 p-4 rounded-2xl border transition-all duration-300 ${enabled ? 'bg-brand-50/30 border-brand-100 shadow-sm' : 'bg-white border-surface-200'
      }`}>
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${enabled ? 'bg-brand-100 text-brand-600' : 'bg-surface-100 text-surface-400'
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

  // Use ref for setLanguage to avoid dependency issues
  const setLanguageRef = useRef(setLanguage);
  setLanguageRef.current = setLanguage;

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
    commentReplyMode: 'public',
    commentsAutoReply: true,
    messagesAutoReply: true,
    businessHoursOnly: false,
    businessHoursStart: '09:00',
    businessHoursEnd: '18:00',
    awayMessage: '',
    greetingMessage: '',
    replyDelay: 0,
    dualReplyConfig: { en: '', ar: '' } as Record<string, string>,
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
        commentReplyMode: data.commentReplyMode || prev.commentReplyMode,
        commentsAutoReply: data.commentsAutoReply ?? prev.commentsAutoReply,
        messagesAutoReply: data.messagesAutoReply ?? prev.messagesAutoReply,
        businessHoursOnly: data.businessHoursOnly ?? prev.businessHoursOnly,
        businessHoursStart: data.businessHoursStart || prev.businessHoursStart,
        businessHoursEnd: data.businessHoursEnd || prev.businessHoursEnd,
        awayMessage: data.awayMessage || '',
        greetingMessage: data.greetingMessage || '',
        replyDelay: data.replyDelay ?? prev.replyDelay,
        dualReplyConfig: data.dualReplyConfig || { en: '', ar: '' },
      }));

      // Sync language ONCE when settings load (not continuously)
      if (data.dashboardLanguage && data.dashboardLanguage !== language) {
        setLanguageRef.current(data.dashboardLanguage as 'ar' | 'en');
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  }, [token, apiUrl]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

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
      {/* Header with Global Context */}
      <PageHeader
        title={t('settings.title')}
        description={t('settings.pageContext')}
        action={
          <Button
            onClick={handleSave}
            loading={saving}
            icon={saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            variant={saved ? 'secondary' : 'primary'}
            size="lg"
            className="shadow-md hover:shadow-md hover:translate-y-0"
          >
            {saved ? t('settings.settingsSaved') : t('settings.saveSettings')}
          </Button>
        }
      />

      {/* Main Settings - Simplified */}
      <div className="space-y-6 mb-8">
        {/* Language Selection */}
        <Card className="border-none shadow-lg shadow-surface-200/30 p-4">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-10 h-10 rounded-2xl bg-brand-600/10 text-brand-600 flex items-center justify-center">
              <Globe className="w-4 h-4 opacity-50" />
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
              onClick={() => {
                setSettings({ ...settings, dashboardLanguage: 'ar' });
                setLanguage('ar');
              }}
              className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${settings.dashboardLanguage === 'ar'
                ? 'border-brand-500 bg-brand-50/50 shadow-md ring-1 ring-brand-500'
                : 'border-surface-100 bg-surface-50 hover:bg-surface-100'
                }`}
            >
              <span className={`font-bold ${settings.dashboardLanguage === 'ar' ? 'text-brand-900' : 'text-surface-600'}`}>العربية (Arabic)</span>
              {settings.dashboardLanguage === 'ar' && <Check className="w-5 h-5 text-brand-500" />}
            </button>

            <button
              onClick={() => {
                setSettings({ ...settings, dashboardLanguage: 'en' });
                setLanguage('en');
              }}
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



        {/* Comments Automation Card with Nested Logic - MOST IMPORTANT */}
        <Card className={`border-none transition-all duration-300 ${settings.commentsAutoReply ? 'ring-1 ring-brand-200/50' : 'shadow-surface-200/50'} p-4`} style={settings.commentsAutoReply ? { boxShadow: '0 10px 30px rgba(16,185,129,0.12)' } : {}}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${settings.commentsAutoReply ? 'bg-brand-100 text-brand-600' : 'bg-surface-100 text-surface-400'}`}>
                <MessageSquare className="w-4 h-4 opacity-50" />
              </div>
              <div className="text-start">
                <h3 className={`font-bold text-lg ${settings.commentsAutoReply ? 'text-brand-900' : 'text-surface-900'}`}>{t('settings.commentsAutoReply')}</h3>
                <p className="text-sm text-surface-500 font-medium">{t('settings.commentsAutoReplyDesc')}</p>
                <p className="text-xs text-surface-400 mt-1">{t('settings.commentsAutoReplyHelper')}</p>
              </div>
            </div>
            <Toggle
              enabled={settings.commentsAutoReply}
              onChange={(enabled) => setSettings({ ...settings, commentsAutoReply: enabled })}
            />
          </div>

          {/* Nested Reply Mode Options - Only visible if Comments Auto-Reply is ON */}
          {settings.commentsAutoReply && (
            <div className="mt-6 pt-6 border-t border-surface-100 animate-in fade-in slide-in-from-top-2 duration-300">
              <h4 className="text-sm font-bold text-surface-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                {t('settings.commentReplyMode')}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <button
                  onClick={() => setSettings({ ...settings, commentReplyMode: 'public' })}
                  className={`flex items-center justify-between p-4 rounded-xl border transition-all ${settings.commentReplyMode === 'public'
                    ? 'border-brand-500 bg-brand-50/20 shadow-sm'
                    : 'border-surface-200 bg-white hover:border-brand-200 hover:bg-brand-50/10'
                    }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${settings.commentReplyMode === 'public' ? 'bg-brand-100 text-brand-600' : 'bg-surface-100 text-surface-500'}`}>
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <div className="text-start">
                      <span className={`block font-bold ${settings.commentReplyMode === 'public' ? 'text-brand-900' : 'text-surface-700'}`}>
                        {t('settings.publicReply')}
                      </span>
                      <span className="text-xs text-surface-500">{t('settings.publicReplyDesc')}</span>
                    </div>
                  </div>
                  {settings.commentReplyMode === 'public' && <Check className="w-5 h-5 text-brand-500" />}
                </button>

                <button
                  onClick={() => setSettings({ ...settings, commentReplyMode: 'private' })}
                  className={`flex items-center justify-between p-4 rounded-xl border transition-all ${settings.commentReplyMode === 'private'
                    ? 'border-brand-500 bg-brand-50/20 shadow-sm'
                    : 'border-surface-200 bg-white hover:border-brand-200 hover:bg-brand-50/10'
                    }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${settings.commentReplyMode === 'private' ? 'bg-brand-100 text-brand-600' : 'bg-surface-100 text-surface-500'}`}>
                      <Send className="w-5 h-5" />
                    </div>
                    <div className="text-start">
                      <span className={`block font-bold ${settings.commentReplyMode === 'private' ? 'text-brand-900' : 'text-surface-700'}`}>
                        {t('settings.privateReply')}
                      </span>
                      <span className="text-xs text-surface-500">{t('settings.privateReplyDesc')}</span>
                    </div>
                  </div>
                  {settings.commentReplyMode === 'private' && <Check className="w-5 h-5 text-brand-500" />}
                </button>

                <button
                  onClick={() => setSettings({ ...settings, commentReplyMode: 'dual' })}
                  className={`flex items-center justify-between p-4 rounded-xl border transition-all ${settings.commentReplyMode === 'dual'
                    ? 'border-brand-500 bg-brand-50/20 shadow-sm'
                    : 'border-surface-200 bg-white hover:border-brand-200 hover:bg-brand-50/10'
                    }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${settings.commentReplyMode === 'dual' ? 'bg-brand-100 text-brand-600' : 'bg-surface-100 text-surface-500'}`}>
                      <MessagesSquare className="w-5 h-5" />
                    </div>
                    <div className="text-start">
                      <span className={`block font-bold ${settings.commentReplyMode === 'dual' ? 'text-brand-900' : 'text-surface-700'}`}>
                        {t('settings.dualReply')}
                      </span>
                      <span className="text-xs text-surface-500">{t('settings.dualReplyDesc')}</span>
                    </div>
                  </div>
                  {settings.commentReplyMode === 'dual' && <Check className="w-5 h-5 text-brand-500" />}
                </button>
              </div>

              {/* Dual Reply Configuration - Only visible if Dual Mode is ON */}
              {settings.commentReplyMode === 'dual' && (
                <div className="mt-6 p-5 rounded-2xl bg-surface-50 border border-surface-100 animate-slide-up">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center shadow-inner">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <div className="text-start">
                      <h4 className="font-bold text-surface-900 text-base">{t('settings.dualReplyConfigTitle')}</h4>
                      <p className="text-xs text-surface-500 font-medium">{t('settings.dualReplyConfigDesc')}</p>
                    </div>
                  </div>
                  <Input
                    value={settings.dualReplyConfig?.en || ''}
                    onChange={(e) => setSettings({
                      ...settings,
                      dualReplyConfig: { en: e.target.value, ar: e.target.value }
                    })}
                    placeholder={t('settings.publicReplyPlaceholder')}
                    className="bg-white"
                  />
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Messages & AI Toggles - Lighter Visual Weight */}
        <div className="space-y-3">
          <SimpleToggle
            icon={<MessageCircle className="w-5 h-5" />}
            title={t('settings.messagesAutoReply')}
            description={t('settings.messagesAutoReplyDesc')}
            enabled={settings.messagesAutoReply}
            onChange={(enabled) => setSettings({ ...settings, messagesAutoReply: enabled })}
          />
          <SimpleToggle
            icon={<Bot className="w-5 h-5" />}
            title={t('settings.enableAI')}
            description={t('settings.aiDescription')}
            enabled={settings.aiEnabled}
            onChange={(enabled) => setSettings({ ...settings, aiEnabled: enabled })}
          />
        </div>
      </div>

      {/* Advanced Settings Toggle - Lighter Style */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all duration-300 mb-6 ${showAdvanced ? 'bg-surface-50 border-surface-200 shadow-sm' : 'bg-white border-surface-200 hover:border-surface-300 hover:bg-surface-50'
          }`}
      >
        <div className="flex items-center gap-4">
          <div className={`p-2 rounded-lg ${showAdvanced ? 'bg-surface-200 text-surface-600' : 'bg-surface-100 text-surface-500'}`}>
            <Settings2 className="w-5 h-5" />
          </div>
          <div className="text-start">
            <span className={`block font-bold ${showAdvanced ? 'text-surface-900' : 'text-surface-700'}`}>
              {showAdvanced ? t('settings.hideAdvanced') : t('settings.showAdvanced')}
            </span>
            <p className={`text-xs ${showAdvanced ? 'text-surface-500' : 'text-surface-400'}`}>
              {t('settings.advancedDescription')}
            </p>
          </div>
        </div>
        {showAdvanced ? (
          <ChevronUp className="w-5 h-5 text-surface-600" />
        ) : (
          <ChevronDown className="w-5 h-5 text-surface-400" />
        )}
      </button>

      {/* Advanced Settings - Hidden by default */}
      {
        showAdvanced && (
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
            <Card className="border-none shadow-md shadow-surface-200/30 p-4 overflow-hidden">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${settings.businessHoursOnly ? 'bg-brand-100 text-brand-600' : 'bg-surface-100 text-surface-400'}`}>
                    <Clock className="w-4 h-4 opacity-50" />
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

            {/* Compact Row: Reply Speed + Notifications */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Reply Delay */}
              <Card className="border-none shadow-md shadow-surface-200/30 p-4">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center">
                    <Zap className="w-4 h-4 opacity-50" />
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
              <Card className="border-none shadow-md shadow-surface-200/30 p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${settings.notificationsEnabled ? 'bg-brand-100 text-brand-600' : 'bg-surface-100 text-surface-400'}`}>
                      <Bell className="w-4 h-4 opacity-50" />
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
              <Card className="border-none shadow-lg shadow-surface-200/50 p-5">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center">
                    <MessageCircle className="w-4 h-4 opacity-50" />
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

              <Card className="border-none shadow-lg shadow-surface-200/50 p-5">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-surface-100 text-surface-600 flex items-center justify-center">
                    <Clock className="w-4 h-4 opacity-50" />
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
        )
      }
    </DashboardLayout >
  );
}
