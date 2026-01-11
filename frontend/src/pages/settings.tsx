import { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Input, Toggle, PageHeader, PageSkeleton, Modal } from '@/components/ui';
import { useAuthStore } from '@/lib/store';
import { toast } from 'sonner';
import { useRouter } from 'next/router';
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
  Send,
  AlertTriangle,
  CheckCircle2
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
  const router = useRouter();

  // Show/hide advanced settings
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [isDeleted, setIsDeleted] = useState(false);

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
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  }, [token, apiUrl]);

  // Fetch settings on mount
  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Separate effect: Sync language when settings.dashboardLanguage changes
  // This is the industry-standard pattern for side effects
  useEffect(() => {
    if (settings.dashboardLanguage && settings.dashboardLanguage !== language) {
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

  const handleDeleteAccount = async () => {
    if (!token) return;
    setSaving(true);
    try {
      await axios.delete(`${apiUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      // Success state (Best Practice: Give user feedback before redirecting)
      setIsDeleted(true);
      setSaving(false);
      
      // Artificial delay to let the user see the success message
      setTimeout(async () => {
        await useAuthStore.getState().logout();
        // Use replace instead of push to prevent going back to settings after deletion
        router.replace('/');
      }, 2500);
      
    } catch (error) {
      console.error('Failed to delete account:', error);
      setSaving(false);
      // Don't show success, just close or stay
      toast.error(t('common.error'));
    }
  };

  if (loading) {
    return (
      <DashboardLayout title={t('settings.title')}>
        <PageSkeleton />
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
        {/* Language Selection - Compact Segmented Control */}
        <Card className="border-none shadow-[0_10_30px_rgba(0,0,0,0.04)] p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-2xl bg-brand-600/10 text-brand-600 flex items-center justify-center">
                <Globe className="w-5 h-5" />
              </div>
              <div className="text-start">
                <h3 className="font-bold text-surface-900 text-base">{t('settings.language')}</h3>
              </div>
            </div>

            {/* Segmented Control */}
            <div className="flex gap-1 p-1 bg-surface-100 rounded-xl">
              <button
                onClick={() => {
                  setSettings({ ...settings, dashboardLanguage: 'ar' });
                  setLanguage('ar');
                }}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${settings.dashboardLanguage === 'ar'
                  ? 'bg-white text-brand-600 shadow-sm'
                  : 'text-surface-600 hover:text-surface-900'
                  }`}
              >
                العربية
              </button>
              <button
                onClick={() => {
                  setSettings({ ...settings, dashboardLanguage: 'en' });
                  setLanguage('en');
                }}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${settings.dashboardLanguage === 'en'
                  ? 'bg-white text-brand-600 shadow-sm'
                  : 'text-surface-600 hover:text-surface-900'
                  }`}
              >
                English
              </button>
            </div>
          </div>
        </Card>

        {/* Auto Reply Toggles */}



        {/* Comments Automation Card with Nested Logic - MOST IMPORTANT */}
        <Card className={clsx(
          "border-none transition-all duration-300 p-4",
          settings.commentsAutoReply ? 'ring-1 ring-brand-200/50 shadow-[0_10px_30px_rgba(16,185,129,0.12)]' : 'shadow-[0_10px_30px_rgba(0,0,0,0.04)]'
        )}>
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

              {/* Dual Reply Configuration - Connected to the 3rd option */}
              {settings.commentReplyMode === 'dual' && (
                <div className="mt-4 p-5 rounded-2xl bg-brand-50/20 border border-brand-200/50 animate-slide-up relative shadow-sm">
                  {/* Visual Connector Notch */}
                  <div className="absolute -top-2 start-1/2 -translate-x-1/2 sm:start-auto sm:translate-x-0 sm:end-12 w-4 h-4 bg-brand-50/20 border-t border-s border-brand-200/50 rotate-45 shadow-sm" />
                  
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center shadow-inner">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <div className="text-start">
                      <h4 className="font-bold text-brand-900 text-base">{t('settings.dualReplyConfigTitle')}</h4>
                      <p className="text-xs text-brand-700/70 font-medium">{t('settings.dualReplyConfigDesc')}</p>
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

          </div>
        )
      }

      {/* Danger Zone - Aesthetic but Low Salience */}
      <div className="mt-20 pt-10 border-t border-surface-100 mb-20 animate-slide-up" style={{ animationDelay: '0.2s' }}>
        <Card className="border-none bg-red-50/30 p-6 flex flex-col sm:flex-row items-center justify-between gap-6 overflow-hidden">
          <div className="flex-1 text-start">
            <h4 className="font-bold text-red-900 text-lg mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              {t('settings.dangerZone')}
            </h4>
            <p className="text-sm text-red-700/70 font-medium leading-relaxed max-w-xl">
              {t('settings.deleteAccountWarning')}
            </p>
          </div>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="
              inline-flex items-center 
              whitespace-nowrap
              rounded-lg
              border border-red-200 
              bg-white 
              px-3 py-1.5
              text-xs font-bold 
              text-red-500 
              shadow-sm
              transition-all 
              hover:bg-red-50 
              hover:border-red-300 
              hover:text-red-600 
              active:scale-95
              focus:outline-none focus:ring-2 focus:ring-red-50
            "
          >
            {t('settings.deleteAccount')}
          </button>
        </Card>
      </div>

      {/* Delete Account Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setDeleteConfirmation('');
        }}
        title={t('settings.deleteAccount')}
      >
        <div className="space-y-6">
          {isDeleted ? (
            <div className="py-8 flex flex-col items-center text-center animate-In fade-in zoom-in duration-500">
              <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-6 animate-bounce-subtle">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold text-surface-900 mb-2">
                {t('settings.deleteSuccess')}
              </h3>
            </div>
          ) : (
            <>
              <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-red-800">
                <p className="font-bold mb-2 flex items-center gap-2">
                  <span className="text-xl">⚠️</span>
                  {t('common.warning')}
                </p>
                <p className="text-sm leading-relaxed">{t('settings.deleteAccountWarning')}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-700 mb-2">
                  {t('settings.deleteConfirmLabel')}
                </label>
                <Input
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                  placeholder="DELETE"
                  className="border-red-200 focus:border-red-500 focus:ring-red-500"
                />
              </div>

              <div className="flex gap-4">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setDeleteConfirmation('');
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={handleDeleteAccount}
                  loading={saving}
                  disabled={deleteConfirmation.trim().toUpperCase() !== 'DELETE'}
                >
                  {t('settings.deleteAccount')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </DashboardLayout >
  );
}
