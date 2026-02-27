import { useState, useEffect, useCallback, useRef, useMemo, type ReactElement } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, PageHeader, Button, PageSkeleton } from '@/components/ui';
import { OnboardingWizard } from '@/components/onboarding';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useAuthStore, useUIStore } from '@/lib/store';
import { subscriptionApi, settingsApi, pagesApi, commentsApi, messagesApi, analyticsApi, api } from '@/lib/api';
import type { AnalyticsOverview } from '@/lib/api';
import {
  MessageSquare,
  Zap,
  FileText,
  Sparkles,
  Crown,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import clsx from 'clsx';
import type { Comment, Page, UsageSummary } from '@jawab24/shared';
import { AutoReplyStatusCard, CommandCenter, SmartStatusBanner, PageAccordionItem, type NeedsAttentionItem } from '@/components/dashboard';
import { captureError } from '@/lib/sentryHelpers';
import type { NextPageWithLayout } from './_app';
import { CommentDetailModal, CommentCard } from '@/components/comments';
import { useIsDemoUser } from '@/features/demo';

function SectionError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center gap-2 py-4 text-surface-500">
      <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" />
      <span className="text-sm">{t('dashboard.sectionLoadError')}</span>
      <button
        onClick={onRetry}
        className="text-sm font-semibold text-brand-600 hover:text-brand-700 underline"
      >
        {t('errors.tryAgain')}
      </button>
    </div>
  );
}

