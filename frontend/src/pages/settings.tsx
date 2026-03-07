import { useState, useEffect, useCallback, type ReactElement } from 'react';
import clsx from 'clsx';
import { DEFAULT_HANDOFF_PAUSE_MINUTES } from '@jawab24/shared';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button, PageHeader, PageSkeleton } from '@/components/ui';
import { useAuthStore } from '@/lib/store';
import { toast } from 'sonner';
import { useRouter } from 'next/router';
import { settingsApi, api } from '@/lib/api';
import {
  Save,
  MessageCircle,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Settings2,
} from 'lucide-react';
import { useTranslation, useLanguage } from '@/i18n';
import { captureError } from '@/lib/sentryHelpers';
import type { NextPageWithLayout } from './_app';
import {
  SimpleToggle,
  LanguageSelector,
  ThemeSelector,
  CommentsAutoReplyCard,
  BusinessHoursCard,
  ReplyDelayCard,
  NotificationsCard,
  HandoffPauseCard,
  GreetingMessageCard,
  ReplyStyleCard,
  DangerZone,
} from '@/components/settings';
import type { SettingsState } from '@/components/settings';

const INITIAL_SETTINGS: SettingsState = {
  dashboardLanguage: 'en',
  defaultReplyLanguage: 'ar',
  autoDetectLanguage: true,
  aiEnabled: true,
  aiModel: 'gpt-4o-mini',
  notificationsEnabled: true,
  pushNotifications: true,
  commentReplyMode: 'public',
  commentsAutoReply: true,
  messagesAutoReply: true,
  businessHoursOnly: false,
  businessHoursStart: '09:00',
  businessHoursEnd: '18:00',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  awayMessageMulti: {},
  greetingMessageMulti: {},
  dualReplyNudgeMulti: {},
  brandVoiceNotesMulti: {},
  awayMessage: '',
  greetingMessage: '',
  replyDelay: 0,
  dualReplyNudge: '',
  commentEscalationMinutes: 60,
  messageEscalationMinutes: 30,
  handoffPauseDurationMinutes: DEFAULT_HANDOFF_PAUSE_MINUTES,
  replyStyle: 'professional',
  brandVoiceNotes: '',
  holdLowConfidence: false,
};

