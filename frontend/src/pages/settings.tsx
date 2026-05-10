import { useState, useEffect, useCallback, type ReactElement } from 'react';
import clsx from 'clsx';
import { DEFAULT_HANDOFF_PAUSE_MINUTES } from '@jawab24/shared';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button, PageHeader, PageSkeleton } from '@/components/ui';
import { useAuthStore, useUIStore } from '@/lib/store';
import { toast } from 'sonner';
import { useRouter } from 'next/router';
import { settingsApi, api } from '@/lib/api';
import {
  Save,
  MessageCircle,
  Bot,
  Check,
  Settings2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { captureError } from '@/lib/sentryHelpers';
import { useWorkspaceRole, usePersistedBoolean } from '@/hooks';
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
  LowConfidenceHoldCard,
  DangerZone,
  TeamSection,
  CollapsibleSectionHeader,
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
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const { language, setLanguage } = useLanguage();
  const { isAuthenticated } = useAuthStore();
  const { canEdit } = useWorkspaceRole();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const router = useRouter();

  const [showAdvanced, setShowAdvanced] = usePersistedBoolean('settings:advanced:expanded', false);
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
        brandVoiceNotesMulti: data.brandVoiceNotesMulti || {},
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
  }, [language]);

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
      toast.error(tc('error'));
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
      toast.error(tc('error'));
    }
  };

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="pb-24 landscape:pb-20">
      <PageHeader
        title={t('title')}
        description={t('pageContext')}
      />

      {/* Section: General */}
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3 mt-2">{t('general')}</p>
      <div className="space-y-4 sm:space-y-6 landscape:space-y-4 mb-8 sm:mb-10 landscape:mb-6">
        <LanguageSelector
          settings={settings}
          initialSettings={initialSettings}
          setSettings={setSettings}
          setInitialSettings={setInitialSettings}
          setLanguage={setLanguage}
        />
        <ThemeSelector />
      </div>

      {/* Section: Auto-Reply */}
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">{t('sectionAutoReply')}</p>
      <div className="space-y-4 sm:space-y-6 landscape:space-y-4 mb-8 sm:mb-10 landscape:mb-6">
        <CommentsAutoReplyCard settings={settings} setSettings={setSettings} />

        {/* Messages & AI Toggles */}
        <div className="space-y-3 landscape:space-y-2">
          <SimpleToggle
            icon={<MessageCircle className="w-6 h-6 landscape:w-5 landscape:h-5" />}
            title={t('messagesAutoReply')}
            description={t('messagesAutoReplyDesc')}
            enabled={settings.messagesAutoReply}
            onChange={(enabled) => setSettings({ ...settings, messagesAutoReply: enabled })}
          />
          <SimpleToggle
            icon={<Bot className="w-6 h-6 landscape:w-5 landscape:h-5" />}
            title={t('enableAI')}
            description={t('aiDescriptionImproved')}
            enabled={settings.aiEnabled}
            onChange={(enabled) => setSettings({ ...settings, aiEnabled: enabled })}
          />
        </div>
      </div>

      {/* Section: AI Personality */}
      {settings.aiEnabled && (
        <>
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">{t('sectionAiPersonality')}</p>
          <div className="space-y-4 sm:space-y-6 landscape:space-y-4 mb-8 sm:mb-10 landscape:mb-6">
            <ReplyStyleCard
              settings={settings}
              setSettings={setSettings}
              hasChanges={hasChanges}
              onScrollToAdvanced={() => {
                setShowAdvanced(true);
                requestAnimationFrame(() => {
                  document.getElementById('advanced-settings-body')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
              }}
            />
          </div>
        </>
      )}

      {/* Advanced Settings Toggle */}
      <CollapsibleSectionHeader
        expanded={showAdvanced}
        onToggle={() => setShowAdvanced(!showAdvanced)}
        controlsId="advanced-settings-body"
        className="mb-6 landscape:mb-4"
        icon={
          <div className="p-2 rounded-lg bg-muted text-muted-foreground">
            <Settings2 className="w-6 h-6 landscape:w-5 landscape:h-5" />
          </div>
        }
      >
        <span className={clsx('block font-bold landscape:text-sm', showAdvanced ? 'text-foreground' : 'text-foreground/70')}>
          {showAdvanced ? t('hideAdvanced') : t('showAdvanced')}
        </span>
        <p className="text-xs text-muted-foreground landscape:hidden">
          {t('advancedDescription')}
        </p>
      </CollapsibleSectionHeader>

      {/* Advanced Settings */}
      {showAdvanced && (
        <div id="advanced-settings-body" className="space-y-4 sm:space-y-6 landscape:space-y-4 animate-slide-up pb-4 sm:pb-6">
          <BusinessHoursCard settings={settings} setSettings={setSettings} currentTime={currentTime} />

          <div className="grid grid-cols-1 md:grid-cols-2 landscape:grid-cols-2 gap-4 items-start">
            <ReplyDelayCard settings={settings} setSettings={setSettings} />
            <NotificationsCard settings={settings} setSettings={setSettings} />
          </div>

          <HandoffPauseCard settings={settings} setSettings={setSettings} />
          <LowConfidenceHoldCard settings={settings} setSettings={setSettings} />
          <GreetingMessageCard settings={settings} setSettings={setSettings} />
        </div>
      )}

      {/* View-only banner for members */}
      {!canEdit && (
        <div className="mb-4 p-3 rounded-xl alert-info border text-sm text-center">
          {tc('viewOnlyHint')}
        </div>
      )}

      {/* Fixed Save Button — above bottom nav on mobile, bottom of viewport on desktop */}
      {canEdit && <div className={clsx(
        'fixed end-0 start-0 z-30 px-4 md:px-8 lg:px-16 xl:px-20 py-3 bg-background/80 backdrop-blur-md border-t border-theme-border transition-all duration-300',
        sidebarOpen ? 'lg:start-64' : 'lg:start-20',
        'bottom-[calc(4rem+var(--sai-bottom))] lg:bottom-0 lg:pb-safe',
        'px-safe-landscape',
        hasChanges || saving ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
      )}>
        <div className="max-w-[1600px] mx-auto">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            icon={saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            variant={hasChanges ? 'primary' : 'secondary'}
            size="lg"
            className={clsx(
              'w-full shadow-2xl landscape:py-2.5 landscape:text-base disabled:opacity-50 disabled:cursor-not-allowed transition-all',
              saved && '!bg-green-500 !text-white hover:!bg-green-600'
            )}
          >
            {saving
              ? tc('saving')
              : saved
                ? t('settingsSaved')
                : t('saveSettings')
            }
          </Button>
        </div>
      </div>}

      {/* Section: Team */}
      <div className="mt-8 sm:mt-10 landscape:mt-6">
        <TeamSection />
      </div>

      {/* Section: Help & Support */}
      <div className="mt-8 sm:mt-10 landscape:mt-6">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">{tc('needHelp')}</p>
        <div className="bg-card border border-theme-border rounded-2xl p-4 sm:p-5">
          <p className="text-sm text-muted-foreground mb-4">{tc('helpDescription')}</p>
          <a
            href={`https://wa.me/46700224720?text=${encodeURIComponent(tc('whatsappDefaultMessage'))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2.5 px-5 rounded-xl transition-all shadow-sm hover:shadow-md active:scale-95 text-sm"
          >
            <MessageCircle className="w-4 h-4" />
            {tc('contactWhatsApp')}
          </a>
        </div>
      </div>

      {/* Visual separator before danger zone */}
      <div className="mt-12 mb-6 border-t-2 border-destructive/20" />

      <DangerZone onDeleteAccount={handleDeleteAccount} saving={saving} />
    </div>
  );
};

SettingsPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Settings">{page}</DashboardLayout>
);

export default SettingsPage;

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.settings]);