function UsageProgress({ label, used, limit, percent }: { label: string; used: number; limit: number | null; percent: number }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-end text-xs">
        <span className="font-bold text-surface-500 opacity-80 uppercase tracking-wider">
          {label}
        </span>
        <div className="flex items-baseline gap-1">
          <span className="font-bold text-surface-900 text-lg leading-none">
            {used.toLocaleString()}
          </span>
          <span className="text-surface-400 font-medium text-xs">/ {limit ? limit.toLocaleString() : '∞'}</span>
        </div>
      </div>
      <div className="h-2.5 w-full bg-surface-100 rounded-full overflow-hidden shadow-inner p-0.5 relative">
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
const PLAN_NAME_KEYS: Record<string, TranslationKey> = {
  'Starter': 'plans.starter.name' as TranslationKey,
  'Business': 'plans.business.name' as TranslationKey,
  'Pro': 'plans.pro.name' as TranslationKey,
};

const DashboardPage: NextPageWithLayout = () => {
  const { t, intlLocale } = useTranslation();
  const { isAuthenticated, fbToken } = useAuthStore();
  const { setOnboardingVisible } = useUIStore();
  const isDemoUser = useIsDemoUser();
  
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [recentComments, setRecentComments] = useState<Comment[]>([]);
  
  // Selected Comment State
  const [selectedCommentData, setSelectedCommentData] = useState<{ comment: Comment, mode: 'full' | 'quick' } | null>(null);
  
  const [pages, setPages] = useState<Page[]>([]);
  const [imgError, setImgError] = useState<Record<string, boolean>>({});
  const [expandedPageId, setExpandedPageId] = useState<string | null>(null);
  const [needsAttentionItems, setNeedsAttentionItems] = useState<NeedsAttentionItem[]>([]);
  const [statsData, setStatsData] = useState({
    // Comment stats
    totalComments: 0,
    repliedToday: 0,
    pendingReplies: 0,
    needsAttention: 0,
    commentsNeedsAction: 0,
    activePages: 0,
    aiReplies: 0,
    templateReplies: 0,
    manualReplies: 0,
    // Message stats
    totalMessages: 0,
    messagesPending: 0,
    messagesNeedsAttention: 0,
    messagesNeedsAction: 0,
    messagesAiReplies: 0,
    messagesTemplateReplies: 0,
    messagesManualReplies: 0
  });
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [userSettings, setUserSettings] = useState<{ commentsAutoReply: boolean; messagesAutoReply: boolean } | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
  const [sectionErrors, setSectionErrors] = useState({
    comments: false,
    messages: false,
    recentComments: false,
    pages: false,
    usage: false,
    settings: false,
    analytics: false,
  });

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      // Track which sections failed to load
      const errors = {
        comments: false,
        messages: false,
        recentComments: false,
        pages: false,
        usage: false,
        settings: false,
        analytics: false,
      };

      // Use API instances that handle auth via cookies (web) or Bearer token (mobile)
      const [statsRes, messagesStatsRes, commentsListRes, pagesRes, usageRes, settingsRes, analyticsRes, needsActionCommentsRes, needsActionMessagesRes] = await Promise.all([
        commentsApi.getStats().catch(() => { errors.comments = true; return null; }),
        messagesApi.getStats().catch(() => { errors.messages = true; return null; }),
        commentsApi.getAll({ limit: 5 }).catch(() => { errors.recentComments = true; return null; }),
        pagesApi.getAll().catch(() => { errors.pages = true; return null; }),
        subscriptionApi.getUsage().catch(() => { errors.usage = true; return null; }),
        settingsApi.get().catch(() => { errors.settings = true; return null; }),
        analyticsApi.getOverview(30).catch(() => { errors.analytics = true; return null; }),
        // Fetch items for the needs-attention banner (unreplied + unresolved)
        commentsApi.getAll({ replied: false, resolved: false, limit: 5 }).catch(() => null),
        messagesApi.getAll({ replied: false, resolved: false, limit: 5 }).catch(() => null),
      ]);

      // Set usage data if available (handle both nested and flat response shapes)
      if (usageRes?.data) {
        const usageData = usageRes.data.data ?? usageRes.data;
        if (usageData?.subscription !== undefined || usageData?.aiReplies !== undefined) {
          setUsage(usageData);
        }
      }

      // Set analytics data if available
      if (analyticsRes?.data) {
        setAnalytics(analyticsRes.data);
      }

      // Set user settings if available
      if (settingsRes?.data) {
        setUserSettings({
          commentsAutoReply: settingsRes.data.commentsAutoReply ?? true,
          messagesAutoReply: settingsRes.data.messagesAutoReply ?? true
        });
      }

      const recentCommentsList: Comment[] = commentsListRes
        ? (Array.isArray(commentsListRes.data)
          ? commentsListRes.data as unknown as Comment[]
          : (Array.isArray(commentsListRes.data?.data) ? commentsListRes.data.data : []) as unknown as Comment[])
        : [];

      const fetchedPages: Page[] = pagesRes
        ? (Array.isArray(pagesRes.data)
          ? pagesRes.data
          : (Array.isArray(pagesRes.data?.data) ? pagesRes.data.data : []))
        : [];

      setPages(fetchedPages);

      // Show onboarding for new users
      const onboardingComplete = localStorage.getItem(ONBOARDING_COMPLETE_KEY);
      if (fetchedPages.length === 0 && !onboardingComplete) {
        setShowOnboarding(true);
        setOnboardingVisible(true); 
      }

      // Set Recent Comments
      setRecentComments(recentCommentsList);

      // --- Process Stats from Server ---
      
      // Comments Stats
      const stats = statsRes?.data || {
        total: 0,
        replied: 0,
        unreplied: 0,
        needsAttention: 0,
        repliedToday: 0,
        replyRate: '0.0',
        byMethod: { ai: 0, template: 0, manual: 0 }
      };

      // Messages Stats
      const msgStats = messagesStatsRes?.data || { total: 0, replied: 0, pending: 0, needsAttention: 0, byMethod: { ai: 0, template: 0, manual: 0 } };

      // Calculate active pages
      const activePages = fetchedPages.filter(p => p.autoReplyEnabled).length;

      // "Needs Action" counts — match the Comments/Messages page filter tabs exactly
      // Comments page uses stats.unreplied (replied=false, resolved=false)
      // Messages page uses statsData.pending (replied=false, resolved=false)
      const commentsNeedsAction = stats.unreplied ?? 0;
      const messagesNeedsAction = msgStats.pending ?? 0;

      setStatsData({
        totalComments: stats.total,
        repliedToday: stats.repliedToday,
        pendingReplies: stats.unreplied,
        needsAttention: stats.needsAttention,
        commentsNeedsAction,
        activePages,
        aiReplies: stats.byMethod.ai,
        templateReplies: stats.byMethod.template,
        manualReplies: stats.byMethod.manual,
        // Message stats
        totalMessages: msgStats.total,
        messagesPending: msgStats.pending,
        messagesNeedsAttention: msgStats.needsAttention ?? 0,
        messagesNeedsAction,
        messagesAiReplies: msgStats.byMethod?.ai ?? 0,
        messagesTemplateReplies: msgStats.byMethod?.template ?? 0,
        messagesManualReplies: msgStats.byMethod?.manual ?? 0,
      });

      // Build needs-attention items for the expandable banner
      const bannerItems: NeedsAttentionItem[] = [];

      // Add unreplied comments
      if (needsActionCommentsRes?.data) {
        const commentsList = Array.isArray(needsActionCommentsRes.data)
          ? needsActionCommentsRes.data
          : (needsActionCommentsRes.data?.data ?? []);
        for (const c of commentsList) {
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

      // Add unreplied messages
      if (needsActionMessagesRes?.data) {
        const messagesList = Array.isArray(needsActionMessagesRes.data)
          ? needsActionMessagesRes.data
          : (needsActionMessagesRes.data?.data ?? []);
        for (const m of messagesList) {
          bannerItems.push({
            id: m.id,
            type: 'message',
            senderName: m.senderName ?? null,
            text: m.message || '',
            createdAt: m.createdTime || m.createdAt || null,
            flagReason: m.flagReason ?? null,
            href: '/messages?filter=needs_action',
          });
        }
      }

      // Sort by newest first, take max 5
      bannerItems.sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return db - da;
      });
      setNeedsAttentionItems(bannerItems.slice(0, 5));

      // Update section error state
      setSectionErrors(errors);

      // Only show toast for total failure (likely network issue)
      const failedCount = Object.values(errors).filter(Boolean).length;
      if (failedCount === 7) {
        toast.error(t('dashboard.fetchError'));
      } else if (failedCount > 0) {
        captureError(
          new Error(`Dashboard partial load: ${failedCount}/7 sections failed`),
          'Partial dashboard load failure',
          { tags: { page: 'dashboard' } }
        );
      }

    } catch (error) {
      captureError(error, 'Failed to fetch dashboard data', { tags: { page: 'dashboard' } });
      toast.error(t('dashboard.fetchError'));
    } finally {
      setLoading(false);
    }
  }, [setOnboardingVisible, t]);

  // Auto-sync if no pages found — only for existing users (onboarding already completed)
  // New users are guided through onboarding instead
  const syncAttemptedRef = useRef(false);
  useEffect(() => {
    const onboardingComplete = localStorage.getItem(ONBOARDING_COMPLETE_KEY);
    if (!loading && pages.length === 0 && fbToken && isAuthenticated && !syncAttemptedRef.current && onboardingComplete) {
      syncAttemptedRef.current = true;
      api.post('/pages/sync', { accessToken: fbToken })
        .then(() => {
          fetchDashboardData();
        })
        .catch(err => {
          captureError(err, 'Dashboard auto-sync failed', { tags: { page: 'dashboard', action: 'auto-sync' } });
          toast.error(t('dashboard.syncError'));
        });
    }
  }, [loading, pages.length, fbToken, isAuthenticated, fetchDashboardData, t]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchDashboardData();
    }
  }, [isAuthenticated, fetchDashboardData]);

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

  // Calculate trend for today vs yesterday
  // Handle onboarding completion
  const handleOnboardingComplete = () => {
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
    setShowOnboarding(false);
    setOnboardingVisible(false);
  };

  const handleOnboardingSkip = () => {
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
    setShowOnboarding(false);
    setOnboardingVisible(false);
  };

  // Auto-expand accordion when only 1 page is connected
  useEffect(() => {
    if (pages.length === 1) {
      setExpandedPageId(pages[0].id);
    }
  }, [pages]);

  const handlePageAccordionToggle = useCallback((pageId: string) => {
    setExpandedPageId(prev => prev === pageId ? null : pageId);
  }, []);

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
        title={t('dashboard.title')}
        description={`${t('dashboard.overview')} · ${new Date().toLocaleDateString(intlLocale, { weekday: 'long', month: 'long', day: 'numeric' })}`}
      />

      {/* Smart status message */}
      {userSettings && (
        <AutoReplyStatusCard
          activePages={statsData.activePages}
          commentsAutoReply={userSettings.commentsAutoReply}
          messagesAutoReply={userSettings.messagesAutoReply}
        />
      )}

      {/* Smart Status Banner — needs attention or all caught up */}
      <SmartStatusBanner
        commentNeedsAction={statsData.commentsNeedsAction}
        messageNeedsAction={statsData.messagesNeedsAction}
        items={needsAttentionItems}
      />

      {/* Command Center — consolidated metrics */}
      <CommandCenter
        smartReplies={statsData.aiReplies + statsData.messagesAiReplies}
        repliedToday={statsData.repliedToday}
        replyRate={analytics?.totals?.replyRate ?? '0'}
        avgSpeedSeconds={analytics?.responseTime?.avgSeconds ?? null}
        byMethod={{
          ai: statsData.aiReplies + statsData.messagesAiReplies,
          template: statsData.templateReplies + statsData.messagesTemplateReplies,
          manual: statsData.manualReplies + statsData.messagesManualReplies,
        }}
        hasError={sectionErrors.comments && sectionErrors.messages && sectionErrors.analytics}
        onRetry={fetchDashboardData}
      />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Comments */}
        <Card className="lg:col-span-2 border-none shadow-2xl shadow-surface-200/50 bg-white" padding="none">
          <div className="p-4 sm:p-5 border-b border-surface-100 flex items-center justify-between gap-4 bg-surface-50/50">
            <div>
              <h2 className="text-lg font-display font-bold text-surface-900 tracking-tight">{t('dashboard.recentComments')}</h2>
              <p className="text-sm text-surface-500 mt-0.5">{t('dashboard.latestCommentsDesc')}</p>
            </div>
            {recentComments.length > 0 && (
              <Link href="/comments" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700 group whitespace-nowrap">
                <span>{t('common.viewAll')}</span>
                <ArrowRight className="w-4 h-4 transition-transform rtl:rotate-180 rtl:group-hover:-translate-x-1 ltr:group-hover:translate-x-1" />
              </Link>
            )}
          </div>

          <div className="divide-y divide-surface-100">
            {sectionErrors.recentComments ? (
              <SectionError onRetry={fetchDashboardData} />
            ) : recentComments.length > 0 ? (
              (() => {
                // Check if user has active pages on BOTH platforms
                const hasFacebook = pages.some(p => !!p.facebookPageId);
                const hasInstagram = pages.some(p => !!p.instagramAccountId);
                const showPlatformIcon = hasFacebook && hasInstagram;

                return recentComments.map((comment, i) => (
                  <CommentCard
                    key={comment.id}
                    comment={comment}
                    variant="compact"
                    pageName={getPageName(comment.pageId) || undefined}
                    showPlatformIcon={showPlatformIcon}
                    animationDelay={(i + 3) * 0.1}
                    onClick={() => setSelectedCommentData({ comment, mode: 'full' })}
                    onQuickReply={() => setSelectedCommentData({ comment, mode: 'quick' })}
                  />
                ));
              })()
            ) : (
              <div className="py-12 text-center">
                <div className="w-14 h-14 rounded-2xl bg-surface-100 flex items-center justify-center mx-auto mb-3">
                  <MessageSquare className="w-7 h-7 text-surface-300" />
                </div>
                <p className="text-sm font-medium text-surface-500 mb-1">
                  {t('dashboard.noRecentComments')}
                </p>
                {pages.length === 0 && (
                  <Link href="/pages">
                    <Button variant="primary" size="sm" className="mt-3">
                      {t('pages.connectPage')}
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Top Pages & Usage Column */}
        <div className="space-y-8">
          {/* Usage Card — Split into Plan Info + Quota sections */}
          {usage && usage.subscription && (
            <Card className="border-none shadow-2xl shadow-brand-500/10 overflow-hidden bg-white relative group" padding="none">
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
                          <p className="text-[10px] font-bold text-brand-600 uppercase tracking-[0.2em] mb-1">{t('subscription.currentPlan')}</p>
                          <h3 className="text-base sm:text-lg lg:text-xl font-display font-bold text-surface-900 tracking-tight flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span>{PLAN_NAME_KEYS[usage.subscription.plan.name] ? t(PLAN_NAME_KEYS[usage.subscription.plan.name]) : usage.subscription.plan.name}</span>
                            {isTrialing && (
                              <span className="inline-flex items-center text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-[10px] font-extrabold border border-amber-200">
                                {t('subscription.trialBadge' as TranslationKey)}
                              </span>
                            )}
                          </h3>
                        </div>
                      </div>

                      {isTrialing && usage.subscription.trialDaysRemaining && usage.subscription.trialDaysRemaining > 0 && (
                        <div className="mt-5 p-3 rounded-xl bg-amber-50 border border-amber-100 flex items-center gap-3 text-amber-700">
                          <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center shadow-sm">
                            <Zap className="w-4 h-4" />
                          </div>
                          <span className="text-xs font-bold leading-relaxed">
                            {t('subscription.trialEndsIn')} {usage.subscription.trialDaysRemaining} {t('subscription.days')}
                          </span>
                        </div>
                      )}

                      {isPaidPlan ? (
                        <Link href="/pricing" className="block mt-5">
                          <Button
                            variant="secondary"
                            className="w-full py-3.5 text-sm"
                          >
                            {t('subscription.managePlan')}
                          </Button>
                        </Link>
                      ) : (
                        <Link href="/pricing" className="block mt-5">
                          <Button
                            variant="primary"
                            className="w-full py-4 text-base shadow-[0_12px_32px_rgba(20,184,166,0.24)]"
                            icon={<Sparkles className="w-5 h-5" />}
                          >
                            {t('subscription.upgradePlan')}
                          </Button>
                        </Link>
                      )}
                    </div>

                    {/* Divider */}
                    <div className="border-t border-surface-100" />

                    {/* Section B: Quota Usage */}
                    <div className="p-6 sm:p-8">
                      <p className="text-[10px] font-bold text-surface-500 uppercase tracking-[0.2em] mb-5">
                        {t('subscription.usage')}
                      </p>
                      <div className="space-y-6">
                        <UsageProgress
                          label={t('subscription.aiRepliesUsed')}
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
                              label={t('subscription.pagesUsed')}
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

          {/* Top Pages */}
          <Card padding="none" className="border-none shadow-2xl shadow-surface-200/50 bg-white overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-surface-100 bg-surface-50/50">
              <h2 className="text-lg font-display font-bold text-surface-900 tracking-tight">{t('dashboard.topPages')}</h2>
              <p className="text-sm font-medium text-surface-500 mt-1">{t('dashboard.topPagesDesc')}</p>
            </div>
            <div className={clsx(
              'divide-y divide-surface-100',
              pages.length >= 3 && 'max-h-[400px] overflow-y-auto'
            )}>
              {sectionErrors.pages ? (
                <SectionError onRetry={fetchDashboardData} />
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
                  <div className="w-12 h-12 rounded-xl bg-surface-100 flex items-center justify-center mx-auto mb-3">
                    <FileText className="w-6 h-6 text-surface-300" aria-hidden="true" />
                  </div>
                  <p className="text-sm text-surface-500 mb-3">{t('pages.noPagesDesc')}</p>
                  <Link href="/pages">
                    <Button variant="primary" size="sm">
                      {t('pages.connectPage')}
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </Card>
      </div>
    </div>

      {/* Comment Detail Modal - Now handles both modes */}
      {selectedCommentData && (
        <CommentDetailModal
          comment={selectedCommentData.comment}
          onClose={() => setSelectedCommentData(null)}
          onReplySuccess={async () => {
            await fetchDashboardData();
          }}
          mode={selectedCommentData.mode}
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
