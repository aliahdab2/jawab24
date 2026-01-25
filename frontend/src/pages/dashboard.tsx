import { useState, useEffect, useCallback, type ReactElement } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, PageHeader, Button, PageSkeleton } from '@/components/ui';
import { OnboardingWizard } from '@/components/onboarding';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useAuthStore, useUIStore } from '@/lib/store';
import { subscriptionApi, settingsApi, pagesApi, commentsApi } from '@/lib/api';
import {
  MessageSquare,
  Zap,
  Clock,
  FileText,
  Sparkles,
  Crown,
  AlertTriangle,
  ChevronRight,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Bot,
  Minus
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
        <span className="font-bold text-surface-500 opacity-80">
          {label}
        </span>
        <span className="font-bold text-surface-900 text-sm">
          {used.toLocaleString()} <span className="text-surface-400 font-medium">/ {limit ? limit.toLocaleString() : '∞'}</span>
        </span>
      </div>
      <div className="h-2.5 w-full bg-surface-100 rounded-full overflow-hidden shadow-inner p-0.5">
        <div
          className={clsx(
            "h-full rounded-full transition-all duration-1000 relative",
            percent > 90 ? 'bg-gradient-to-r from-red-500 to-red-600' :
              percent > 75 ? 'bg-gradient-to-r from-amber-500 to-amber-600' :
                'bg-gradient-to-r from-brand-500 to-brand-600'
          )}
          style={{ width: `${Math.min(percent, 100)}%` }}
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
  const { isAuthenticated } = useAuthStore();
  const { setOnboardingVisible } = useUIStore();
  
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [recentComments, setRecentComments] = useState<Comment[]>([]);
  
  // Selected Comment State
  const [selectedCommentData, setSelectedCommentData] = useState<{ comment: Comment, mode: 'full' | 'quick' } | null>(null);
  
  const [pages, setPages] = useState<Page[]>([]);
  const [statsData, setStatsData] = useState({
    totalComments: 0,
    repliedToday: 0,
    pendingReplies: 0,
    needsAttention: 0,
    activePages: 0,
    // New metrics
    commentsToday: 0,
    commentsYesterday: 0,
    aiReplies: 0,
    templateReplies: 0
  });
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [userSettings, setUserSettings] = useState<{ commentsAutoReply: boolean; messagesAutoReply: boolean } | null>(null);

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      // Use API instances that handle auth via cookies (web) or Bearer token (mobile)
      const [commentsRes, pagesRes, usageRes, settingsRes] = await Promise.all([
        commentsApi.getAll(),
        pagesApi.getAll(),
        subscriptionApi.getUsage().catch(() => null),
        settingsApi.get().catch(() => null)
      ]);

      // Set usage data if available
      if (usageRes?.data?.data) {
        setUsage(usageRes.data.data);
      }

      // Set user settings if available
      if (settingsRes?.data) {
        setUserSettings({
          commentsAutoReply: settingsRes.data.commentsAutoReply ?? true,
          messagesAutoReply: settingsRes.data.messagesAutoReply ?? true
        });
      }

      const allComments: Comment[] = Array.isArray(commentsRes.data)
        ? commentsRes.data
        : (Array.isArray(commentsRes.data?.data) ? commentsRes.data.data : []);

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

      // Calculate stats
      const totalComments = allComments.length;

      // Calculate Pending
      const pendingReplies = allComments.filter(c => !c.replied).length;

      // Calculate Replied Today
      const repliedToday = allComments.filter(c => {
        return c.replied && c.repliedAt && isToday(new Date(c.repliedAt));
      }).length;

      // Calculate Needs Attention (simple heuristic same as comments page)
      const helpKeywords = ['human', 'agent', 'help', 'support', 'complaint', 'problem', 'issue', 'مساعدة', 'بشري', 'شخص', 'موظف', 'مشكلة', 'شكوى'];
      const needsAttention = allComments.filter(c =>
        !c.replied && helpKeywords.some(kw => c.message.toLowerCase().includes(kw))
      ).length;

      // Calculate Comments Today vs Yesterday
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const commentsToday = allComments.filter(c =>
        c.createdAt && isToday(new Date(c.createdAt))
      ).length;

      const commentsYesterday = allComments.filter(c => {
        if (!c.createdAt) return false;
        const date = new Date(c.createdAt);
        return date.toDateString() === yesterday.toDateString();
      }).length;

      // Calculate AI vs Template replies (today only, to match "Today's Activity" section)
      const aiReplies = allComments.filter(c =>
        c.replied && c.replyMethod === 'ai' && c.repliedAt && isToday(new Date(c.repliedAt))
      ).length;
      const templateReplies = allComments.filter(c =>
        c.replied && c.replyMethod === 'template' && c.repliedAt && isToday(new Date(c.repliedAt))
      ).length;

      // Recent Comments Logic: Sort by newest, take top 5
      const sortedComments = [...allComments].sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      setRecentComments(sortedComments.slice(0, 5));

      setStatsData({
        totalComments,
        repliedToday,
        pendingReplies,
        needsAttention,
        activePages: fetchedPages.filter(p => p.autoReplyEnabled).length,
        commentsToday,
        commentsYesterday,
        aiReplies,
        templateReplies
      });

    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, [setOnboardingVisible]);

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

  // Improved Stats Array
  const stats = [
    {
      id: 'pending',
      nameKey: 'dashboard.pending' as TranslationKey,
      value: statsData.pendingReplies.toLocaleString(),
      icon: Clock,
      color: 'amber' as const, 
      href: '/comments?filter=pending'
    },
    {
      id: 'needs_attention',
      nameKey: 'comments.needsAttention' as TranslationKey,
      value: statsData.needsAttention.toLocaleString(),
      icon: AlertTriangle,
      color: 'red' as const, // Maps to warning/danger visually
      href: '/comments?filter=flagged'
    },
    {
      id: 'replied_today',
      nameKey: 'comments.repliedToday' as TranslationKey,
      value: statsData.repliedToday.toLocaleString(),
      icon: Zap,
      color: 'emerald' as const,
      href: '/comments?filter=replied_today'
    },
    {
      id: 'all',
      nameKey: 'comments.totalComments' as TranslationKey,
      value: statsData.totalComments.toLocaleString(),
      icon: MessageSquare,
      color: 'brand' as const,
      href: '/comments'
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

      {/* Update Stats Grid - 4 Columns */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {stats.map((stat, i) => (
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
                    <span className="text-emerald-600">+{trend.percent}% {t('dashboard.vsLastWeek' as TranslationKey)}</span>
                  )}
                  {trend.direction === 'down' && (
                    <span className="text-red-500">-{trend.percent}% {t('dashboard.vsLastWeek' as TranslationKey)}</span>
                  )}
                  {trend.direction === 'neutral' && (
                    <span className="text-surface-400">{t('dashboard.vsLastWeek' as TranslationKey)}</span>
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
              <h3 className="text-lg font-display font-bold text-surface-900 tracking-tight">{t('comments.latestComments' as any)}</h3>
            </div>
            {/* Removed Search/Filter Controls */}
          </div>

          <div className="divide-y divide-surface-100 min-h-[300px]">
            {recentComments.length > 0 ? recentComments.map((comment, i) => (
              <CommentCard
                key={comment.id}
                comment={comment}
                variant="compact"
                pageName={getPageName(comment.pageId) || undefined}
                animationDelay={(i + 3) * 0.1}
                onClick={() => setSelectedCommentData({ comment, mode: 'full' })}
                onQuickReply={() => setSelectedCommentData({ comment, mode: 'quick' })}
              />
            )) : (
              <div className="py-14 text-center">
                <div className="w-16 h-16 rounded-2xl bg-surface-100 flex items-center justify-center mx-auto mb-4">
                  <MessageSquare className="w-8 h-8 text-surface-300" />
                </div>
                <p className="text-base font-semibold text-surface-600 mb-2">
                   {statsData.pendingReplies === 0 
                      ? t('comments.noPendingComments' as any) 
                      : t('comments.noCommentsYet' as any)
                   }
                </p>
                {/* Fallback empty state */}
                {pages.length === 0 && (
                  <Link href="/pages">
                    <Button variant="primary" size="sm" className="mt-4">
                      {t('pages.connectPage')}
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </div>
          
          {/* View All Button */}
          {recentComments.length > 0 && (
             <div className="p-3 border-t border-surface-100 bg-surface-50/30">
                <Link href="/comments">
                   <Button variant="ghost" className="w-full justify-center group text-surface-500 hover:text-brand-600 hover:bg-surface-100 border border-transparent hover:border-surface-200">
                      {t('dashboard.viewAllComments')} 
                      {!t('dashboard.viewAllComments') && "View All Comments"}
                      <ArrowRight className="w-4 h-4 ms-2 transition-transform group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" />
                   </Button>
                </Link>
             </div>
          )}
        </Card>

        {/* Top Pages & Usage Column */}
        <div className="space-y-8">
          {/* Usage Card (Same as before) */}
          {usage && (
            <Card className="border-none shadow-2xl shadow-brand-500/10 overflow-hidden bg-white relative group" padding="lg">
              <div className="absolute top-0 end-0 w-32 h-32 bg-brand-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 transition-all group-hover:bg-brand-500/10"></div>

              <div className="flex items-center gap-5 mb-8 relative z-10">
                <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white shadow-xl shadow-brand-500/20 transform transition-transform group-hover:rotate-6">
                  <Crown className="w-8 h-8" />
                </div>
                <div className="min-w-0 flex-1 text-start">
                  <p className="text-[10px] font-bold text-brand-600 uppercase tracking-[0.2em] mb-1">{t('subscription.currentPlan')}</p>
                  <h4 className="text-2xl font-display font-bold text-surface-900 truncate tracking-tight">
                    {usage.subscription.plan.name}
                    {usage.subscription.status === 'trialing' && (
                      <span className="ms-2 inline-flex items-center text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-[10px] font-extrabold border border-amber-200">
                        {t('pricing.trial' as TranslationKey) !== 'pricing.trial' ? t('pricing.trial' as TranslationKey) : 'TRIAL'}
                      </span>
                    )}

                  </h4>
                  <p className="text-sm font-medium text-surface-500 mt-1">{t('subscription.upgradeDesc')}</p>
                </div>
              </div>

              <div className="space-y-6 relative z-10">
                <UsageProgress
                  label={t('subscription.aiRepliesUsed')}
                  used={usage.aiReplies.used}
                  limit={usage.aiReplies.limit}
                  percent={usage.aiReplies.percentUsed}
                />
                <UsageProgress
                  label={t('subscription.pagesUsed')}
                  used={usage.pages.used}
                  limit={usage.pages.limit}
                  percent={usage.pages.limit ? (usage.pages.used / usage.pages.limit) * 100 : 0}
                />
              </div>

              {usage.subscription.trialDaysRemaining && usage.subscription.trialDaysRemaining > 0 && (
                <div className="mt-8 p-4 rounded-2xl bg-amber-50 border border-amber-100 flex items-center gap-3 text-amber-700 animate-pulse-soft">
                  <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center shadow-sm">
                    <Zap className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold leading-relaxed">
                    {t('subscription.trialEndsIn')} {usage.subscription.trialDaysRemaining} {t('subscription.days')}
                  </span>
                </div>
              )}

              <Link href="/pricing" className="block mt-8">
                <Button
                  variant="primary"
                  className="w-full py-6 text-base whitespace-nowrap"
                  style={{ boxShadow: '0 12px 32px rgba(20, 184, 166, 0.24)' }}
                  icon={<Sparkles className="w-6 h-6" />}
                >
                  {t('subscription.upgradePlan')}
                </Button>
              </Link>
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
                    href={`/comments?page=${page.id}`}
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
            {pages.length > 0 && (
              <div className="px-5 sm:px-6 py-4 border-t border-surface-100 bg-surface-50/30">
                <Link href="/pages" className="text-sm text-brand-600 hover:text-brand-700 font-bold flex items-center justify-center gap-2 group transition-all">
                  {t('dashboard.managePages')}
                  <ChevronRight className={clsx(
                    "w-4 h-4 transition-transform group-hover:translate-x-1",
                    language === 'ar' && "rotate-180 group-hover:-translate-x-1"
                  )} />
                </Link>
              </div>
            )}
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
