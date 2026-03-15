import { useState, useEffect, useCallback, useRef, useMemo, type ReactElement } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, PageHeader, Button, PageSkeleton } from '@/components/ui';
import { OnboardingWizard } from '@/components/onboarding';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';

import { useAuthStore, useUIStore } from '@/lib/store';
import { subscriptionApi, settingsApi, pagesApi, commentsApi, messagesApi, analyticsApi, api } from '@/lib/api';
import type { AnalyticsOverview } from '@/lib/api';
import {
  MessageSquare,
  MessageCircle,
  Zap,
  FileText,
  Sparkles,
  Crown,
  AlertTriangle,
  ArrowRight,
  Clock,
} from 'lucide-react';
import clsx from 'clsx';
import type { Comment, Page, UsageSummary } from '@jawab24/shared';
import { AutoReplyStatusCard, CommandCenter, SmartStatusBanner, PageAccordionItem, type NeedsAttentionItem } from '@/components/dashboard';
import { captureError } from '@/lib/sentryHelpers';
import { isNativePlatform } from '@/lib/capacitor';
import { openExternalUrl } from '@/lib/openExternalUrl';
import type { NextPageWithLayout } from './_app';
import { CommentDetailModal } from '@/components/comments';
import { MessageDetailModal } from '@/components/messages/MessageDetailModal';
import { useConversationActions } from '@/hooks';
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

function UsageProgress({ label, used, limit, percent }: { label: string; used: number; limit: number | null; percent: number }) {
  const roundedPercent = Math.round(percent);
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-end text-xs">
        <span className="font-bold text-muted-foreground opacity-80 uppercase tracking-wider">
          {label}
        </span>
        <div className="flex items-baseline gap-1.5">
          <span className="font-bold text-foreground text-lg leading-none">
            {used.toLocaleString()}
          </span>
          <span className="text-muted-foreground font-medium text-xs">/ {limit ? limit.toLocaleString() : '∞'}</span>
          {limit && (
            <span className={clsx(
              'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
              roundedPercent > 90 ? 'status-error' :
                roundedPercent > 75 ? 'status-warning' :
                  'text-muted-foreground'
            )}>
              {roundedPercent}%
            </span>
          )}
        </div>
      </div>
      <div className="h-2.5 w-full bg-surface-300 dark:bg-white/10 rounded-full overflow-hidden shadow-inner p-0.5 relative">
        <div
          className={clsx(
            "h-full rounded-full transition-all duration-1000 relative shadow-sm",
            percent > 100 ? 'bg-gradient-to-r from-red-500 to-red-600' :
              percent > 75 ? 'bg-gradient-to-r from-amber-500 to-amber-600' :
                'bg-gradient-to-r from-brand-500 to-brand-600'
          )}
          style={{
            width: `${Math.min(percent, 100)}%`,
            boxShadow: percent > 10 ? `0 0 10px ${percent > 100 ? 'rgba(239, 68, 68, 0.3)' : percent > 75 ? 'rgba(245, 158, 11, 0.3)' : 'rgba(20, 184, 166, 0.3)'}` : 'none'
          }}
        >
          {percent > 20 && (
            <div className="absolute inset-0 bg-white/20 animate-pulse-soft"></div>
          )}
        </div>
      </div>
    </div>
  );
}