const SettingsPage: NextPageWithLayout = () => {
  const { t, language } = useTranslation();
  const { setLanguage } = useLanguage();
  const { isAuthenticated } = useAuthStore();
  const router = useRouter();

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [settings, setSettings] = useState<SettingsState>({ ...INITIAL_SETTINGS, dashboardLanguage: language });
  const [initialSettings, setInitialSettings] = useState<SettingsState>({ ...INITIAL_SETTINGS, dashboardLanguage: language });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(initialSettings);

  // Update current time every minute for real-time status badge
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const response = await settingsApi.get();
      const data = response.data;

      if (data.dashboardLanguage && data.dashboardLanguage !== language) {
        setLanguage(data.dashboardLanguage as 'ar' | 'en');
        return;
      }

      const newSettings: SettingsState = {
        dashboardLanguage: data.dashboardLanguage || language,
        defaultReplyLanguage: data.defaultReplyLanguage || 'ar',
        autoDetectLanguage: data.autoDetectLanguage ?? true,
        aiEnabled: data.aiEnabled ?? true,
        aiModel: data.aiModel || 'gpt-4o-mini',
        commentReplyMode: data.commentReplyMode || 'public',
        commentsAutoReply: data.commentsAutoReply ?? true,
        messagesAutoReply: data.messagesAutoReply ?? true,
        businessHoursOnly: data.businessHoursOnly ?? false,
        businessHoursStart: (data.businessHoursStart && data.businessHoursStart !== '00:00') ? data.businessHoursStart : '09:00',
        businessHoursEnd: (data.businessHoursEnd && data.businessHoursEnd !== '00:00') ? data.businessHoursEnd : '18:00',
        timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        awayMessageMulti: data.awayMessageMulti || {},
        greetingMessageMulti: data.greetingMessageMulti || {},
        dualReplyNudgeMulti: data.dualReplyNudgeMulti || {},
        brandVoiceNotesMulti: data.brandVoiceNotesMulti && Object.keys(data.brandVoiceNotesMulti).some(k => k !== 'sourceLang' && data.brandVoiceNotesMulti[k])
          ? data.brandVoiceNotesMulti
          : data.brandVoiceNotes
            ? { [data.dashboardLanguage || language]: data.brandVoiceNotes, sourceLang: data.dashboardLanguage || language }
            : {},
        awayMessage: data.awayMessage || '',
        greetingMessage: data.greetingMessage || '',
        replyDelay: data.replyDelay ?? 0,
        dualReplyNudge: data.dualReplyNudge || '',
        commentEscalationMinutes: data.commentEscalationMinutes ?? 60,
        messageEscalationMinutes: data.messageEscalationMinutes ?? 30,
        handoffPauseDurationMinutes: data.handoffPauseDurationMinutes ?? DEFAULT_HANDOFF_PAUSE_MINUTES,
        notificationsEnabled: data.notificationsEnabled ?? true,
        pushNotifications: data.pushNotifications ?? true,
        replyStyle: data.replyStyle || 'professional',
        brandVoiceNotes: data.brandVoiceNotes || '',
        holdLowConfidence: data.holdLowConfidence ?? false,
      };
      setSettings(newSettings);
      setInitialSettings(newSettings);
    } catch (error) {
      captureError(error, 'Failed to fetch settings', { tags: { page: 'settings' } });
    } finally {
      setLoading(false);
    }
  }, [language, setLanguage]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchSettings();
    }
  }, [isAuthenticated, fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      if (settings.dashboardLanguage && settings.dashboardLanguage !== language) {
        setLanguage(settings.dashboardLanguage as 'ar' | 'en');
      }

      const response = await settingsApi.update(settings as unknown as Record<string, unknown>);
      const data = response.data;
      if (data) {
        const updatedSettings = { ...settings, ...data };
        setSettings(updatedSettings);
        setInitialSettings(updatedSettings);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      captureError(error, 'Failed to save settings', { tags: { page: 'settings', action: 'save' } });
      toast.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    setSaving(true);
    try {
      await api.delete('/auth/me');
      setSaving(false);

      setTimeout(async () => {
        await useAuthStore.getState().logout();
        router.replace('/');
      }, 2500);
    } catch (error: unknown) {
      const axiosErr = error as { response?: { data?: { error?: string; code?: string }; status?: number } };
      const status = axiosErr.response?.status;
      captureError(error, 'Failed to delete account', { tags: { page: 'settings', action: 'delete-account' } });
      setSaving(false);
      if (status === 404) {
        setTimeout(async () => {
          await useAuthStore.getState().logout();
          router.replace('/');
        }, 2500);
        return;
      }
      toast.error(t('common.error'));
    }
  };

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <>
      <PageHeader
        title={t('settings.title')}
        description={t('settings.pageContext')}
      />

      {/* Sticky Save Button */}
      <div className="lg:sticky lg:top-0 lg:z-10 mb-6 landscape:mb-4">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          icon={saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          variant={hasChanges ? 'primary' : 'secondary'}
          size="lg"
          className={clsx(
            'w-full shadow-2xl hover:shadow-2xl hover:translate-y-0 landscape:py-2.5 landscape:text-base disabled:opacity-50 disabled:cursor-not-allowed transition-all',
            saved && '!bg-green-500 !text-white hover:!bg-green-600'
          )}
        >
          {saving
            ? t('common.saving')
            : saved
              ? t('settings.settingsSaved')
              : t('settings.saveSettings')
          }
        </Button>
      </div>

      {/* Main Settings */}
      <div className="space-y-4 sm:space-y-6 landscape:space-y-4 mb-6 sm:mb-8 landscape:mb-4">
        <LanguageSelector
          settings={settings}
          initialSettings={initialSettings}
          setSettings={setSettings}
          setInitialSettings={setInitialSettings}
          setLanguage={setLanguage}
        />

        <ThemeSelector />

        <CommentsAutoReplyCard settings={settings} setSettings={setSettings} />

        {/* Messages & AI Toggles */}
        <div className="space-y-3 landscape:space-y-2">
          <SimpleToggle
            icon={<MessageCircle className="w-6 h-6 landscape:w-5 landscape:h-5" />}
            title={t('settings.messagesAutoReply')}
            description={t('settings.messagesAutoReplyDesc')}
            enabled={settings.messagesAutoReply}
            onChange={(enabled) => setSettings({ ...settings, messagesAutoReply: enabled })}
          />
          <SimpleToggle
            icon={<Bot className="w-6 h-6 landscape:w-5 landscape:h-5" />}
            title={t('settings.enableAI')}
            description={t('settings.aiDescriptionImproved')}
            enabled={settings.aiEnabled}
            onChange={(enabled) => setSettings({ ...settings, aiEnabled: enabled })}
          />
        </div>

        {settings.aiEnabled && (
          <ReplyStyleCard settings={settings} setSettings={setSettings} />
        )}
      </div>

      {/* Advanced Settings Toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className={`w-full flex items-center justify-between p-4 landscape:p-3 rounded-xl border transition-all duration-300 mb-6 landscape:mb-4 ${showAdvanced ? 'bg-background border-theme-border shadow-sm' : 'bg-card border-theme-border hover:border-theme-border hover:bg-background'
          }`}
      >
        <div className="flex items-center gap-4">
          <div className={`p-2 rounded-lg ${showAdvanced ? 'bg-muted text-muted-foreground' : 'bg-muted text-muted-foreground'}`}>
            <Settings2 className="w-6 h-6 landscape:w-5 landscape:h-5" />
          </div>
          <div className="text-start">
            <span className={`block font-bold landscape:text-sm ${showAdvanced ? 'text-foreground' : 'text-foreground/70'}`}>
              {showAdvanced ? t('settings.hideAdvanced') : t('settings.showAdvanced')}
            </span>
            <p className={`text-xs landscape:hidden ${showAdvanced ? 'text-muted-foreground' : 'text-muted-foreground'}`}>
              {t('settings.advancedDescription')}
            </p>
          </div>
        </div>
        {showAdvanced ? (
          <ChevronUp className="w-5 h-5 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-5 h-5 text-muted-foreground" />
        )}
      </button>

      {/* Advanced Settings */}
      {showAdvanced && (
        <div className="space-y-4 sm:space-y-6 landscape:space-y-4 animate-slide-up pb-4 sm:pb-6">
          <BusinessHoursCard settings={settings} setSettings={setSettings} currentTime={currentTime} />

          <div className="grid grid-cols-1 md:grid-cols-2 landscape:grid-cols-2 gap-4">
            <ReplyDelayCard settings={settings} setSettings={setSettings} />
            <NotificationsCard settings={settings} setSettings={setSettings} />
          </div>

          <HandoffPauseCard settings={settings} setSettings={setSettings} />
          <GreetingMessageCard settings={settings} setSettings={setSettings} />
        </div>
      )}

      <DangerZone onDeleteAccount={handleDeleteAccount} saving={saving} />
    </>
  );
};

SettingsPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Settings">{page}</DashboardLayout>
);

export default SettingsPage;
