import { useState, useEffect, useCallback, useRef, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { DEFAULT_HANDOFF_PAUSE_MINUTES, detectTimezone, resolveStoredTimezone } from '@jawab24/shared';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button, PageHeader, PageSkeleton, ViewOnlyBanner } from '@/components/ui';
import { useAuthStore, useUIStore } from '@/lib/store';
import { toast } from 'sonner';
import { useRouter } from 'next/router';
import axios from 'axios';
import { settingsApi, api } from '@/lib/api';
import {
  Save,
  MessageCircle,
  Sparkles,
  Check,
  Settings2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { captureError } from '@/lib/sentryHelpers';
import { buildWhatsAppUrl, DEFAULT_SUPPORT_WHATSAPP_NUMBER } from '@/lib/whatsapp';
import { useWorkspaceRole, usePersistedBoolean } from '@/hooks';
import { useIsDemoUser } from '@/features/demo';
import type { NextPageWithLayout } from './_app';
import {
  LanguageSelector,
  ThemeSelector,
  AutoReplyBoardCard,
  BusinessHoursCard,
  TimezoneCard,
  ReplyDelayCard,
  NotificationsCard,
  HandoffPauseCard,
  GreetingMessageCard,
  LimitFallbackMessageCard,
  ReplyStyleCard,
  LowConfidenceHoldCard,
  DangerZone,
  CollapsibleSectionHeader,
  buildChangedSettingsPayload,
} from '@/components/settings';
import type { SettingsState } from '@/components/settings';

const INITIAL_SETTINGS: SettingsState = {
  dashboardLanguage: 'en',
  defaultReplyLanguage: 'ar',
  autoDetectLanguage: true,
  aiEnabled: true,
  aiModel: 'gpt-4o-mini',
  notificationsEnabled: true,
  newLeadAlertsEnabled: true,
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
  limitFallbackEnabled: false,
  limitFallbackMessageMulti: {},
  dualReplyNudgeMulti: {},
  brandVoiceNotesMulti: {},
  awayMessage: '',
  greetingMessage: '',
  greetingMessageEnabled: false,
  replyDelay: 3,
  dualReplyNudge: '',
  commentEscalationMinutes: 60,
  messageEscalationMinutes: 30,
  handoffPauseDurationMinutes: DEFAULT_HANDOFF_PAUSE_MINUTES,
  replyStyle: 'professional',
  replyMode: 'sales',
  brandVoiceNotes: '',
  holdLowConfidence: false,
  likeComments: false,
};

/**
 * Maps the small, stable sections to their SettingsState keys so a successful
 * save can flash a contextual "Saved ✓" next to the section(s) that changed.
 * Anything NOT listed here is treated as "advanced" (the catch-all), so new
 * advanced fields don't need to be registered — keeps this map low-drift.
 */
const SECTION_FIELD_KEYS: Record<'general' | 'autoReply' | 'aiPersonality', (keyof SettingsState)[]> = {
  general: ['dashboardLanguage', 'defaultReplyLanguage', 'autoDetectLanguage', 'timezone'],
  autoReply: ['aiEnabled', 'commentsAutoReply', 'messagesAutoReply', 'commentReplyMode', 'dualReplyNudgeMulti', 'likeComments'],
  aiPersonality: ['replyStyle', 'replyMode', 'brandVoiceNotes', 'brandVoiceNotesMulti'],
};

/** Which sections changed between two settings snapshots (for the Saved ✓ flash). */
function computeChangedSections(current: SettingsState, baseline: SettingsState): Set<string> {
  const sections = new Set<string>();
  for (const key of Object.keys(current) as (keyof SettingsState)[]) {
    if (JSON.stringify(current[key]) === JSON.stringify(baseline[key])) continue;
    if (SECTION_FIELD_KEYS.general.includes(key)) sections.add('general');
    else if (SECTION_FIELD_KEYS.autoReply.includes(key)) sections.add('autoReply');
    else if (SECTION_FIELD_KEYS.aiPersonality.includes(key)) sections.add('aiPersonality');
    else sections.add('advanced');
  }
  return sections;
}

/** Subtle, accessible inline "Saved ✓" confirmation shown next to a section header. */
function SectionSavedFlash({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1 text-[11px] font-bold text-green-600 dark:text-green-400 animate-fade-in"
    >
      <Check className="w-3.5 h-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Uppercase settings section label paired with its contextual "Saved ✓" flash. */
function SettingsSectionHeader({
  label,
  saved,
  savedLabel,
  className,
}: { label: string; saved: boolean; savedLabel: string; className?: string }) {
  return (
    <div className={clsx('flex items-center gap-2.5', className)}>
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{label}</p>
      <SectionSavedFlash show={saved} label={savedLabel} />
    </div>
  );
}

const SettingsPage: NextPageWithLayout = () => {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const { language, setLanguage } = useLanguage();
  const { isAuthenticated } = useAuthStore();
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId);
  const { canEdit } = useWorkspaceRole();
  const isDemoUser = useIsDemoUser();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const router = useRouter();

  const [showAdvanced, setShowAdvanced] = usePersistedBoolean('settings:advanced:expanded', false);
  // Transient expand forced by a deep link (see the limit-fallback effect below).
  // Kept OUT of the persisted flag so arriving via the dashboard banner doesn't
  // silently rewrite the user's saved collapse preference.
  const [forceAdvanced, setForceAdvanced] = useState(false);
  // Briefly rings the fallback card after a deep-link scroll so the user can see
  // where they landed (the option is otherwise easy to miss in a dense section).
  const [highlightFallback, setHighlightFallback] = useState(false);
  const advancedExpanded = showAdvanced || forceAdvanced;
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<SettingsState>({ ...INITIAL_SETTINGS, dashboardLanguage: language });
  const [initialSettings, setInitialSettings] = useState<SettingsState>({ ...INITIAL_SETTINGS, dashboardLanguage: language });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saved, setSaved] = useState(false);
  // Sections that just saved — drives the contextual "Saved ✓" flash, cleared after 2s.
  const [savedSections, setSavedSections] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(new Date());
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(initialSettings);

  // Update current time every minute for real-time status badge
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
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
        // The placeholder is a DB default nobody chose — see resolveStoredTimezone.
        timezone: resolveStoredTimezone(data.timezone, detectTimezone()) || Intl.DateTimeFormat().resolvedOptions().timeZone,
        awayMessageMulti: data.awayMessageMulti || {},
        greetingMessageMulti: data.greetingMessageMulti || {},
        greetingMessageEnabled: data.greetingMessageEnabled ?? false,
        limitFallbackEnabled: data.limitFallbackEnabled ?? false,
        limitFallbackMessageMulti: data.limitFallbackMessageMulti || {},
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
        newLeadAlertsEnabled: data.newLeadAlertsEnabled ?? true,
        pushNotifications: data.pushNotifications ?? true,
        replyStyle: data.replyStyle || 'professional',
        replyMode: data.replyMode === 'info' ? 'info' : 'sales',
        brandVoiceNotes: data.brandVoiceNotes || '',
        holdLowConfidence: data.holdLowConfidence ?? false,
        likeComments: data.likeComments ?? false,
      };
      setSettings(newSettings);
      // Baseline keeps the RAW stored zone. When the placeholder above was
      // replaced, that shows up as a genuine pending change the merchant can
      // save in one tap — rather than a picker quietly disagreeing with the
      // zone the backend actually replies in.
      setInitialSettings({ ...newSettings, timezone: data.timezone ?? '' });
    } catch (error) {
      // CRITICAL: do NOT silently swallow this. If the fetch fails (offline, 5xx),
      // the page would otherwise show INITIAL_SETTINGS defaults to the user. They
      // could then "save" and overwrite their real DB settings with defaults
      // (e.g. commentReplyMode flipping from 'dual' back to 'public').
      // We surface a banner + block saving until a successful reload.
      setLoadError(true);
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

  // Deep links into a specific settings field via `/settings#<anchor>`:
  //   - `#limit-fallback-message` — the dashboard AI-limit banner.
  //   - `#comment-reply-mode-label` — the Post Reply modal's "change in Settings"
  //     link (points at the comment reply mode + static dual comment).
  // Only a known allowlist is honored (never scroll to an arbitrary id). The
  // fallback card lives inside the Advanced section (collapsed by default), so it
  // must be expanded before its anchor exists in the DOM; other anchors are always
  // mounted. Scroll to + (for the fallback) briefly highlight once it has mounted.
  const didDeepLinkRef = useRef(false);
  useEffect(() => {
    if (loading || didDeepLinkRef.current) return;
    if (typeof window === 'undefined') return;
    const anchorId = window.location.hash.slice(1);
    // 'business-hours-timezone-label' is the target of the timezone hint in the
    // /business hours sheet — timezone stays HERE (workspace-level, one home per
    // D-043); the sheet only links in.
    const KNOWN_ANCHORS = ['limit-fallback-message', 'comment-reply-mode-label', 'business-hours-timezone-label'];
    if (!KNOWN_ANCHORS.includes(anchorId)) return;
    didDeepLinkRef.current = true;
    if (anchorId === 'limit-fallback-message') setForceAdvanced(true);

    // The target may mount a render AFTER Advanced expands, so retry across a few
    // frames rather than racing a single rAF; bail out after ~0.5s.
    let frames = 0;
    let raf = requestAnimationFrame(function focus() {
      const el = document.getElementById(anchorId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (anchorId === 'limit-fallback-message') setHighlightFallback(true);
        return;
      }
      if (frames++ < 30) raf = requestAnimationFrame(focus);
    });
    return () => cancelAnimationFrame(raf);
  }, [loading]);

  // Fade the deep-link highlight out after it has drawn the eye.
  useEffect(() => {
    if (!highlightFallback) return;
    const id = setTimeout(() => setHighlightFallback(false), 2200);
    return () => clearTimeout(id);
  }, [highlightFallback]);

  const handleSave = async () => {
    // Hard guard: if the initial fetch failed, the on-screen settings are
    // INITIAL_SETTINGS defaults, not the user's saved values. Saving would
    // overwrite real DB data with defaults. Block until reload succeeds.
    if (loadError) {
      toast.error(t('loadErrorTitle'));
      return;
    }

    // Validate + send ONLY the fields the user changed (diff vs initialSettings).
    // PUT /settings is a partial update, so sending the whole object made Save
    // fail whenever ANY untouched stored field violated the strict schema — e.g.
    // a legacy brandVoiceNotes over the 800-char cap blocking an unrelated edit
    // (JAWAB24-FRONTEND-2J). Validating the diff still surfaces inline errors for
    // fields the user actually edited.
    const validation = buildChangedSettingsPayload(settings, initialSettings);
    if (!validation.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of validation.error.errors) {
        const field = issue.path[0]?.toString();
        if (field && !nextErrors[field]) nextErrors[field] = issue.message;
      }
      setFieldErrors(nextErrors);
      toast.error(tc('error'));
      return;
    }
    setFieldErrors({});

    // Nothing schema-relevant changed (e.g. only a non-schema field like
    // pushNotifications differs) — no PUT to make.
    if (Object.keys(validation.data).length === 0) {
      return;
    }

    // Snapshot which sections changed BEFORE we reset initialSettings on success,
    // so the contextual "Saved ✓" flash can target the right section header(s).
    const changedSections = computeChangedSections(settings, initialSettings);

    setSaving(true);
    setSaved(false);
    try {
      // No locale flip here: LanguageSelector persists + switches the locale
      // itself at click time, so dashboardLanguage ≠ current locale at Save
      // means the merchant chose a session language elsewhere (header toggle,
      // /en|/ar URL) — snapping them to the stored preference mid-save yanked
      // the UI out of the language they were reading.
      const response = await settingsApi.update(validation.data as Record<string, unknown>);
      const data = response.data;
      if (data) {
        const updatedSettings = { ...settings, ...data };
        setSettings(updatedSettings);
        setInitialSettings(updatedSettings);
      }

      // The comment-reply mode / dual-nudge here feed the shared ['comment-reply-config']
      // query that the Post Reply modal reads (useCommentReplyMode). Invalidate it so a
      // mode change is reflected immediately instead of after the 5-min staleTime.
      queryClient.invalidateQueries({ queryKey: ['comment-reply-config'] });
      // Same for the lead-alerts toggle feeding useSSE's toast gate (useLeadAlertsEnabled)
      // — muting «تنبيهات العملاء المحتملين الجدد» must silence toasts immediately.
      queryClient.invalidateQueries({ queryKey: ['lead-alerts-enabled'] });

      setSaved(true);
      setSavedSections(changedSections);
      setTimeout(() => {
        setSaved(false);
        setSavedSections(new Set());
      }, 2000);
    } catch (error) {
      // Forward backend validation details (Fastify schema 400s include the
      // exact failing field/rule) to Sentry so we can triage the root cause.
      // We deliberately do NOT show the raw English message to the user —
      // an AR-locale user shouldn't see "body/dualReplyNudge must NOT have
      // more than 80 characters". Keep the localized toast; rely on Sentry
      // extras for diagnosis.
      let validationMessage: string | undefined;
      let validationCode: string | undefined;
      let statusCode: number | undefined;
      if (axios.isAxiosError(error)) {
        statusCode = error.response?.status;
        const data = error.response?.data as
          | { message?: string; code?: string }
          | undefined;
        validationMessage = data?.message;
        validationCode = data?.code;
      }

      captureError(error, 'Failed to save settings', {
        tags: { page: 'settings', action: 'save' },
        extra: {
          statusCode,
          validationCode,
          validationMessage,
        },
      });
      // The reply-mode gates (D-085) 403 with a specific code. A generic
      // "something went wrong" leaves the merchant clicking Save forever with
      // a dirty draft and no idea why — the page-scope PATCH already names
      // this case, and the workspace save must too.
      if (validationCode === 'REPLY_MODE_NOT_ENABLED' || validationCode === 'REPLY_MODE_WORKSPACE_MISMATCH') {
        toast.error(t('replyMode.notEnabled'));
      } else {
        toast.error(tc('error'));
      }
    } finally {
      setSaving(false);
    }
  };

  // Returns true only when the account is actually gone, so DangerZone does not
  // show its "deleted successfully" state over a failed delete.
  const handleDeleteAccount = async (): Promise<boolean> => {
    // The demo workspace is one row shared by every visitor; the backend refuses
    // to delete it (DEMO_DELETE_FORBIDDEN). Say so without a pointless round trip,
    // mirroring the connect-Facebook pre-empt on /pages.
    if (isDemoUser) {
      toast.info(t('deleteDemoForbidden'));
      return false;
    }

    setSaving(true);
    try {
      await api.delete('/auth/me');
      setSaving(false);

      setTimeout(async () => {
        await useAuthStore.getState().logout();
        router.replace('/');
      }, 2500);
      return true;
    } catch (error: unknown) {
      const axiosErr = error as { response?: { data?: { error?: string; code?: string }; status?: number } };
      const status = axiosErr.response?.status;
      const code = axiosErr.response?.data?.code;
      setSaving(false);
      // An expected guard response, not a fault — keep it out of Sentry.
      if (code === 'DEMO_DELETE_FORBIDDEN') {
        toast.info(t('deleteDemoForbidden'));
        return false;
      }
      captureError(error, 'Failed to delete account', { tags: { page: 'settings', action: 'delete-account' } });
      if (status === 404) {
        // Already gone server-side — treat as success so the UI settles.
        setTimeout(async () => {
          await useAuthStore.getState().logout();
          router.replace('/');
        }, 2500);
        return true;
      }
      toast.error(tc('error'));
      return false;
    }
  };

  if (loading) {
    return <PageSkeleton />;
  }

  // Hard-fail UI when the initial fetch failed. We deliberately render NOTHING
  // editable — letting the user interact with INITIAL_SETTINGS defaults would
  // let them save defaults over their real data (e.g. commentReplyMode back to
  // 'public' after an offline reload).
  if (loadError) {
    return (
      <div className="pb-24 landscape:pb-20">
        <PageHeader title={t('title')} description={t('pageContext')} />
        <div className="mt-8 p-6 rounded-2xl alert-error border text-center">
          <h2 className="font-bold text-foreground text-base mb-1">{t('loadErrorTitle')}</h2>
          <p className="text-sm text-muted-foreground mb-4">{t('loadErrorDesc')}</p>
          <button
            type="button"
            onClick={fetchSettings}
            className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-bold hover:bg-brand-600 active:scale-[0.98] transition-all"
          >
            {tc('tryAgain')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-24 landscape:pb-20">
      <PageHeader
        title={t('title')}
        description={t('pageContext')}
      />

      {/* Section: General */}
      <SettingsSectionHeader label={t('general')} saved={savedSections.has('general')} savedLabel={t('settingsSaved')} className="mb-3 mt-2" />
      <div className="space-y-4 sm:space-y-6 landscape:space-y-4 mb-8 sm:mb-10 landscape:mb-6">
        <LanguageSelector
          settings={settings}
          initialSettings={initialSettings}
          setSettings={setSettings}
          setInitialSettings={setInitialSettings}
          setLanguage={setLanguage}
        />
        <ThemeSelector />
        {/* Timezone belongs here, not in the reply-schedule card: it governs the
            AI's date awareness, the Post-Reply gate, the reply schedule AND the
            hours quoted to customers. In Advanced (collapsed by default) it was
            effectively invisible for a value whose being wrong shifts all of
            them. */}
        <TimezoneCard settings={settings} setSettings={setSettings} currentTime={currentTime} />
      </div>

      {/* Section: Auto-Reply — ONE flat status board (D-029): who replies, and where.
          The standalone "Enable Smart Replies" switch is gone — aiEnabled is derived
          inside the board (on exactly when either channel row is on). */}
      <SettingsSectionHeader label={t('sectionAutoReply')} saved={savedSections.has('autoReply')} savedLabel={t('settingsSaved')} className="mb-3" />
      <div className="space-y-4 sm:space-y-6 landscape:space-y-4 mb-8 sm:mb-10 landscape:mb-6">
        <AutoReplyBoardCard settings={settings} setSettings={setSettings} fieldErrors={fieldErrors} />
      </div>

      {/* Section: AI Personality */}
      <SettingsSectionHeader label={t('sectionAiPersonality')} saved={savedSections.has('aiPersonality')} savedLabel={t('settingsSaved')} className="mb-3" />
      <div className="space-y-4 sm:space-y-6 landscape:space-y-4 mb-8 sm:mb-10 landscape:mb-6">
        {/* Gate on the channels (not the derived aiEnabled): personality matters
            exactly when Smart Replies can fire somewhere (D-029). */}
        {(settings.commentsAutoReply || settings.messagesAutoReply) ? (
          <ReplyStyleCard
            settings={settings}
            setSettings={setSettings}
            hasChanges={hasChanges}
            savedBrandVoiceNotesMulti={initialSettings.brandVoiceNotesMulti}
            savedReplyMode={initialSettings.replyMode === 'info' ? 'info' : 'sales'}
            workspaceId={activeWorkspaceId}
            onScrollToAdvanced={() => {
              setShowAdvanced(true);
              requestAnimationFrame(() => {
                document.getElementById('advanced-settings-body')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              });
            }}
          />
        ) : (
          <div className="flex items-center gap-3 rounded-2xl border border-dashed border-theme-border bg-muted/40 p-4 text-sm text-muted-foreground">
            <Sparkles className="w-5 h-5 shrink-0 text-icon-muted" aria-hidden="true" />
            <span>{t('personalityDisabledHint')}</span>
          </div>
        )}
      </div>

      {/* Advanced Settings Toggle */}
      <CollapsibleSectionHeader
        expanded={advancedExpanded}
        onToggle={() => {
          // A manual toggle takes over from any transient deep-link expand and
          // becomes the user's persisted preference.
          setForceAdvanced(false);
          setShowAdvanced(!advancedExpanded);
        }}
        controlsId="advanced-settings-body"
        className="mb-6 landscape:mb-4"
        icon={
          <div className="p-2 rounded-lg bg-muted text-muted-foreground">
            <Settings2 className="w-6 h-6 landscape:w-5 landscape:h-5" />
          </div>
        }
      >
        <div className="flex items-center gap-2.5">
          <span className={clsx('font-bold landscape:text-sm', advancedExpanded ? 'text-foreground' : 'text-foreground/70')}>
            {advancedExpanded ? t('hideAdvanced') : t('showAdvanced')}
          </span>
          <SectionSavedFlash show={savedSections.has('advanced')} label={t('settingsSaved')} />
        </div>
        <p className="text-xs text-muted-foreground landscape:hidden">
          {t('advancedDescription')}
        </p>
      </CollapsibleSectionHeader>

      {/* Advanced Settings */}
      {advancedExpanded && (
        <div id="advanced-settings-body" className="space-y-4 sm:space-y-6 landscape:space-y-4 animate-slide-up pb-4 sm:pb-6">
          <BusinessHoursCard settings={settings} setSettings={setSettings} currentTime={currentTime} />

          <div className="grid grid-cols-1 md:grid-cols-2 landscape:grid-cols-2 gap-4 items-start">
            <ReplyDelayCard settings={settings} setSettings={setSettings} />
            <NotificationsCard settings={settings} setSettings={setSettings} />
          </div>

          <HandoffPauseCard settings={settings} setSettings={setSettings} />
          <LowConfidenceHoldCard settings={settings} setSettings={setSettings} />

          <div className="space-y-3">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
              {t('subsectionCustomReplies')}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 landscape:grid-cols-2 gap-4 items-stretch">
              <GreetingMessageCard settings={settings} setSettings={setSettings} />
              <div
                id="limit-fallback-message"
                className={clsx(
                  'scroll-mt-24 h-full rounded-2xl transition-shadow duration-500',
                  highlightFallback && 'ring-2 ring-brand-500 ring-offset-2 ring-offset-background',
                )}
              >
                <LimitFallbackMessageCard settings={settings} setSettings={setSettings} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View-only banner for members */}
      {!canEdit && <ViewOnlyBanner className="mb-4" />}

      {/* Fixed Save Button — above bottom nav on mobile, bottom of viewport on desktop */}
      {canEdit && <div className={clsx(
        'fixed end-0 start-0 z-30 px-4 md:px-8 lg:px-16 xl:px-20 py-3 bg-background/80 backdrop-blur-md border-t border-theme-border transition-all duration-300',
        sidebarOpen ? 'lg:start-64' : 'lg:start-20',
        'bottom-[calc(4rem+var(--sai-bottom))] lg:bottom-0 lg:pb-safe',
        'px-safe-landscape',
        hasChanges || saving ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
      )}>
        <div className="max-w-4xl mx-auto">
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

      {/* Section: Help & Support */}
      <div className="mt-8 sm:mt-10 landscape:mt-6">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">{tc('needHelp')}</p>
        <div className="bg-card border border-theme-border rounded-2xl p-4 sm:p-5">
          <p className="text-sm text-muted-foreground mb-4">{tc('helpDescription')}</p>
          <a
            href={buildWhatsAppUrl(DEFAULT_SUPPORT_WHATSAPP_NUMBER, tc('whatsappDefaultMessage'))}
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
