import { useState, useEffect, useCallback, useRef, useMemo, type ReactElement } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, PageHeader, Button, PageSkeleton, UpgradeCTA, FeedSnippet, ArrowLink } from '@/components/ui';
import { WhatsAppNudgeBanner } from '@/components/dashboard/WhatsAppNudgeBanner';
import { PostReplyNudgeBanner } from '@/components/dashboard/PostReplyNudgeBanner';
import { PostSuggestionCard } from '@/components/dashboard/PostSuggestionCard';
import { intentLabelKey } from '@/utils/feedPreview';
import dynamic from 'next/dynamic';

const OnboardingWizard = dynamic(() => import('@/components/onboarding').then(m => ({ default: m.OnboardingWizard })), { ssr: false });

import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';

import { useAuthStore, useUIStore } from '@/lib/store';
import { isIOSNative } from '@/lib/capacitor';
import { getMarketplaceBilling } from '@/lib/marketplaceBilling';
import { settingsApi, pagesApi, commentsApi, messagesApi, analyticsApi, api } from '@/lib/api';
import type { AnalyticsOverview, AiUsageReport } from '@/lib/api';
import {
  MessageSquare,
  MessageCircle,
  Zap,
  FileText,
  Sparkles,
  Crown,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import clsx from 'clsx';
import type { Comment, Page } from '@jawab24/shared';
import { AutoReplyStatusCard, CommandCenter, SmartStatusBanner, PageAccordionItem, AiUsageWarningBanner, SetupChecklistCard, type NeedsAttentionItem } from '@/components/dashboard';
import { captureError } from '@/lib/sentryHelpers';
import { isWhatsAppVisible } from '@/lib/featureFlags';
import { getPageExternalUrl } from '@/utils/pageUrl';
import { isKbFilled, KB_DEEP_LINK } from '@/utils/kb';
import { hasMultipleActiveChannels } from '@/utils/channels';
import { formatRelativeTime } from '@/utils/dateUtils';
import type { NextPageWithLayout } from './_app';
const CommentDetailModal = dynamic(() => import('@/components/comments').then(m => ({ default: m.CommentDetailModal })), { ssr: false });
const MessageDetailModal = dynamic(() => import('@/components/messages/MessageDetailModal').then(m => ({ default: m.MessageDetailModal })), { ssr: false });
import { useConversationActions, useLoadConversation, usePostReplySetup } from '@/hooks';
import { useWorkspaceRole, useSubscriptionUsage, useNewLeadsSummary } from '@/hooks';
import { useSettingsQuery, SETTINGS_QUERY_KEY } from '@/hooks/useSettingsQuery';
import { useTimedDismiss } from '@/hooks/useTimedDismiss';
import { deriveSetupState, isWithinSetupGrace } from '@/utils/setupChecklist';
import { SETUP_CHECKLIST_COLLAPSE_KEY, SETUP_CHECKLIST_COLLAPSE_MS } from '@/components/dashboard/SetupChecklistCard';
import { useIsDemoUser } from '@/features/demo';

function SectionError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('dashboard');
  const tErr = useTranslations('errors');
  return (
    <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
      <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" />
      <span className="text-sm">{t('sectionLoadError')}</span>
      <button
        onClick={onRetry}
        className="text-sm font-semibold text-brand-600 hover:text-brand-700 underline"
      >
        {tErr('tryAgain')}
      </button>
    </div>
  );
}

function UsageProgress({ label, used, limit, percent, overLimitCta, coveredByTopup }: { label: string; used: number; limit: number | null; percent: number; overLimitCta?: { label: string; href: string }; coveredByTopup?: boolean }) {
  const roundedPercent = Math.round(percent);
  // At/over the limit, surface a direct action (e.g. "Manage Pages") right on the bar.
  const showCta = overLimitCta && percent >= 100;
  // When the plan is maxed but a non-expiring top-up reserve covers it, the
  // merchant is fine — keep the bar and badge calm (brand) instead of amber/red,
  // matching the Smart Replies tile's "on top-up" state. Without this the two
  // dashboard views give contradictory signals at 100%.
  const calm = coveredByTopup || percent <= 75;
  const barClass = calm
    ? 'bg-gradient-to-r from-brand-500 to-brand-600'
    : percent > 100
      ? 'bg-gradient-to-r from-red-500 to-red-600'
      : 'bg-gradient-to-r from-amber-500 to-amber-600';
  const barGlow = calm
    ? 'rgba(20, 184, 166, 0.3)'
    : percent > 100 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)';
  const pctClass = coveredByTopup
    ? 'status-brand'
    : roundedPercent > 90 ? 'status-error' : roundedPercent > 75 ? 'status-warning' : 'text-muted-foreground';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-between items-start gap-x-3 gap-y-1 text-xs">
        <span className="font-bold text-muted-foreground opacity-80 uppercase tracking-wider min-w-0">
          {label}
        </span>
        {/* Used count headlined; the "/ limit" and percent sit on the line below. */}
        <div className="flex flex-col items-end gap-0.5 whitespace-nowrap">
          <span className="font-bold text-foreground text-lg leading-none">
            {used.toLocaleString()}
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-muted-foreground font-medium text-xs">/ {limit ? limit.toLocaleString() : '∞'}</span>
            {limit && (
              <span className={clsx('text-[10px] font-bold px-1.5 py-0.5 rounded-full', pctClass)}>
                {roundedPercent}%
              </span>
            )}
          </span>
        </div>
      </div>
      <div className="h-2.5 w-full bg-surface-300 dark:bg-white/10 rounded-full overflow-hidden shadow-inner p-0.5 relative">
        <div
          className={clsx("h-full rounded-full transition-all duration-1000 relative shadow-sm", barClass)}
          style={{
            width: `${Math.min(percent, 100)}%`,
            boxShadow: percent > 10 ? `0 0 10px ${barGlow}` : 'none'
          }}
        >
          {percent > 20 && (
            <div className="absolute inset-0 bg-white/20 animate-pulse-soft"></div>
          )}
        </div>
      </div>
      {showCta && (
        <ArrowLink href={overLimitCta.href} size="xs">{overLimitCta.label}</ArrowLink>
      )}
    </div>
  );
}

