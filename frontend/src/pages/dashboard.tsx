import { useState, useEffect, useCallback, useRef, type ReactElement } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, PageHeader, Button, PageSkeleton } from '@/components/ui';
import { OnboardingWizard } from '@/components/onboarding';
import { useTranslation, type TranslationKey } from '@/i18n';
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
  ChevronRight,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Bot,
  Minus,
  CheckCircle,
  Gauge,
  Flag,
  Timer
} from 'lucide-react';
import { isToday } from 'date-fns';
import clsx from 'clsx';
import type { Comment, Page, UsageSummary } from '@jawab24/shared';
import { StatCard, AutoReplyStatusCard } from '@/components/dashboard';
import type { NextPageWithLayout } from './_app';
import { CommentDetailModal, CommentCard } from '@/components/comments';

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

const DashboardPage: NextPageWithLayout = () => {
  const { t, language } = useTranslation();
  const { isAuthenticated, fbToken } = useAuthStore();
  const { setOnboardingVisible } = useUIStore();
  
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [recentComments, setRecentComments] = useState<Comment[]>([]);
  
  // Selected Comment State
  const [selectedCommentData, setSelectedCommentData] = useState<{ comment: Comment, mode: 'full' | 'quick' } | null>(null);
  
  const [pages, setPages] = useState<Page[]>([]);
  const [statsData, setStatsData] = useState({
    // Comment stats
    totalComments: 0,
    repliedToday: 0,
    needsAttention: 0,
    activePages: 0,
    commentsToday: 0,
    commentsYesterday: 0,
    aiReplies: 0,
    templateReplies: 0,
    // Message stats
    totalMessages: 0,
    messagesReplied: 0,
    messagesNeedsAttention: 0,
    messagesRepliedToday: 0
  });
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [userSettings, setUserSettings] = useState<{ commentsAutoReply: boolean; messagesAutoReply: boolean } | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      // Use API instances that handle auth via cookies (web) or Bearer token (mobile)
      const [statsRes, messagesStatsRes, commentsListRes, pagesRes, usageRes, settingsRes, analyticsRes] = await Promise.all([
        commentsApi.getStats().catch(() => null),
        messagesApi.getStats().catch(() => null),
        commentsApi.getAll({ limit: 5 }), // Only fetch recent 5 for the list
        pagesApi.getAll(),
        subscriptionApi.getUsage().catch(() => null),
        settingsApi.get().catch(() => null),
        analyticsApi.getOverview(30).catch(() => null),
      ]);

      // Set usage data if available
      if (usageRes?.data?.data) {
        setUsage(usageRes.data.data);
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

      const recentCommentsList: Comment[] = Array.isArray(commentsListRes.data)
        ? commentsListRes.data as unknown as Comment[]
        : (Array.isArray(commentsListRes.data?.data) ? commentsListRes.data.data : []) as unknown as Comment[];

      const fetchedPages: Page[] = Array.isArray(pagesRes.data)
        ? pagesRes.data
        : (Array.isArray(pagesRes.data?.data) ? pagesRes.data.data : []);

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
      const msgStats = messagesStatsRes?.data || { total: 0, replied: 0, pending: 0, needsAttention: 0 };

      // Calculate Comments Today using recent list (Approximate/Fallback)
      // Note: Ideal would be a 'today' field in getStats(), but we use available data
      const commentsToday = recentCommentsList.filter(c =>
        c.createdAt && isToday(new Date(c.createdAt))
      ).length;

      // Same for yesterday (heuristic: won't be accurate if > 5 comments today/yesterday)
      // We accept this limitation for the "Trend" widget or should ask backend for trend data
      // For now, initialized to 0 to avoid misleading drops
      const commentsYesterday = 0; 
      
      // Calculate active pages
      const activePages = fetchedPages.filter(p => p.autoReplyEnabled).length;

      const messagesNeedsAttention = msgStats.needsAttention ?? 0;

      setStatsData({
        totalComments: stats.total,
        repliedToday: stats.repliedToday,
        needsAttention: stats.needsAttention,
        activePages,
        commentsToday,
        commentsYesterday,
        aiReplies: stats.byMethod.ai,
        templateReplies: stats.byMethod.template,
        // Message stats
        totalMessages: msgStats.total,
        messagesReplied: msgStats.replied,
        messagesNeedsAttention: messagesNeedsAttention,
        messagesRepliedToday: msgStats.replied // Using total as proxy
      });

    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, [setOnboardingVisible]);

  // Auto-sync if no pages found (Ported from pages.tsx)
  const syncAttemptedRef = useRef(false);
  useEffect(() => {
    if (!loading && pages.length === 0 && fbToken && isAuthenticated && !syncAttemptedRef.current) {
      syncAttemptedRef.current = true;
      api.post('/pages/sync', { accessToken: fbToken })
        .then(() => {
          fetchDashboardData();
        })
        .catch(err => console.error('Dashboard: Auto-sync failed', err));
    }
  }, [loading, pages.length, fbToken, isAuthenticated, fetchDashboardData]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchDashboardData();
    }
  }, [isAuthenticated, fetchDashboardData]);

  // Helper to get page name from pageId
  const getPageName = (pageId: string | null): string | null => {
    if (!pageId) return null;
    const page = pages.find(p => p.id === pageId || p.facebookPageId === pageId);
    return page?.name || null;
  };

  // Calculate trend for today vs yesterday
  const getTrend = () => {
    const { commentsToday, commentsYesterday } = statsData;
    if (commentsYesterday === 0) return { direction: 'neutral' as const, percent: 0 };
    const change = ((commentsToday - commentsYesterday) / commentsYesterday) * 100;
    if (change > 0) return { direction: 'up' as const, percent: Math.round(change) };
    if (change < 0) return { direction: 'down' as const, percent: Math.abs(Math.round(change)) };
    return { direction: 'neutral' as const, percent: 0 };
  };

  const trend = getTrend();

  // Comments Stats Array
  const commentStats = [
    {
      id: 'all',
      nameKey: 'comments.totalComments' as TranslationKey,
      value: statsData.totalComments.toLocaleString(),
      icon: MessageSquare,
      color: 'brand' as const,
      href: '/comments'
    },
    {
      id: 'replied_today',
      nameKey: 'comments.repliedToday' as TranslationKey,
      value: statsData.repliedToday.toLocaleString(),
      icon: CheckCircle,
      color: 'emerald' as const,
      href: '/comments?filter=replied_today'
    },
    {
      id: 'needs_attention',
      nameKey: 'comments.needsAttention' as TranslationKey,
      value: statsData.needsAttention.toLocaleString(),
      icon: AlertTriangle,
      color: 'red' as const,
      href: '/comments?filter=flagged'
    }
  ];

  // Messages Stats Array
  const messageStats = [
    {
      id: 'all',
      nameKey: 'messages.totalMessages' as TranslationKey,
      value: statsData.totalMessages.toLocaleString(),
      icon: MessageCircle,
      color: 'brand' as const,
      href: '/messages'
    },
    {
      id: 'replied_today',
      nameKey: 'comments.repliedToday' as TranslationKey,
      value: statsData.messagesRepliedToday.toLocaleString(),
      icon: CheckCircle,
      color: 'emerald' as const,
      href: '/messages'
    },
    {
      id: 'needs_attention',
      nameKey: 'comments.needsAttention' as TranslationKey,
      value: statsData.messagesNeedsAttention.toLocaleString(),
      icon: AlertTriangle,
      color: 'red' as const,
      href: '/messages?filter=needs_attention'
    }
  ];

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
        description={t('dashboard.overview')}
      />

      {/* Smart status message */}
      {userSettings && (
        <AutoReplyStatusCard
          activePages={statsData.activePages}
          commentsAutoReply={userSettings.commentsAutoReply}
          messagesAutoReply={userSettings.messagesAutoReply}
        />
      )}

      {/* Comments Stats Section */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-surface-600 uppercase tracking-wider flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            {t('comments.title')}
          </h3>
          <Link href="/comments" className="text-xs font-semibold text-brand-600 hover:text-brand-700">
            {t('common.viewAll')} <span className="inline-block rtl:scale-x-[-1]">→</span>
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {commentStats.map((stat, i) => (
            <StatCard
              key={stat.id}
              nameKey={stat.nameKey}
              value={stat.value}
              icon={stat.icon}
              color={stat.color}
              index={i}
              href={stat.href}
            />
          ))}
        </div>
      </div>

      {/* Messages Stats Section */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-surface-600 uppercase tracking-wider flex items-center gap-2">
            <MessageCircle className="w-4 h-4" />
            {t('messages.title')}
          </h3>
          <Link href="/messages" className="text-xs font-semibold text-brand-600 hover:text-brand-700">
            {t('common.viewAll')} <span className="inline-block rtl:scale-x-[-1]">→</span>
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {messageStats.map((stat, i) => (
            <StatCard
              key={stat.id}
              nameKey={stat.nameKey}
              value={stat.value}
              icon={stat.icon}
              color={stat.color}
              index={i + 4}
              href={stat.href}
            />
          ))}
        </div>
      </div>

      {/* Performance Section — from /analytics/overview */}
      {analytics?.totals && (analytics.totals.comments + analytics.totals.messages) > 0 && (
        <div className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-surface-600 uppercase tracking-wider flex items-center gap-2">
              <Gauge className="w-4 h-4" />
              {t('dashboard.performance' as TranslationKey)}
            </h3>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <StatCard
              nameKey={'dashboard.replyRateValue' as TranslationKey}
              value={`${analytics.totals.replyRate}%`}
              icon={Gauge}
              color="brand"
              index={8}
            />
            <StatCard
              nameKey={'dashboard.flaggedItems' as TranslationKey}
              value={analytics.totals.flagged.toLocaleString()}
              icon={Flag}
              color={analytics.totals.flagged > 0 ? 'amber' : 'emerald'}
              index={9}
              href="/comments?filter=flagged"
            />
            <StatCard
              nameKey={'dashboard.avgSpeed' as TranslationKey}
              value={analytics.responseTime.avgSeconds != null ? `${Math.round(analytics.responseTime.avgSeconds)}${t('dashboard.seconds' as TranslationKey)}` : '—'}
              icon={Timer}
              color="violet"
              index={10}
            />
          </div>
        </div>
      )}

      {/* Today's Activity Summary */}
      {(statsData.commentsToday > 0 || statsData.aiReplies > 0 || statsData.templateReplies > 0) && (
        <div className="mb-8 p-4 bg-white rounded-2xl border border-surface-100 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Today vs Yesterday */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-surface-100 flex items-center justify-center">
                {trend.direction === 'up' ? (
                  <TrendingUp className="w-5 h-5 text-emerald-600" />
                ) : trend.direction === 'down' ? (
                  <TrendingDown className="w-5 h-5 text-red-500" />
                ) : (
                  <Minus className="w-5 h-5 text-surface-400" />
                )}
              </div>
              <div>
                <p className="text-sm font-bold text-surface-900">
                  {statsData.commentsToday} {t('dashboard.todayComments' as TranslationKey)}
                </p>
                <p className="text-xs text-surface-500">
                  {trend.direction === 'up' && (
                    <span className="text-emerald-600">+{trend.percent}% {t('dashboard.vsYesterday')}</span>
                  )}
                  {trend.direction === 'down' && (
                    <span className="text-red-500">-{trend.percent}% {t('dashboard.vsYesterday')}</span>
                  )}
                  {trend.direction === 'neutral' && (
                    <span className="text-surface-400">{t('dashboard.vsYesterday')}</span>
                  )}
                </p>
              </div>
            </div>

            {/* Divider */}
            <div className="hidden sm:block w-px h-10 bg-surface-200"></div>

            {/* AI vs Manual Breakdown */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-brand-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-surface-900">{statsData.aiReplies}</p>
                  <p className="text-[10px] font-medium text-surface-400 uppercase tracking-wide">{t('dashboard.aiReply' as TranslationKey)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-surface-900">{statsData.templateReplies}</p>
                  <p className="text-[10px] font-medium text-surface-400 uppercase tracking-wide">{t('dashboard.templateReply' as TranslationKey)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Comments */}
        <Card className="lg:col-span-2 border-none shadow-2xl shadow-surface-200/50 bg-white" padding="none">
          <div className="p-4 sm:p-5 border-b border-surface-100 flex items-center justify-between gap-4 bg-surface-50/50">
            <div>
              <h3 className="text-lg font-display font-bold text-surface-900 tracking-tight">{t('dashboard.recentComments')}</h3>
              <p className="text-sm text-surface-500 mt-0.5">{t('dashboard.latestCommentsDesc')}</p>
            </div>
            {recentComments.length > 0 && (
              <Link href="/comments" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700 group whitespace-nowrap">
                <span>{t('common.viewAll')}</span>
                <ArrowRight className={clsx(
                  "w-4 h-4 transition-transform",
                  language === 'ar' ? "rotate-180 group-hover:-translate-x-1" : "group-hover:translate-x-1"
                )} />
              </Link>
            )}
          </div>

          <div className="divide-y divide-surface-100">
            {recentComments.length > 0 ? (
              (() => {
                const showPageName = pages.length > 1;
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
                    showPageName={showPageName}
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
          {/* Usage Card (Same as before) */}
          {usage && (
            <Card className="border-none shadow-2xl shadow-brand-500/10 overflow-hidden bg-white relative group" padding="lg">
              <div className="absolute top-0 end-0 w-32 h-32 bg-brand-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 transition-all group-hover:bg-brand-500/10"></div>

              {(() => {
                const isTrialing = usage.subscription.status === 'trialing';
                const isPaidPlan = usage.subscription.status === 'active' && !isTrialing;

                return (
                  <>
                    <div className="flex items-center gap-5 mb-8 relative z-10">
                      <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white shadow-xl shadow-brand-500/20 transform transition-transform group-hover:rotate-6">
                        <Crown className="w-8 h-8" />
                      </div>
                      <div className="min-w-0 flex-1 text-start">
                        <p className="text-[10px] font-bold text-brand-600 uppercase tracking-[0.2em] mb-1">{t('subscription.currentPlan')}</p>
                        <h4 className="text-2xl font-display font-bold text-surface-900 truncate tracking-tight">
                          {usage.subscription.plan.name}
                          {isTrialing && (
                            <span className="ms-2 inline-flex items-center text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-[10px] font-extrabold border border-amber-200">
                              TRIAL
                            </span>
                          )}
                        </h4>
                      </div>
                    </div>

                    <div className="space-y-8 relative z-10">
                      <UsageProgress
                        label={t('subscription.aiRepliesUsed')}
                        used={usage.aiReplies.used}
                        limit={usage.aiReplies.limit}
                        percent={usage.aiReplies.percentUsed}
                      />
                      <UsageProgress
                        label={t('subscription.pagesUsed')}
                        used={Math.max(usage.pages.used, pages.length)}
                        limit={usage.pages.limit}
                        percent={usage.pages.limit ? (Math.max(usage.pages.used, pages.length) / usage.pages.limit) * 100 : 0}
                      />
                    </div>

                    {isTrialing && usage.subscription.trialDaysRemaining && usage.subscription.trialDaysRemaining > 0 && (
                      <div className="mt-8 p-4 rounded-2xl bg-amber-50 border border-amber-100 flex items-center gap-3 text-amber-700">
                        <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center shadow-sm">
                          <Zap className="w-4 h-4" />
                        </div>
                        <span className="text-xs font-bold leading-relaxed">
                          {t('subscription.trialEndsIn')} {usage.subscription.trialDaysRemaining} {t('subscription.days')}
                        </span>
                      </div>
                    )}

                    {isPaidPlan ? (
                      <Link href="/pricing" className="block mt-8">
                        <Button
                          variant="secondary"
                          className="w-full py-4 text-sm"
                        >
                          {t('subscription.managePlan')}
                        </Button>
                      </Link>
                    ) : (
                      <Link href="/pricing" className="block mt-8">
                        <Button
                          variant="primary"
                          className="w-full py-5 text-base whitespace-nowrap"
                          style={{ boxShadow: '0 12px 32px rgba(20, 184, 166, 0.24)' }}
                          icon={<Sparkles className="w-5 h-5" />}
                        >
                          {t('subscription.upgradePlan')}
                        </Button>
                      </Link>
                    )}
                  </>
                );
              })()}
            </Card>
          )}

          {/* Top Pages */}
          <Card padding="none" className="border-none shadow-2xl shadow-surface-200/50 bg-white overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-surface-100 bg-surface-50/50">
              <h3 className="text-lg font-display font-bold text-surface-900 tracking-tight">{t('dashboard.topPages')}</h3>
              <p className="text-sm font-medium text-surface-500 mt-1">{t('dashboard.topPagesDesc')}</p>
            </div>
            <div className="divide-y divide-surface-100">
              {pages.length > 0 ? pages.slice(0, 3).map((page, i) => {
                // Calculate per-page stats from recentComments (approximation)
                const pageComments = recentComments.filter(c => c.pageId === page.id || c.pageId === page.facebookPageId);
                const pendingCount = pageComments.filter(c => !c.replied).length;

                return (
                  <Link
                    href="/pages"
                    key={page.id}
                    className="flex items-center gap-4 p-4 sm:p-5 group hover:bg-brand-50/30 transition-all cursor-pointer animate-slide-up"
                    style={{ animationDelay: `${(i + 5) * 0.1}s` } as React.CSSProperties}
                  >
                    <div className="relative flex-shrink-0">
                      <div className={clsx(
                        "w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-sm border",
                        page.autoReplyEnabled
                          ? 'bg-brand-50 text-brand-600 border-brand-100'
                          : 'bg-surface-50 text-surface-500 border-surface-200',
                        "group-hover:scale-105"
                      )}>
                        <FileText className="w-6 h-6" />
                      </div>
                      {/* Auto-reply status indicator */}
                      <div className={clsx(
                        "absolute -bottom-1 -end-1 w-5 h-5 rounded-full border-2 border-white flex items-center justify-center",
                        page.autoReplyEnabled ? 'bg-emerald-500' : 'bg-surface-300'
                      )}>
                        {page.autoReplyEnabled ? (
                          <Bot className="w-3 h-3 text-white" />
                        ) : (
                          <Minus className="w-3 h-3 text-white" />
                        )}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 text-start">
                      <p className="font-bold text-surface-900 truncate group-hover:text-brand-600 transition-colors">
                        {page.name}
                      </p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-xs text-surface-500">
                          {page.commentsCount || 0} {t('dashboard.comments')}
                        </span>
                        {pendingCount > 0 && (
                          <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                            {pendingCount} {t('dashboard.pending')}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className={clsx(
                      "w-5 h-5 text-surface-300 group-hover:text-brand-500 transition-all",
                      "group-hover:translate-x-1",
                      language === 'ar' && "rotate-180 group-hover:-translate-x-1"
                    )} />
                  </Link>
                );
              }) : (
                <div className="py-10 text-center">
                  <div className="w-12 h-12 rounded-xl bg-surface-100 flex items-center justify-center mx-auto mb-3">
                    <FileText className="w-6 h-6 text-surface-300" />
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