// Key for localStorage to track if onboarding was completed
const ONBOARDING_COMPLETE_KEY = 'jawab24_onboarding_complete';

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
  const { language, intlLocale } = useLanguage();
  const { isAuthenticated, fbToken, user } = useAuthStore();
  const { setOnboardingVisible } = useUIStore();
  const isDemoUser = useIsDemoUser();
  const queryClient = useQueryClient();

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [kbNudgeDismissed, setKbNudgeDismissed] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('kbNudgeDismissed') === 'true'
  );

  // Selected Comment State
  const [selectedCommentData, setSelectedCommentData] = useState<{ comment: Comment, mode: 'full' | 'quick' } | null>(null);

  // Conversation modal actions (shared hook — reply, pause, resume, resolve, pause-status)
  const {
    selectedConversation,
    setSelectedConversation,
    handleReply: handleMessageReply,
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

  const { data: commentStats, isError: commentStatsError } = useQuery({
    queryKey: ['comments-stats'],
    queryFn: async () => {
      const res = await commentsApi.getStats();
      return res.data || { total: 0, replied: 0, unreplied: 0, needsAttention: 0, repliedToday: 0, replyRate: '0.0', byMethod: { ai: 0, template: 0, manual: 0 } };
    },
    enabled: isAuthenticated,
  });

  const { data: messageStats, isError: messageStatsError } = useQuery({
    queryKey: ['messages-stats'],
    queryFn: async () => {
      const res = await messagesApi.getStats();
      return res.data || { total: 0, replied: 0, pending: 0, needsAttention: 0, repliedToday: 0, byMethod: { ai: 0, template: 0, manual: 0 } };
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

  const { data: pages = [], isError: pagesError } = useQuery({
    queryKey: ['pages'],
    queryFn: async () => {
      const res = await pagesApi.getAll();
      if (Array.isArray(res.data)) return res.data as Page[];
      if (Array.isArray(res.data?.data)) return res.data.data as Page[];
      return [];
    },
    enabled: isAuthenticated,
  });

  const { data: usage } = useQuery({
    queryKey: ['dashboard-usage'],
    queryFn: async () => {
      const res = await subscriptionApi.getUsage();
      const usageData = res.data?.data ?? res.data;
      if (usageData?.subscription !== undefined || usageData?.aiReplies !== undefined) {
        return usageData as UsageSummary;
      }
      return null;
    },
    enabled: isAuthenticated,
  });

  const { data: userSettings } = useQuery({
    queryKey: ['dashboard-settings'],
    queryFn: async () => {
      const res = await settingsApi.get();
      return {
        commentsAutoReply: res.data?.commentsAutoReply ?? true,
        messagesAutoReply: res.data?.messagesAutoReply ?? true,
        onboardingCompletedAt: res.data?.onboardingCompletedAt ?? null,
      };
    },
    enabled: isAuthenticated,
  });

  const { data: analytics, isError: analyticsError } = useQuery({
    queryKey: ['dashboard-analytics'],
    queryFn: async () => {
      const res = await analyticsApi.getOverview(30);
      return (res.data ?? null) as AnalyticsOverview | null;
    },
    enabled: isAuthenticated,
  });

  const { data: needsActionComments } = useQuery({
    queryKey: ['dashboard-needs-action-comments'],
    queryFn: async () => {
      const res = await commentsApi.getAll({ replied: false, resolved: false, limit: 5 });
      if (Array.isArray(res.data)) return res.data;
      return res.data?.data ?? [];
    },
    enabled: isAuthenticated,
  });

  const { data: recentMessages } = useQuery({
    queryKey: ['dashboard-recent-messages'],
    queryFn: async () => {
      const res = await messagesApi.getAll({ limit: 20, direction: 'incoming' });
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
    queryClient.invalidateQueries({ queryKey: ['dashboard-recent-comments'] });
    queryClient.invalidateQueries({ queryKey: ['pages'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-usage'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-settings'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-needs-action-comments'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-recent-messages'] });
  }, [queryClient]);

  // --- Derived state (computed from query data) ---

  const statsData = useMemo(() => {
    const stats = commentStats || { total: 0, replied: 0, unreplied: 0, needsAttention: 0, repliedToday: 0, replyRate: '0.0', byMethod: { ai: 0, template: 0, manual: 0 } };
    const msgStats = messageStats || { total: 0, replied: 0, pending: 0, needsAttention: 0, repliedToday: 0, byMethod: { ai: 0, template: 0, manual: 0 } };
    const activePages = pages.filter(p => p.autoReplyEnabled || p.instagramAutoReplyEnabled).length;

    return {
      totalComments: stats.total,
      repliedToday: (stats.repliedToday ?? 0) + (msgStats.repliedToday ?? 0),
      pendingReplies: stats.unreplied,
      needsAttention: stats.needsAttention,
      commentsNeedsAction: Math.max(0, stats.unreplied ?? 0),
      activePages,
      aiReplies: stats.byMethod.ai + (msgStats.byMethod?.ai ?? 0),
      templateReplies: stats.byMethod.template + (msgStats.byMethod?.template ?? 0),
      manualReplies: stats.byMethod.manual + (msgStats.byMethod?.manual ?? 0),
      totalMessages: msgStats.total,
      messagesPending: msgStats.pending,
      messagesNeedsAttention: msgStats.needsAttention ?? 0,
      messagesNeedsAction: Math.max(0, msgStats.pending ?? 0),
      messagesAiReplies: msgStats.byMethod?.ai ?? 0,
      messagesTemplateReplies: msgStats.byMethod?.template ?? 0,
      messagesManualReplies: msgStats.byMethod?.manual ?? 0,
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
          href: '/comments?filter=needs_action',
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
          senderName: latest.senderName ?? null,
          text: latest.message || '',
          createdAt: latest.createdTime || latest.createdAt || null,
          flagReason: latest.flagReason ?? null,
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

  // Auto-sync if no pages found — only for existing users (onboarding already completed)
  const syncAttemptedRef = useRef(false);
  useEffect(() => {
    const onboardingComplete = localStorage.getItem(ONBOARDING_COMPLETE_KEY) || userSettings?.onboardingCompletedAt;
    if (!loading && pages.length === 0 && fbToken && isAuthenticated && !syncAttemptedRef.current && onboardingComplete) {
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
  }, [loading, pages.length, fbToken, isAuthenticated, queryClient, t, userSettings]);

  // Show onboarding for new users — server-side state is the source of truth,
  // localStorage is a fast cache to prevent flash on subsequent page loads.
  useEffect(() => {
    if (!loading && pages.length === 0 && userSettings !== undefined) {
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
  }, [loading, pages.length, userSettings, setOnboardingVisible]);

  // Pre-build a Map for O(1) page name lookups (avoids O(n×m) find() in render loops)
  const pageNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const page of pages) {
      if (page.name) {
        map.set(page.id, page.name);
        map.set(page.facebookPageId, page.name);
      }
    }
    return map;
  }, [pages]);

  const getPageName = (pageId: string | null): string | null => {
    if (!pageId) return null;
    return pageNameMap.get(pageId) ?? null;
  };

  // Handle onboarding completion — persist to server + localStorage
  const markOnboardingDone = useCallback(() => {
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
    setShowOnboarding(false);
    setOnboardingVisible(false);
    settingsApi.update({ onboardingCompletedAt: new Date().toISOString() }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['pages'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-settings'] });
  }, [setOnboardingVisible, queryClient]);

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

  const openConversationModal = useCallback(async (senderId: string, pageId: string, senderName: string | null) => {
    const loadingToastId = toast.loading(tc('loading'));
    try {
      const res = await messagesApi.getConversation(senderId, { pageId, limit: 50 });
      const msgs = Array.isArray(res.data) ? res.data : [];
      if (msgs.length === 0) {
        toast.error(tc('noData'), { id: loadingToastId });
        return;
      }
      toast.dismiss(loadingToastId);
      const sorted = [...msgs].sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      setSelectedConversation({
        senderId,
        senderName: senderName || msgs[0]?.senderName || null,
        messages: sorted,
        lastMessage: sorted[sorted.length - 1],
        needsHumanAttention: sorted.some(m => m.needsAttention && !m.replied),
      });
    } catch (err) {
      captureError(err, 'Failed to load conversation', { tags: { page: 'dashboard', action: 'open-conversation' } });
      toast.error(t('sectionLoadError'), { id: loadingToastId });
    }
  }, [t, tc, setSelectedConversation]);

  const handleAttentionItemClick = useCallback((item: NeedsAttentionItem) => {
    if (item.type === 'message' && item.senderId && item.pageId) {
      openConversationModal(item.senderId, item.pageId, item.senderName);
    }
  }, [openConversationModal]);

  const handleConversationModalClose = useCallback(() => {
    setSelectedConversation(null);
    // Refresh attention data to reflect any changes made in the modal
    queryClient.invalidateQueries({ queryKey: ['dashboard-recent-messages'] });
    queryClient.invalidateQueries({ queryKey: ['messages-stats'] });
  }, [queryClient, setSelectedConversation]);

  // Resolved page name + URL for message modal
  const selectedMessagePageName = useMemo(
    () => selectedConversation
      ? pages.find(p => p.id === selectedConversation.lastMessage.pageId)?.name
      : undefined,
    [selectedConversation, pages]
  );

  const selectedMessagePageUrl = useMemo(() => {
    if (!selectedConversation) return undefined;
    const page = pages.find(p => p.id === selectedConversation.lastMessage.pageId);
    if (!page) return undefined;
    return `https://facebook.com/${page.facebookPageId}`;
  }, [selectedConversation, pages]);

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

      {/* Smart status message */}
      {userSettings && (
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
        items={needsAttentionItems}
        onMessageItemClick={handleAttentionItemClick}
      />

      {/* Command Center — consolidated metrics */}
      <CommandCenter
        smartReplies={statsData.aiReplies}
        repliedToday={statsData.repliedToday}
        replyRate={analytics?.totals?.replyRate ?? '0'}
        avgSpeedSeconds={analytics?.responseTime?.avgSeconds ?? null}
        hasError={sectionErrors.comments && sectionErrors.messages && sectionErrors.analytics}
        onRetry={refetchAll}
      />

      {/* Inbox: Comments + Messages side by side */}
      {(() => {
        // Shared time-label helper for both sections
        const getTimeLabel = (date: string | Date | null | undefined) => {
          if (!date) return '';
          const d = new Date(typeof date === 'string' ? date : date);
          const diffMs = Date.now() - d.getTime();
          const diffMin = Math.floor(diffMs / 60_000);
          const diffHr = Math.floor(diffMs / 3_600_000);
          const diffDay = Math.floor(diffMs / 86_400_000);
          if (diffMin < 1) return tTime('justNow');
          if (diffMin < 60) return tTime('minutesAgo', { count: diffMin });
          if (diffHr < 24) return tTime('hoursAgo', { count: diffHr });
          return tTime('daysAgo', { count: diffDay });
        };

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
                  <Link href="/comments" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700 group whitespace-nowrap">
                    <span>{tc('viewAll')}</span>
                    <ArrowRight className="w-4 h-4 transition-transform rtl:rotate-180 rtl:group-hover:-translate-x-1 ltr:group-hover:translate-x-1" />
                  </Link>
                )}
              </div>

              <div className="divide-y divide-theme-border">
                {sectionErrors.recentComments ? (
                  <SectionError onRetry={refetchAll} />
                ) : commentItems.length > 0 ? (
                  commentItems.slice(0, maxRows).map((comment) => {
                    const snippet = comment.message && comment.message.length > 60
                      ? `${comment.message.slice(0, 60)}...`
                      : (comment.message || '');
                    const timeLabel = getTimeLabel(comment.createdAt);
                    const commentPageName = getPageName(comment.pageId);

                    return (
                      <button
                        key={comment.id}
                        type="button"
                        onClick={() => setSelectedCommentData({ comment, mode: 'full' })}
                        className="flex items-start gap-3 px-4 py-3 sm:px-5 sm:py-3.5 hover:bg-muted/50 transition-colors w-full text-start"
                      >
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-xs font-bold text-muted-foreground">
                            {(comment.fromName || '?')[0].toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm font-semibold text-foreground truncate">
                                {comment.fromName || tc('unknownUser')}
                              </span>
                              {commentPageName && (
                                <span className="text-[10px] font-medium text-muted-foreground px-1.5 py-0.5 bg-muted rounded truncate max-w-[100px] flex-shrink-0">
                                  {commentPageName}
                                </span>
                              )}
                            </div>
                            {timeLabel && (
                              <span className="text-[11px] text-muted-foreground whitespace-nowrap flex-shrink-0 flex items-center gap-1">
                                <Clock className="w-3 h-3" aria-hidden="true" />
                                {timeLabel}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate leading-relaxed">
                            {snippet}
                          </p>
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
                  <Link href="/messages" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700 group whitespace-nowrap">
                    <span>{tc('viewAll')}</span>
                    <ArrowRight className="w-4 h-4 transition-transform rtl:rotate-180 rtl:group-hover:-translate-x-1 ltr:group-hover:translate-x-1" />
                  </Link>
                )}
              </div>

              <div className="divide-y divide-theme-border">
                {sectionErrors.messages ? (
                  <SectionError onRetry={refetchAll} />
                ) : messageItems.length > 0 ? (
                  messageItems.slice(0, maxRows).map((msg) => {
                    const snippet = msg.message && msg.message.length > 60
                      ? `${msg.message.slice(0, 60)}...`
                      : (msg.message || '');
                    const timeLabel = getTimeLabel(msg.createdTime || msg.createdAt);

                    return (
                      <button
                        key={msg.id}
                        type="button"
                        onClick={() => openConversationModal(msg.senderId, msg.pageId, msg.senderName)}
                        className="flex items-start gap-3 px-4 py-3 sm:px-5 sm:py-3.5 hover:bg-muted/50 transition-colors w-full text-start"
                      >
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-xs font-bold text-muted-foreground">
                            {(msg.senderName || '?')[0].toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <span className="text-sm font-semibold text-foreground truncate">
                              {msg.senderName || tc('unknownUser')}
                            </span>
                            {timeLabel && (
                              <span className="text-[11px] text-muted-foreground whitespace-nowrap flex-shrink-0 flex items-center gap-1">
                                <Clock className="w-3 h-3" aria-hidden="true" />
                                {timeLabel}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate leading-relaxed">
                            {snippet}
                          </p>
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
                    {/* Section A: Plan Info + Billing */}
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
                        isNativePlatform() ? (
                          <button
                            onClick={() => openExternalUrl(`https://jawab24.com${language === 'en' ? '/en' : ''}/pricing`)}
                            className="block mt-5 w-full"
                          >
                            <Button
                              variant="secondary"
                              className="w-full py-3.5 text-sm border-surface-400 dark:border-surface-400 hover:border-brand-500 dark:hover:border-brand-500"
                            >
                              {tSub('managePlan')}
                            </Button>
                          </button>
                        ) : (
                          <Link href="/pricing" className="block mt-5">
                            <Button
                              variant="secondary"
                              className="w-full py-3.5 text-sm border-surface-400 dark:border-surface-400 hover:border-brand-500 dark:hover:border-brand-500"
                            >
                              {tSub('managePlan')}
                            </Button>
                          </Link>
                        )
                      ) : (
                        isNativePlatform() ? (
                          <button
                            onClick={() => openExternalUrl(`https://jawab24.com${language === 'en' ? '/en' : ''}/pricing`)}
                            className="block mt-5 w-full"
                          >
                            <Button
                              variant="primary"
                              className="w-full py-4 text-base shadow-[0_12px_32px_rgba(20,184,166,0.24)]"
                              icon={<Sparkles className="w-5 h-5" />}
                            >
                              {tSub('upgradePlan')}
                            </Button>
                          </button>
                        ) : (
                          <Link href="/pricing" className="block mt-5">
                            <Button
                              variant="primary"
                              className="w-full py-4 text-base shadow-[0_12px_32px_rgba(20,184,166,0.24)]"
                              icon={<Sparkles className="w-5 h-5" />}
                            >
                              {tSub('upgradePlan')}
                            </Button>
                          </Link>
                        )
                      )}
                    </div>

                    {/* Divider */}
                    <div className="border-t border-theme-border" />

                    {/* Section B: Quota Usage */}
                    <div className="p-6 sm:p-8">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] mb-5">
                        {tSub('usage')}
                      </p>
                      <div className="space-y-6">
                        <UsageProgress
                          label={tSub('aiRepliesUsed')}
                          used={usage.aiReplies.used}
                          limit={usage.aiReplies.limit}
                          percent={usage.aiReplies.percentUsed}
                        />
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

          {/* KB Nudge Banner — after first reply + thin KB */}
          {!kbNudgeDismissed && (() => {
            const hasReplied = pages.some(p => (p.repliesCount ?? 0) >= 1);
            const hasThinKb = pages.some(p => (p.repliesCount ?? 0) >= 1 && (p.knowledgeBase || '').length < 200);

            if (hasReplied && hasThinKb) {
              return (
                <div className="flex items-start gap-3 p-4 rounded-2xl alert-warning border mb-0">
                  <Sparkles className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{t('kbNudgeTitle')}</p>
                    <p className="text-xs mt-0.5 opacity-80">{t('kbNudgeDesc')}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <Link href="/pages">
                        <Button size="sm" variant="primary" className="text-xs">
                          {t('kbNudgeCta')}
                        </Button>
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          localStorage.setItem('kbNudgeDismissed', 'true');
                          setKbNudgeDismissed(true);
                        }}
                        className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {tc('dismiss')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            }
            return null;
          })()}

          {/* Top Pages */}
          <Card padding="none" className="border-none shadow-2xl shadow-surface-200/50 bg-card overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-theme-border bg-background/50">
              <h2 className="text-lg font-display font-bold text-foreground tracking-tight">{t('topPages')}</h2>
              <p className="text-sm font-medium text-muted-foreground mt-1">{t('topPagesDesc')}</p>
            </div>
            <div className={clsx(
              'divide-y divide-theme-border',
              pages.length >= 3 && 'max-h-[400px] overflow-y-auto'
            )}>
              {sectionErrors.pages ? (
                <SectionError onRetry={refetchAll} />
              ) : pages.length > 0 ? pages.map((page, i) => {
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
      {selectedCommentData && (
        <CommentDetailModal
          comment={selectedCommentData.comment}
          onClose={() => setSelectedCommentData(null)}
          onReplySuccess={() => refetchAll()}
          mode={selectedCommentData.mode}
        />
      )}

      {/* Message Conversation Modal — opens inline from attention items or recent messages */}
      {selectedConversation && (
        <MessageDetailModal
          key={selectedConversation.senderId}
          conversation={selectedConversation}
          onClose={handleConversationModalClose}
          onReply={handleMessageReply}
          onResolve={handleMessageResolve}
          onUnresolve={handleMessageUnresolve}
          onPause={handleMessagePause}
          onResume={handleMessageResume}
          isReplying={isReplying}
          isPausing={isPausing}
          isResuming={isResuming}
          pageName={selectedMessagePageName}
          pageUrl={selectedMessagePageUrl}
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