// Key for localStorage to track if onboarding was completed
const ONBOARDING_COMPLETE_KEY = 'jawab24_onboarding_complete';

/**
 * The filter behind the Smart Status banner — shared by BOTH its lists so they cannot
 * drift apart.
 *
 * `resolved: false` is load-bearing, not decoration. The banner's COUNT comes from the
 * stats endpoints, which count `needs_attention = true AND resolved = false`
 * (`backend/src/services/messages.ts` getStats). A list without the same filter shows
 * items the count excludes.
 *
 * That divergence used to be invisible because few rows were ever resolved-while-flagged.
 * D-078 changed that: the Needs-Attention queue now auto-resolves at 7 days, so every
 * page accumulates resolved-but-still-flagged rows continuously. The messages list was
 * missing the filter and would have shown a week-old backlog under a count of zero.
 */
const ATTENTION_BANNER_FILTER = { needsAttention: true, resolved: false } as const;

// Map plan names from backend to existing translation keys
type PlanTranslationKey = 'starter.name' | 'business.name' | 'pro.name';
const PLAN_NAME_KEYS: Record<string, PlanTranslationKey> = {
  'Starter': 'starter.name',
  'Business': 'business.name',
  'Pro': 'pro.name',
};

const DashboardPage: NextPageWithLayout = () => {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const tTime = useTranslations('time');
  const tSub = useTranslations('subscription');

  const tPages = useTranslations('pages');
  const tPlans = useTranslations('plans');
  const { intlLocale } = useLanguage();

  // Resolve a normalized AI intent to its human-readable label (common ns),
  // or null when there's no canonical intent to show.
  const resolveIntentLabel = (intent?: string | null) => {
    const key = intentLabelKey(intent);
    return key ? tc(key as Parameters<typeof tc>[0]) : null;
  };
  const { isAuthenticated, fbToken, user } = useAuthStore();
  const { isOwner } = useWorkspaceRole();
  // Canary-aware: during the admin-only pilot window the WhatsApp surface
  // (headings, channel badges) must stay hidden from regular users.
  const whatsappVisible = isWhatsAppVisible(user?.isAdmin ?? false);
  const { setOnboardingVisible } = useUIStore();
  const isDemoUser = useIsDemoUser();
  const queryClient = useQueryClient();

  const [showOnboarding, setShowOnboarding] = useState(false);
  const { dismissed: kbNudgeDismissed, dismiss: dismissKbNudge } = useTimedDismiss({
    key: 'kbNudgeDismissedAt',
    durationMs: 3 * 24 * 60 * 60 * 1000, // 3 days
  });

  // Selected Comment State
  const [selectedCommentData, setSelectedCommentData] = useState<{ comment: Comment, mode: 'full' | 'quick' } | null>(null);

  // Conversation modal actions (shared hook — reply, pause, resume, resolve, pause-status)
  const {
    selectedConversation,
    setSelectedConversation,
    handleReply: handleMessageReply,
    handleReplyToConversation: handleMessageReplyToConversation,
    handlePause: handleMessagePause,
    handleResume: handleMessageResume,
    handleResolve: handleMessageResolve,
    handleUnresolve: handleMessageUnresolve,
    isReplying,
    isPausing,
    isResuming,
  } = useConversationActions({ extraInvalidateKeys: [['dashboard-recent-messages']] });

  const [imgError, setImgError] = useState<Record<string, boolean>>({});
  const [expandedPageId, setExpandedPageId] = useState<string | null>(null);

  // --- React Query hooks (cached, auto-refetched via SSE invalidation) ---

  // Workspace-wide, like every other figure on this page (commentsApi.getStats
  // takes no pageId) — a 2-page merchant must see both pages' waiting customers.
  const newLeadsSummary = useNewLeadsSummary();

  const { data: commentStats, isError: commentStatsError } = useQuery({
    queryKey: ['comments-stats'],
    queryFn: async () => {
      const res = await commentsApi.getStats();
      return res.data || { total: 0, replied: 0, unreplied: 0, needsAttention: 0, repliedToday: 0, replyRate: '0.0', byMethod: { ai: 0, template: 0, manual: 0, postReply: 0 }, repliedTodayByMethod: { ai: 0, postReply: 0 } };
    },
    enabled: isAuthenticated,
  });

  const { data: messageStats, isError: messageStatsError } = useQuery({
    queryKey: ['messages-stats'],
    queryFn: async () => {
      const res = await messagesApi.getStats();
      return res.data || { total: 0, replied: 0, pending: 0, needsAttention: 0, repliedToday: 0, byMethod: { ai: 0, template: 0, manual: 0, postReply: 0 }, repliedTodayByMethod: { ai: 0, postReply: 0 } };
    },
    enabled: isAuthenticated,
  });

  const { data: recentComments = [], isError: recentCommentsError } = useQuery({
    queryKey: ['dashboard-recent-comments'],
    queryFn: async () => {
      const res = await commentsApi.getAll({ limit: 5 });
      if (Array.isArray(res.data)) return res.data as unknown as Comment[];
      if (Array.isArray(res.data?.data)) return res.data.data as unknown as Comment[];
      return [];
    },
    enabled: isAuthenticated,
  });

  const { data: pages = [], isLoading: pagesLoading, isError: pagesError } = useQuery({
    queryKey: ['pages'],
    queryFn: async () => {
      const res = await pagesApi.getAll();
      if (Array.isArray(res.data)) return res.data as Page[];
      if (Array.isArray(res.data?.data)) return res.data.data as Page[];
      return [];
    },
    enabled: isAuthenticated,
  });

  // Shared Post Reply setup (same flow as the Comments page). Given `pages` so the
  // post picker (opened from the nudge banner) can list the merchant's posts.
  const postReplySetup = usePostReplySetup(pages);

  const { data: usage } = useSubscriptionUsage(isAuthenticated);

  // Reads the shared `/settings` query rather than issuing its own. This used to
  // be a second, independent fetch of the identical endpoint (measured: the
  // dashboard boot burst issued `/api/settings` TWICE), which on a slow
  // connection cost a full extra round trip for bytes already in flight.
  const { data: settingsData } = useSettingsQuery();
  const userSettings = useMemo(() => ({
    commentsAutoReply: settingsData?.commentsAutoReply ?? true,
    messagesAutoReply: settingsData?.messagesAutoReply ?? true,
    onboardingCompletedAt: settingsData?.onboardingCompletedAt ?? null,
  }), [settingsData]);

  // Two-path setup panel visibility — computed here (not inside the card) because
  // the EXPANDED form also SUPPRESSES the AutoReplyStatusCard warning: while it is
  // expanded it owns the "not enabled yet" message; a warning banner saying
  // "auto-reply disabled!" on top of it is the same fact twice with an alarming tone
  // a brand-new merchant hasn't earned. The banner resumes its watchdog role as soon
  // as the panel collapses to its one-line row (or a path goes live).
  const setupCollapse = useTimedDismiss({
    key: SETUP_CHECKLIST_COLLAPSE_KEY,
    durationMs: SETUP_CHECKLIST_COLLAPSE_MS,
  });
  // Single source for the workspace masters passed to every setup-derived
  // surface (setupState, checklist card, Post Reply nudge). The `?? true`
  // legacy-default is a semantic decision — keep it in ONE place so the three
  // consumers can never disagree about the effective state.
  const masters = useMemo(
    () => ({
      commentsAutoReply: userSettings?.commentsAutoReply ?? true,
      messagesAutoReply: userSettings?.messagesAutoReply ?? true,
    }),
    [userSettings],
  );
  const setupState = useMemo(
    () => deriveSetupState(pages, usage ?? null, masters),
    [pages, usage, masters],
  );
  // The panel exists at all — expanded OR as its one-line collapsed row. Setup is
  // unfinished, so the activation path must stay reachable either way.
  const setupPanelPresent =
    !pagesLoading &&
    userSettings !== undefined &&
    !setupState.coreSetupDone &&
    !setupState.postReplyConfigured;
  // ...and it owns the "not enabled yet" message only while EXPANDED. This is the
  // derived default the card starts from; re-expanding the row is a local, unlifted
  // choice, so it deliberately does NOT move the AutoReplyStatusCard.
  const setupPanelExpanded =
    setupPanelPresent &&
    isWithinSetupGrace(pages, userSettings?.onboardingCompletedAt) &&
    !setupCollapse.dismissed;

  const { data: analytics, isError: analyticsError } = useQuery({
    queryKey: ['dashboard-analytics'],
    queryFn: async () => {
      const res = await analyticsApi.getOverview(30);
      return (res.data ?? null) as AnalyticsOverview | null;
    },
    enabled: isAuthenticated,
    // 30-day aggregation — the heaviest dashboard query and the least
    // time-sensitive. Long staleTime keeps it out of the mount/refocus
    // refetch burst (see also the scoped invalidation in _app.tsx).
    staleTime: 15 * 60 * 1000,
  });

  // Daily Smart-Reply (AI call) volume — feeds the inline sparkline on the
  // primary metric tile. Best-effort: if it fails, the tile just shows no trend.
  const { data: aiUsage } = useQuery({
    queryKey: ['dashboard-ai-usage'],
    queryFn: async () => {
      const res = await analyticsApi.getAiUsage(30);
      return (res.data ?? null) as AiUsageReport | null;
    },
    enabled: isAuthenticated,
    // Same reasoning as dashboard-analytics above.
    staleTime: 15 * 60 * 1000,
  });

  const { data: needsActionComments } = useQuery({
    queryKey: ['dashboard-needs-action-comments'],
    queryFn: async () => {
      const res = await commentsApi.getAll({ ...ATTENTION_BANNER_FILTER, limit: 5 });
      if (Array.isArray(res.data)) return res.data;
      return res.data?.data ?? [];
    },
    enabled: isAuthenticated,
  });

  const { data: recentMessages } = useQuery({
    queryKey: ['dashboard-recent-messages'],
    queryFn: async () => {
      const res = await messagesApi.getAll({ ...ATTENTION_BANNER_FILTER, limit: 20, direction: 'incoming' });
      if (Array.isArray(res.data)) return res.data;
      return res.data?.data ?? [];
    },
    enabled: isAuthenticated,
  });

  // Derive loading state from individual queries
  const loading = isAuthenticated && (
    commentStats === undefined && !commentStatsError
  );

  // Refetch all dashboard data (for retry buttons and after actions)
  const refetchAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['comments-stats'] });
    queryClient.invalidateQueries({ queryKey: ['messages-stats'] });
    queryClient.invalidateQueries({ queryKey: ['leads-count'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-recent-comments'] });
    queryClient.invalidateQueries({ queryKey: ['pages'] });
    queryClient.invalidateQueries({ queryKey: ['subscription-usage'] });
    queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-ai-usage'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-needs-action-comments'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-recent-messages'] });
  }, [queryClient]);

  // --- Derived state (computed from query data) ---

  // Only show connected pages in the dashboard — disconnected ones are managed on /pages
  const connectedPages = pages.filter(p => p.isConnected !== false);

  const statsData = useMemo(() => {
    const stats = commentStats || { total: 0, replied: 0, unreplied: 0, needsAttention: 0, repliedToday: 0, replyRate: '0.0', byMethod: { ai: 0, template: 0, manual: 0, postReply: 0 }, repliedTodayByMethod: { ai: 0, postReply: 0 } };
    const msgStats = messageStats || { total: 0, replied: 0, pending: 0, needsAttention: 0, repliedToday: 0, byMethod: { ai: 0, template: 0, manual: 0, postReply: 0 }, repliedTodayByMethod: { ai: 0, postReply: 0 } };
    const activePages = pages.filter(p => p.autoReplyEnabled || p.instagramAutoReplyEnabled || p.whatsappAutoReplyEnabled).length;

    // Tooltip breakdown: only pass values when BOTH endpoints succeeded, so a
    // partial-load doesn't render a misleading "X comments + 0 messages" tooltip.
    const breakdownAvailable = commentStats !== undefined && messageStats !== undefined;

    return {
      repliedToday: (stats.repliedToday ?? 0) + (msgStats.repliedToday ?? 0),
      commentsRepliedToday: breakdownAvailable ? stats.repliedToday ?? 0 : undefined,
      messagesRepliedToday: breakdownAvailable ? msgStats.repliedToday ?? 0 : undefined,
      // Today's Smart vs Post Reply split for the "Replied Today" tile — only when
      // BOTH endpoints succeeded, so a partial load never renders a misleading sum.
      repliedTodayByMethod: breakdownAvailable ? {
        smart: (stats.repliedTodayByMethod?.ai ?? 0) + (msgStats.repliedTodayByMethod?.ai ?? 0),
        postReply: (stats.repliedTodayByMethod?.postReply ?? 0) + (msgStats.repliedTodayByMethod?.postReply ?? 0),
      } : undefined,
      commentsNeedsAction: Math.max(0, stats.needsAttention ?? 0),
      activePages,
      aiReplies: stats.byMethod.ai + (msgStats.byMethod?.ai ?? 0),
      messagesNeedsAction: Math.max(0, msgStats.needsAttention ?? 0),
    };
  }, [commentStats, messageStats, pages]);

  const sectionErrors = useMemo(() => ({
    comments: commentStatsError,
    messages: messageStatsError,
    recentComments: recentCommentsError,
    pages: pagesError,
    usage: false,
    settings: false,
    analytics: analyticsError,
  }), [commentStatsError, messageStatsError, recentCommentsError, pagesError, analyticsError]);

  const needsAttentionItems = useMemo(() => {
    const bannerItems: NeedsAttentionItem[] = [];

    if (needsActionComments) {
      for (const c of needsActionComments) {
        bannerItems.push({
          id: c.id,
          type: 'comment',
          senderName: c.fromName ?? null,
          text: c.message || '',
          createdAt: c.createdTime || c.createdAt || null,
          flagReason: c.flagReason ?? null,
          flagMeta: c.flagMeta ?? null,
          href: '/comments?filter=needs_action',
          commentData: c,
        });
      }
    }

    if (recentMessages) {
      // Group messages by senderId so each conversation appears once
      const grouped: Record<string, {
        latest: typeof recentMessages[0];
        earliestAt: string | Date | null;
        count: number;
      }> = {};
      for (const m of recentMessages) {
        const key = m.senderId || m.id; // fallback to id if no senderId
        const mDate = m.createdTime || m.createdAt || null;
        if (!grouped[key]) {
          grouped[key] = { latest: m, earliestAt: mDate, count: 1 };
        } else {
          grouped[key].count += 1;
          // Track latest message (for snippet)
          const existingDate = grouped[key].latest.createdTime || grouped[key].latest.createdAt;
          if (mDate && existingDate && new Date(mDate).getTime() > new Date(existingDate).getTime()) {
            grouped[key].latest = m;
          }
          // Track earliest message (for "waiting since")
          const curEarliest = grouped[key].earliestAt;
          if (mDate && curEarliest && new Date(mDate).getTime() < new Date(curEarliest).getTime()) {
            grouped[key].earliestAt = mDate;
          }
        }
      }
      for (const { latest, earliestAt, count } of Object.values(grouped)) {
        bannerItems.push({
          id: latest.id,
          type: 'message',
          platform: latest.platform ?? null,
          senderName: latest.senderName ?? null,
          text: latest.message || '',
          createdAt: latest.createdTime || latest.createdAt || null,
          flagReason: latest.flagReason ?? null,
          flagMeta: latest.flagMeta ?? null,
          href: '/messages?filter=needs_action',
          senderId: latest.senderId,
          pageId: latest.pageId,
          messageCount: count,
          earliestAt: count > 1 ? earliestAt : null,
        });
      }
    }

    bannerItems.sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - da;
    });
    return bannerItems.slice(0, 5);
  }, [needsActionComments, recentMessages]);

  // Workspaces that actively run 2+ channels get a per-message channel ribbon on
  // the needs-attention feed (a single active channel stays clean).
  const showChannelBadge = useMemo(() => hasMultipleActiveChannels(pages), [pages]);

  // Auto-sync if no pages found — only for existing users (onboarding already completed)
  const syncAttemptedRef = useRef(false);
  useEffect(() => {
    const onboardingComplete = localStorage.getItem(ONBOARDING_COMPLETE_KEY) || userSettings?.onboardingCompletedAt;
    if (!loading && !pagesLoading && pages.length === 0 && fbToken && isAuthenticated && isOwner && !syncAttemptedRef.current && onboardingComplete) {
      syncAttemptedRef.current = true;
      api.post('/pages/sync', { accessToken: fbToken })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['pages'] });
        })
        .catch(err => {
          // Silent — auto-sync is best-effort. User can manually refresh on the Pages screen.
          captureError(err, 'Dashboard auto-sync failed', { tags: { page: 'dashboard', action: 'auto-sync' } });
        });
    }
  }, [loading, pagesLoading, pages.length, fbToken, isAuthenticated, isOwner, queryClient, t, userSettings]);

  // Show onboarding for new workspace owners — server-side state is the source of truth,
  // localStorage is a fast cache to prevent flash on subsequent page loads.
  // Members can't connect pages and can't call PUT /settings, so skip onboarding for them.
  useEffect(() => {
    if (!loading && !pagesLoading && pages.length === 0 && isOwner && userSettings !== undefined) {
      const localComplete = localStorage.getItem(ONBOARDING_COMPLETE_KEY);
      const serverComplete = !!userSettings?.onboardingCompletedAt;

      if (!serverComplete && !localComplete) {
        setShowOnboarding(true);
        setOnboardingVisible(true);
      } else if (localComplete && !serverComplete) {
        // Backward compat: user completed onboarding before server-side tracking.
        // Silently backfill the server so it knows on future logins / other devices.
        settingsApi.update({ onboardingCompletedAt: new Date().toISOString() }).catch(() => {});
      }
    }
  }, [loading, pagesLoading, pages.length, isOwner, userSettings, setOnboardingVisible]);

  // Handle onboarding completion — persist to server + localStorage
  // Only owners can update settings (PUT /settings is admin+)
  const markOnboardingDone = useCallback(() => {
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
    setShowOnboarding(false);
    setOnboardingVisible(false);
    if (isOwner) {
      settingsApi.update({ onboardingCompletedAt: new Date().toISOString() }).catch(() => {});
    }
    queryClient.invalidateQueries({ queryKey: ['pages'] });
    queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
  }, [isOwner, setOnboardingVisible, queryClient]);

  const handleOnboardingComplete = markOnboardingDone;
  const handleOnboardingSkip = markOnboardingDone;

  // Auto-expand accordion when only 1 page is connected
  useEffect(() => {
    if (pages.length === 1) {
      setExpandedPageId(pages[0].id);
    }
  }, [pages]);

  const handlePageAccordionToggle = useCallback((pageId: string) => {
    setExpandedPageId(prev => prev === pageId ? null : pageId);
  }, []);

  // --- Message conversation modal handlers ---

  const loadConversation = useLoadConversation();
  const openConversationModal = useCallback(async (senderId: string, pageId: string, senderName: string | null) => {
    try {
      const conv = await loadConversation({ senderId, pageId, senderName });
      if (!conv) {
        toast.error(tc('noData'));
        return;
      }
      setSelectedConversation(conv);
    } catch (err) {
      captureError(err, 'Failed to load conversation', { tags: { page: 'dashboard', action: 'open-conversation' } });
      toast.error(t('sectionLoadError'));
    }
  }, [t, tc, setSelectedConversation, loadConversation]);

  const handleAttentionItemClick = useCallback((item: NeedsAttentionItem) => {
    if (item.type === 'message' && item.senderId && item.pageId) {
      openConversationModal(item.senderId, item.pageId, item.senderName);
    } else if (item.type === 'comment' && item.commentData) {
      setSelectedCommentData({ comment: item.commentData, mode: 'full' });
    }
  }, [openConversationModal]);

  const handleConversationModalClose = useCallback(() => {
    setSelectedConversation(null);
    // Refresh attention data to reflect any changes made in the modal
    queryClient.invalidateQueries({ queryKey: ['dashboard-recent-messages'] });
    queryClient.invalidateQueries({ queryKey: ['messages-stats'] });
  }, [queryClient, setSelectedConversation]);

  // Resolved page name + URL for message modal
  const selectedMessagePage = useMemo(
    () => selectedConversation
      ? pages.find(p => p.id === selectedConversation.lastMessage.pageId)
      : undefined,
    [selectedConversation, pages]
  );
  const selectedMessagePageName = selectedMessagePage?.name;
  const selectedMessagePageUrl = selectedMessagePage ? getPageExternalUrl(selectedMessagePage) : undefined;
  const selectedMessageFacebookPageId = selectedMessagePage?.facebookPageId ?? undefined;

  // Dashboard Skeleton Loading State
  if (loading) {
    return <PageSkeleton type="dashboard" />;
  }

  return (
    <>
      {/* Onboarding Wizard for new users */}
      {showOnboarding && (
        <OnboardingWizard
          onComplete={handleOnboardingComplete}
          onSkip={handleOnboardingSkip}
        />
      )}
      {/* Header */}
      <PageHeader
        title={(() => {
          const firstName = user?.name?.split(' ')[0];
          return firstName
            ? `${t('greeting')}, ${firstName}`
            : t('title');
        })()}
        description={`${t('overview')} · ${new Date().toLocaleDateString(intlLocale, { weekday: 'long', month: 'long', day: 'numeric' })}`}
      />

      {/* Smart status message — the post-setup watchdog. Suppressed while the
          two-path setup panel is EXPANDED: during onboarding the panel owns the
          "not enabled yet" message (see setupPanelExpanded above). */}
      {userSettings && !setupPanelExpanded && (
        <AutoReplyStatusCard
          activePages={statsData.activePages}
          totalPages={pages.length}
          commentsAutoReply={userSettings.commentsAutoReply}
          messagesAutoReply={userSettings.messagesAutoReply}
        />
      )}

      {/* Smart Status Banner — needs attention or all caught up */}
      <SmartStatusBanner
        commentNeedsAction={statsData.commentsNeedsAction}
        messageNeedsAction={statsData.messagesNeedsAction}
        leads={newLeadsSummary}
        items={needsAttentionItems}
        onItemClick={handleAttentionItemClick}
        showChannelBadge={showChannelBadge}
      />

      {/* AI usage warning — appears at 80%, turns critical at 100%, and turns into
          a blocking billing-paused notice whenever the reply gate itself refuses
          (which no quota number can express: a lapsed plan reports 0 used). */}
      {usage?.aiReplies && (
        <AiUsageWarningBanner
          aiReplies={usage.aiReplies}
          resetsAt={usage.currentPeriod?.end}
          planSlug={usage.subscription?.plan?.slug}
          paymentMethod={usage.subscription?.paymentMethod}
          marketplaceBilled={!!getMarketplaceBilling(usage)}
          userEmail={user?.email}
          topupBalance={usage.topup?.balance}
          autoReply={usage.subscription?.autoReply}
          entitlementEndsAt={usage.subscription?.entitlementEndsAt}
          unansweredSinceBlock={usage.subscription?.autoReply?.unansweredSinceBlock}
          cause={usage.subscription?.autoReply?.cause}
        />
      )}

      {/* Two-path onboarding panel — "Start replying automatically". Both booleans are
          lifted so the AutoReplyStatusCard suppression above can never disagree with
          the panel: `present` keeps the activation path reachable while setup is
          unfinished, `expanded` decides which of the two forms renders. */}
      {setupPanelPresent && (
        <SetupChecklistCard
          pages={pages}
          usage={usage ?? null}
          masters={masters}
          onTryPostReply={postReplySetup.openPicker}
          onboardingCompletedAt={userSettings?.onboardingCompletedAt}
          expanded={setupPanelExpanded}
          onCollapse={setupCollapse.dismiss}
        />
      )}

      {/* Command Center — consolidated metrics */}
      <CommandCenter
        smartReplies={analytics?.byMethod?.ai ?? statsData.aiReplies}
        repliedToday={statsData.repliedToday}
        commentsRepliedToday={statsData.commentsRepliedToday}
        messagesRepliedToday={statsData.messagesRepliedToday}
        replyRate={analytics?.totals?.replyRate ?? '0'}
        avgSpeedSeconds={analytics?.responseTime?.avgSeconds ?? null}
        hasError={sectionErrors.comments && sectionErrors.messages && sectionErrors.analytics}
        onRetry={refetchAll}
        quota={usage?.aiReplies ? {
          used: usage.aiReplies.used,
          percentUsed: usage.aiReplies.percentUsed,
          limit: usage.aiReplies.limit,
          topupBalance: usage.topup?.balance,
        } : undefined}
        quotaResetsAt={usage?.currentPeriod?.end}
        smartRepliesTrend={aiUsage?.byDay?.slice(-14).map((d) => d.calls)}
        repliedTodayByMethod={statsData.repliedTodayByMethod}
      />

      {/* «بوست اليوم» pilot — self-gating (workspace allowlist + API 404 fail-closed),
          so this renders nothing for every workspace outside the pilot. Sits ABOVE the
          inbox on purpose: it is a "do something today" prompt, and below the fold it
          read as an afterthought. NO wrapper element here: the component owns its own
          bottom margin, so a null render leaves no stray gap on every other dashboard. */}
      <PostSuggestionCard pages={pages} />

      {/* Inbox: Comments + Messages side by side */}
      {(() => {
        const getTimeLabel = (date: string | Date | null | undefined) =>
          formatRelativeTime(date, tTime);

        // Determine max items to show — cap at 5, match shorter column
        const commentItems = recentComments.slice(0, 5);
        // Deduplicate messages by sender — show only the latest message per conversation
        const allMessages = recentMessages ?? [];
        const seenSenders = new Set<string>();
        const messageItems = allMessages.filter(msg => {
          if (seenSenders.has(msg.senderId)) return false;
          seenSenders.add(msg.senderId);
          return true;
        }).slice(0, 5);
        const maxRows = Math.min(5, Math.max(commentItems.length, messageItems.length));

        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            {/* Incoming Comments */}
            <Card className="border-none shadow-2xl shadow-surface-200/50 bg-card" padding="none">
              <div className="p-4 sm:p-5 border-b border-theme-border flex items-center justify-between gap-4 bg-background/50">
                <div className="flex items-center gap-2.5">
                  <MessageSquare className="w-5 h-5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                  <h2 className="text-base font-display font-bold text-foreground tracking-tight">{t('recentComments')}</h2>
                  {statsData.commentsNeedsAction > 0 && (
                    <span className="flex-shrink-0 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 text-xs font-bold rounded-full bg-red-500 text-white">
                      {statsData.commentsNeedsAction > 99 ? '99+' : statsData.commentsNeedsAction}
                    </span>
                  )}
                </div>
                {commentItems.length > 0 && (
                  <ArrowLink href="/comments">{tc('viewAll')}</ArrowLink>
                )}
              </div>

              <div className="divide-y divide-theme-border">
                {sectionErrors.recentComments ? (
                  <SectionError onRetry={refetchAll} />
                ) : commentItems.length > 0 ? (
                  commentItems.slice(0, maxRows).map((comment) => {
                    const timeLabel = getTimeLabel(comment.createdAt);

                    return (
                      <button
                        key={comment.id}
                        type="button"
                        onClick={() => setSelectedCommentData({ comment, mode: 'full' })}
                        className="flex items-start gap-3 px-4 py-3.5 sm:px-5 sm:py-4 hover:bg-muted/50 transition-colors w-full text-start"
                      >
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-xs font-bold text-muted-foreground">
                            {(comment.fromName || '?')[0].toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <span className="text-sm font-semibold text-foreground truncate min-w-0">
                              {comment.fromName || tc('unknownUser')}
                            </span>
                            {timeLabel && (
                              <span className="text-[11px] text-muted-foreground whitespace-nowrap flex-shrink-0 flex items-center gap-1">
                                <Clock className="w-3 h-3" aria-hidden="true" />
                                {timeLabel}
                              </span>
                            )}
                          </div>
                          <FeedSnippet
                            text={comment.message}
                            intentLabel={resolveIntentLabel(comment.aiIntent)}
                            noPreviewLabel={tc('feedPreview.noPreview')}
                          />
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="py-8 text-center">
                    <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mx-auto mb-3">
                      <MessageSquare className="w-6 h-6 text-icon-muted" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      {t('noRecentComments')}
                    </p>
                    {pages.length === 0 && (
                      <Link href="/pages">
                        <Button variant="primary" size="sm" className="mt-3">
                          {tPages('connectPage')}
                        </Button>
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </Card>

            {/* Recent Messages */}
            <Card className="border-none shadow-2xl shadow-surface-200/50 bg-card" padding="none">
              <div className="p-4 sm:p-5 border-b border-theme-border flex items-center justify-between gap-4 bg-background/50">
                <div className="flex items-center gap-2.5">
                  <MessageCircle className="w-5 h-5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                  <h2 className="text-base font-display font-bold text-foreground tracking-tight">{t('recentMessages')}</h2>
                  {statsData.messagesNeedsAction > 0 && (
                    <span className="flex-shrink-0 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 text-xs font-bold rounded-full bg-red-500 text-white">
                      {statsData.messagesNeedsAction > 99 ? '99+' : statsData.messagesNeedsAction}
                    </span>
                  )}
                </div>
                {messageItems.length > 0 && (
                  <ArrowLink href="/messages">{tc('viewAll')}</ArrowLink>
                )}
              </div>

              <div className="divide-y divide-theme-border">
                {sectionErrors.messages ? (
                  <SectionError onRetry={refetchAll} />
                ) : messageItems.length > 0 ? (
                  messageItems.slice(0, maxRows).map((msg) => {
                    const timeLabel = getTimeLabel(msg.createdTime || msg.createdAt);

                    return (
                      <button
                        key={msg.id}
                        type="button"
                        onClick={() => openConversationModal(msg.senderId, msg.pageId, msg.senderName)}
                        className="flex items-start gap-3 px-4 py-3.5 sm:px-5 sm:py-4 hover:bg-muted/50 transition-colors w-full text-start"
                      >
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-xs font-bold text-muted-foreground">
                            {(msg.senderName || '?')[0].toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <span className="text-sm font-semibold text-foreground truncate min-w-0">
                              {msg.senderName || tc('unknownUser')}
                            </span>
                            {timeLabel && (
                              <span className="text-[11px] text-muted-foreground whitespace-nowrap flex-shrink-0 flex items-center gap-1">
                                <Clock className="w-3 h-3" aria-hidden="true" />
                                {timeLabel}
                              </span>
                            )}
                          </div>
                          <FeedSnippet
                            text={msg.message}
                            intentLabel={resolveIntentLabel(msg.aiIntent)}
                            noPreviewLabel={tc('feedPreview.noPreview')}
                          />
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="py-8 text-center">
                    <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mx-auto mb-3">
                      <MessageCircle className="w-6 h-6 text-icon-muted" aria-hidden="true" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      {t('noMessagesYet')}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          </div>
        );
      })()}

      {/* Usage & Pages */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Usage Card — Split into Plan Info + Quota sections */}
          {usage && usage.subscription && (
            <Card className="border-none shadow-2xl shadow-brand-500/10 overflow-hidden bg-card relative group" padding="none">
              {(() => {
                const isTrialing = usage.subscription.status === 'trialing';
                const isPaidPlan = usage.subscription.status === 'active' && !isTrialing;

                return (
                  <>
                    {/* Section A: Plan Info + Billing — hidden on iOS native (App Store Guideline 3.1.1 reader-app model) */}
                    {!isIOSNative() && (
                    <div className="p-6 sm:p-8 relative">
                      <div className="absolute top-0 end-0 w-32 h-32 bg-brand-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 transition-all group-hover:bg-brand-500/10"></div>

                      <div className="flex items-center gap-3 sm:gap-5 relative z-10">
                        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl sm:rounded-3xl bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white shadow-xl shadow-brand-500/20 transform transition-transform group-hover:rotate-6">
                          <Crown className="w-6 h-6 sm:w-7 sm:h-7" />
                        </div>
                        <div className="min-w-0 flex-1 text-start">
                          <p className="text-[10px] font-bold text-brand-600 uppercase tracking-[0.2em] mb-1">{tSub('currentPlan')}</p>
                          <h3 className="text-base sm:text-lg lg:text-xl font-display font-bold text-foreground tracking-tight flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span>{PLAN_NAME_KEYS[usage.subscription.plan.name] ? tPlans(PLAN_NAME_KEYS[usage.subscription.plan.name]) : usage.subscription.plan.name}</span>
                            {isTrialing && (
                              <span className="inline-flex items-center alert-warning border px-2 py-0.5 rounded text-[10px] font-extrabold">
                                {tSub('trialBadge')}
                              </span>
                            )}
                          </h3>
                        </div>
                      </div>

                      {isTrialing && usage.subscription.trialDaysRemaining && usage.subscription.trialDaysRemaining > 0 && (
                        <div className="mt-5 p-3 rounded-xl alert-warning border flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-white dark:bg-card flex items-center justify-center shadow-sm">
                            <Zap className="w-4 h-4" />
                          </div>
                          <span className="text-xs font-bold leading-relaxed">
                            {tSub('trialEndsIn')} {usage.subscription.trialDaysRemaining} {tSub('days')}
                          </span>
                        </div>
                      )}

                      {isPaidPlan ? (
                        <UpgradeCTA className="block mt-5">
                          <Button
                            variant="secondary"
                            className="w-full py-3.5 text-sm border-surface-400 dark:border-surface-400 hover:border-brand-500 dark:hover:border-brand-500"
                          >
                            {tSub('managePlan')}
                          </Button>
                        </UpgradeCTA>
                      ) : (
                        <UpgradeCTA className="block mt-5">
                          <Button
                            variant="primary"
                            className="w-full py-4 text-base shadow-[0_12px_32px_rgba(20,184,166,0.24)]"
                            icon={<Sparkles className="w-5 h-5" />}
                          >
                            {tSub('upgradePlan')}
                          </Button>
                        </UpgradeCTA>
                      )}
                    </div>
                    )}

                    {/* Divider — only when Section A is visible */}
                    {!isIOSNative() && <div className="border-t border-theme-border" />}

                    {/* Section B: Quota Usage */}
                    <div className="p-6 sm:p-8">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] mb-5">
                        {tSub('usage')}
                      </p>
                      <div className="space-y-6">
                        <div>
                          <UsageProgress
                            label={tSub('aiRepliesUsed')}
                            used={usage.aiReplies.used}
                            limit={usage.aiReplies.limit}
                            percent={usage.aiReplies.percentUsed}
                            coveredByTopup={usage.aiReplies.percentUsed >= 100 && (usage.topup?.balance ?? 0) > 0}
                          />
                          {/* Non-expiring top-up reserve — surfaced here so the usage
                              summary reflects the merchant's true remaining headroom,
                              not just the monthly plan bucket. */}
                          {(usage.topup?.balance ?? 0) > 0 && (
                            <p className="mt-2.5 text-xs font-semibold text-brand-600">
                              {tSub('topupReserve', { balance: (usage.topup?.balance ?? 0).toLocaleString(intlLocale) })}
                            </p>
                          )}
                        </div>
                        {(() => {
                          const effectivePagesUsed = Math.max(usage.pages.used, pages.length);
                          const effectivePagesLimit = isDemoUser
                            ? Math.max(usage.pages.limit ?? 0, pages.length)
                            : usage.pages.limit;
                          return (
                            <UsageProgress
                              label={tSub('pagesUsed')}
                              used={effectivePagesUsed}
                              limit={effectivePagesLimit}
                              percent={effectivePagesLimit ? (effectivePagesUsed / effectivePagesLimit) * 100 : 0}
                              overLimitCta={{ label: tPages('managePages'), href: '/pages' }}
                            />
                          );
                        })()}
                      </div>
                    </div>
                  </>
                );
              })()}
            </Card>
          )}

          {/* KB Nudge Banner — gentle, non-blocking */}
          {!kbNudgeDismissed && (() => {
            const activePages = pages.filter(p => p.autoReplyEnabled || p.instagramAutoReplyEnabled || p.whatsappAutoReplyEnabled);
            if (activePages.length === 0) return null;

            // Use the shared KB-filled rule (>= KB_FILLED_MIN_CHARS, trimmed) so this
            // nudge and the SetupChecklistCard above it never disagree on the same screen.
            const allKbFilled = activePages.every(isKbFilled);
            if (allKbFilled) return null;

            const hasEcommerce = activePages.some(p => !!p.ecommerceStoreId);
            const hasThinKb = activePages.some(p => !isKbFilled(p));
            if (!hasThinKb) return null;

            const isEcomVariant = hasEcommerce;

            const handleDismiss = () => {
              dismissKbNudge();
            };

            return (
              <div
                className={clsx(
                  'flex items-start gap-3 p-4 rounded-2xl border mb-0 transition-all',
                  isEcomVariant
                    ? 'bg-surface-50 dark:bg-surface-200/50 border-theme-border'
                    : 'bg-brand-50/60 dark:bg-brand-950/30 border-brand-200 dark:border-brand-800'
                )}
              >
                {!isEcomVariant && (
                  <Sparkles className="w-5 h-5 flex-shrink-0 mt-0.5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={clsx(
                    'text-sm font-semibold',
                    isEcomVariant ? 'text-foreground' : 'text-brand-900 dark:text-brand-200'
                  )}>
                    {isEcomVariant ? t('kbNudgeEcomTitle') : t('kbNudgeTitle')}
                  </p>
                  <p className={clsx(
                    'text-xs mt-0.5',
                    isEcomVariant ? 'text-muted-foreground' : 'text-brand-700/80 dark:text-brand-400/80'
                  )}>
                    {isEcomVariant ? t('kbNudgeEcomBody') : t('kbNudgeBody')}
                  </p>
                  <div className="flex items-center gap-3 mt-2">
                    <Link href={KB_DEEP_LINK}>
                      <Button size="sm" variant="primary" className="text-xs">
                        {t('kbNudgeCta')}
                      </Button>
                    </Link>
                    <button
                      type="button"
                      onClick={handleDismiss}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t('kbNudgeLater')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* WhatsApp launch announcement — env-gated + canary-aware inside the component */}
          <WhatsAppNudgeBanner
            pages={pages}
            isOwner={isOwner}
            isAdmin={user?.isAdmin ?? false}
            whatsappEntitled={Boolean(usage?.subscription?.plan?.whatsappEnabled)}
          />

          {/* Post Reply discovery — shows once setup is done and no post has a trigger yet.
              Opens the post picker (owned by postReplySetup) so a merchant can arm any
              recent post, including one with no comments. Self-hides via its own gates.
              Gated on the settings query having resolved (same as the checklist card):
              with masters defaulted `?? true` mid-flight, a masters-OFF merchant would
              otherwise get a transient "setup complete" flash. */}
          {userSettings !== undefined && (
            <PostReplyNudgeBanner
              pages={pages}
              usage={usage ?? null}
              masters={masters}
              isOwner={isOwner}
              onTry={postReplySetup.openPicker}
            />
          )}

          {/* Top Pages */}
          <Card padding="none" className="border-none shadow-2xl shadow-surface-200/50 bg-card overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-theme-border bg-background/50">
              <h2 className="text-lg font-display font-bold text-foreground tracking-tight">{whatsappVisible ? t('topPagesChannels') : t('topPages')}</h2>
              <p className="text-sm font-medium text-muted-foreground mt-1">{whatsappVisible ? t('topPagesChannelsDesc') : t('topPagesDesc')}</p>
            </div>
            <div className={clsx(
              'divide-y divide-theme-border',
              pages.length >= 3 && 'max-h-[400px] overflow-y-auto'
            )}>
              {sectionErrors.pages ? (
                <SectionError onRetry={refetchAll} />
              ) : connectedPages.length > 0 ? connectedPages.map((page, i) => {
                const pageComments = recentComments.filter(c => c.pageId === page.id || c.pageId === page.facebookPageId);
                const pendingCount = pageComments.filter(c => !c.replied).length;

                return (
                  <PageAccordionItem
                    key={page.id}
                    page={page}
                    isExpanded={expandedPageId === page.id}
                    onToggle={() => handlePageAccordionToggle(page.id)}
                    imgError={!!imgError[page.id]}
                    onImgError={() => setImgError(prev => ({ ...prev, [page.id]: true }))}
                    pendingCount={pendingCount}
                    animationDelay={(i + 5) * 0.1}
                    whatsappVisible={whatsappVisible}
                  />
                );
              }) : (
                <div className="py-10 text-center">
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mx-auto mb-3">
                    <FileText className="w-6 h-6 text-icon-muted" aria-hidden="true" />
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">{tPages('noPagesDesc')}</p>
                  <Link href="/pages">
                    <Button variant="primary" size="sm">
                      {tPages('connectPage')}
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </Card>
      </div>

      {/* Comment Detail Modal - Now handles both modes */}
      {selectedCommentData && (() => {
        const commentPage = pages.find(p => p.id === selectedCommentData.comment.pageId);
        const commentPageUrl = commentPage
          ? getPageExternalUrl(commentPage, selectedCommentData.comment.source)
          : undefined;
        return (
          <CommentDetailModal
            comment={selectedCommentData.comment}
            onClose={() => setSelectedCommentData(null)}
            onReplySuccess={() => refetchAll()}
            mode={selectedCommentData.mode}
            pageName={commentPage?.name}
            pageUrl={commentPageUrl}
            onSetupPostReply={async () => { if (await postReplySetup.open(selectedCommentData.comment)) setSelectedCommentData(null); }}
          />
        );
      })()}

      {/* Post Reply config — opened from a comment's detail modal (shared flow) */}
      {postReplySetup.modal}

      {/* Message Conversation Modal — opens inline from attention items or recent messages */}
      {selectedConversation && (
        <MessageDetailModal
          key={selectedConversation.senderId}
          conversation={selectedConversation}
          onClose={handleConversationModalClose}
          onReply={handleMessageReply}
          onReplyToConversation={handleMessageReplyToConversation}
          onResolve={handleMessageResolve}
          onUnresolve={handleMessageUnresolve}
          onPause={handleMessagePause}
          onResume={handleMessageResume}
          isReplying={isReplying}
          isPausing={isPausing}
          isResuming={isResuming}
          pageName={selectedMessagePageName}
          pageUrl={selectedMessagePageUrl}
          facebookPageId={selectedMessageFacebookPageId}
          isInstagram={selectedConversation.lastMessage.platform === 'instagram'}
          platform={selectedConversation.lastMessage.platform ?? 'facebook'}
        />
      )}
    </>
  );
};

// Persistent layout - prevents Sidebar remounting on navigation
DashboardPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Dashboard">{page}</DashboardLayout>
);

export default DashboardPage;

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.dashboard]);
