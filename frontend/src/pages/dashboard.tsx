import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Badge, PageHeader, PageSpinner, Button } from '@/components/ui';
import { OnboardingWizard } from '@/components/onboarding';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useAuthStore } from '@/lib/store';
import axios from 'axios';
import { subscriptionApi } from '@/lib/api';
import {
  MessageSquare,
  Zap,
  Clock,
  FileText,
  Sparkles,
  Crown,
  ChevronRight
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import type { Comment, Page, UsageSummary } from '@jawab24/shared';

function UsageProgress({ label, used, limit, percent }: { label: string; used: number; limit: number | null; percent: number }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center text-xs">
        <span className="font-bold text-surface-500 uppercase tracking-widest">{label}</span>
        <span className="font-bold text-surface-900">
          {used.toLocaleString()} <span className="text-surface-400">/ {limit ? limit.toLocaleString() : '∞'}</span>
        </span>
      </div>
      <div className="h-2 w-full bg-surface-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${percent > 90 ? 'bg-red-500' : percent > 75 ? 'bg-amber-500' : 'bg-brand-500'
            }`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        ></div>
      </div>
    </div>
  );
}

// Key for localStorage to track if onboarding was completed
const ONBOARDING_COMPLETE_KEY = 'jawab24_onboarding_complete';

export default function DashboardPage() {
  const { t, language } = useTranslation();
  const { token } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [recentComments, setRecentComments] = useState<Comment[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [statsData, setStatsData] = useState({
    totalComments: 0,
    autoReplies: 0,
    aiReplies: 0,
    avgResponseTime: '< 1s', // Placeholder
    replyRate: 0,
    activePages: 0,
    templatesCount: 0,
    activeRules: 0
  });
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      const [commentsRes, pagesRes, templatesRes, rulesRes, usageRes] = await Promise.all([
        axios.get(`${apiUrl}/comments`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${apiUrl}/pages`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${apiUrl}/templates`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${apiUrl}/rules`, { headers: { Authorization: `Bearer ${token}` } }),
        subscriptionApi.getUsage().catch(() => null)
      ]);

      // Set usage data if available
      if (usageRes?.data?.data) {
        setUsage(usageRes.data.data);
      }

      const comments: Comment[] = commentsRes.data;
      const fetchedPages: Page[] = pagesRes.data;
      const templates = templatesRes.data;
      const rules = rulesRes.data;

      setRecentComments(comments.slice(0, 5));
      setPages(fetchedPages);

      // Show onboarding for new users (no pages connected and haven't completed onboarding)
      const onboardingComplete = localStorage.getItem(ONBOARDING_COMPLETE_KEY);
      if (fetchedPages.length === 0 && !onboardingComplete) {
        setShowOnboarding(true);
      }

      // Calculate stats
      const totalComments = comments.length;
      const repliedComments = comments.filter(c => c.replied);
      const aiReplies = comments.filter(c => c.replyMethod === 'ai').length;
      const autoReplies = repliedComments.length; // Assuming all replies are auto for now or tracked by method
      const replyRate = totalComments > 0 ? Math.round((repliedComments.length / totalComments) * 100) : 0;

      setStatsData({
        totalComments,
        autoReplies,
        aiReplies,
        avgResponseTime: '< 1s',
        replyRate,
        activePages: fetchedPages.filter(p => p.autoReplyEnabled).length,
        templatesCount: templates.length,
        activeRules: rules.filter((r: any) => r.active).length
      });

    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, [token, apiUrl]);

  useEffect(() => {
    if (token) {
      fetchDashboardData();
    }
  }, [token, fetchDashboardData]);

  const formatTime = (dateValue: string | Date | null | undefined) => {
    if (!dateValue) return '-';
    try {
      return formatDistanceToNow(new Date(dateValue), {
        addSuffix: true,
        locale: language === 'ar' ? ar : enUS
      });
    } catch {
      return String(dateValue);
    }
  };

  // Simplified stats - only 3 essential metrics for low-tech users
  const stats = [
    {
      nameKey: 'dashboard.totalComments' as TranslationKey,
      value: statsData.totalComments.toLocaleString(),
      icon: MessageSquare,
      color: 'brand',
      descriptionKey: 'dashboard.totalCommentsDesc' as TranslationKey
    },
    {
      nameKey: 'dashboard.autoReplies' as TranslationKey,
      value: statsData.autoReplies.toLocaleString(),
      icon: Zap,
      color: 'emerald',
      descriptionKey: 'dashboard.autoRepliesDesc' as TranslationKey
    },
    {
      nameKey: 'dashboard.pending' as TranslationKey,
      value: (statsData.totalComments - statsData.autoReplies).toLocaleString(),
      icon: Clock,
      color: 'amber',
      descriptionKey: 'dashboard.pendingDesc' as TranslationKey
    },
  ];

  // Handle onboarding completion
  const handleOnboardingComplete = () => {
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
    setShowOnboarding(false);
  };

  const handleOnboardingSkip = () => {
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
    setShowOnboarding(false);
  };

  if (loading) {
    return (
      <DashboardLayout title={t('dashboard.title')}>
        <div className="flex items-center justify-center h-64">
          <PageSpinner />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t('dashboard.title')}>
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

      {/* Stats Grid - Simplified to 3 cards with more visual interest */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-12">
        {stats.map((stat, i) => (
          <Card
            key={stat.nameKey}
            hover
            className="animate-slide-up relative overflow-hidden group border-none shadow-xl shadow-surface-200/50 bg-white"
            style={{ animationDelay: `${i * 0.1}s` } as React.CSSProperties}
            padding="lg"
          >
            {/* Background decoration */}
            <div className={`absolute -end-6 -bottom-6 w-32 h-32 rounded-full opacity-[0.03] transition-all duration-700 group-hover:scale-150 group-hover:opacity-[0.08] ${stat.color === 'brand' ? 'bg-brand-500' :
              stat.color === 'emerald' ? 'bg-emerald-500' :
                'bg-amber-500'
              }`}></div>

            <div className="relative z-10 flex flex-col items-center">
              <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mb-6 transition-all duration-500 group-hover:rotate-12 group-hover:scale-110 shadow-inner ${stat.color === 'brand' ? 'bg-brand-50 text-brand-600 border border-brand-100/50' :
                stat.color === 'emerald' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100/50' :
                  'bg-amber-50 text-amber-600 border border-amber-100/50'
                }`}>
                <stat.icon className="w-10 h-10" />
              </div>
              <p className="text-5xl font-display font-extrabold text-surface-900 mb-2 tracking-tighter">
                {stat.value}
              </p>
              <p className="text-xs font-bold text-surface-400 uppercase tracking-[0.2em]">{t(stat.nameKey)}</p>
              <div className="mt-4 px-4 py-1.5 rounded-full bg-surface-50 border border-surface-100 text-[10px] font-bold text-surface-500 uppercase tracking-widest group-hover:bg-brand-50 group-hover:text-brand-600 group-hover:border-brand-100 transition-all">
                {t(stat.descriptionKey)}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Comments */}
        <Card className="lg:col-span-2 border-none shadow-2xl shadow-surface-200/50 bg-white" padding="none">
          <div className="p-8 border-b border-surface-100 flex items-center justify-between bg-surface-50/50">
            <div>
              <h3 className="text-xl font-display font-bold text-surface-900 tracking-tight">{t('dashboard.recentComments')}</h3>
              <p className="text-sm font-medium text-surface-500 mt-1">{t('dashboard.latestCommentsDesc')}</p>
            </div>
            <Link href="/comments">
              <Button variant="secondary" size="sm" className="font-bold border-none bg-white shadow-sm hover:shadow-md">
                {t('dashboard.viewAllComments')}
              </Button>
            </Link>
          </div>

          <div className="divide-y divide-surface-100">
            {recentComments.length > 0 ? recentComments.map((comment, i) => (
              <div
                key={comment.id}
                className="px-8 py-6 hover:bg-brand-50/20 transition-all group animate-slide-up"
                style={{ animationDelay: `${(i + 3) * 0.1}s` } as React.CSSProperties}
              >
                <div className="flex items-start justify-between gap-6">
                  <div className="flex-1 min-w-0 text-start">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <div className="w-8 h-8 rounded-full bg-surface-100 flex items-center justify-center text-xs font-bold text-surface-500 group-hover:bg-brand-100 group-hover:text-brand-600 transition-colors">
                        {comment.fromName?.charAt(0) || '?'}
                      </div>
                      <span className="font-bold text-surface-900 group-hover:text-brand-600 transition-colors">
                        {comment.fromName || t('common.unknownUser')}
                      </span>
                      <span className="text-surface-300">•</span>
                      <span className="text-[10px] font-bold text-surface-400 uppercase tracking-[0.1em] flex items-center gap-1.5 bg-surface-50 px-2 py-0.5 rounded-full">
                        <Clock className="w-3 h-3" />
                        {formatTime(comment.createdAt)}
                      </span>
                    </div>
                    <p className="text-surface-600 text-sm leading-relaxed italic italic-arabic ps-11">"{comment.message}"</p>
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-2">
                    {comment.replied ? (
                      <Badge variant={comment.replyMethod === 'ai' ? 'info' : 'success'} className="shadow-sm px-4 py-1.5 rounded-xl">
                        {comment.replyMethod === 'ai' ? (
                          <span className="flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> {t('dashboard.aiReply')}</span>
                        ) : (
                          <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" /> {t('dashboard.templateReply')}</span>
                        )}
                      </Badge>
                    ) : (
                      <Badge variant="warning" className="shadow-sm px-4 py-1.5 rounded-xl">{t('dashboard.pending')}</Badge>
                    )}
                  </div>
                </div>
              </div>
            )) : (
              <div className="py-20 text-center">
                <div className="w-20 h-20 rounded-3xl bg-surface-50 flex items-center justify-center mx-auto mb-6 border border-surface-100 shadow-inner">
                  <MessageSquare className="w-10 h-10 text-surface-200" />
                </div>
                <p className="text-lg font-bold text-surface-400 uppercase tracking-widest">{t('common.noData')}</p>
              </div>
            )}
          </div>
        </Card>

        {/* Top Pages & Usage Column */}
        <div className="space-y-8">
          {/* Usage & Plan Status - Now integrated as a main card */}
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
                      <span className="ms-2 inline-flex items-center text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-[10px] uppercase font-extrabold tracking-wider border border-amber-200">
                        {t('pricing.trial' as TranslationKey) !== 'pricing.trial' ? t('pricing.trial' as TranslationKey) : 'TRIAL'}
                      </span>
                    )}
                  </h4>
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
                  <span className="text-xs font-bold uppercase tracking-widest leading-relaxed">
                    {t('subscription.trialEndsIn')} {usage.subscription.trialDaysRemaining} {t('subscription.days')}
                  </span>
                </div>
              )}

              <Link href="/pricing" className="block mt-8">
                <Button
                  variant="primary"
                  className="w-full shadow-2xl shadow-brand-500/30 py-7 text-lg whitespace-nowrap"
                  icon={<Sparkles className="w-5 h-5" />}
                >
                  {t('subscription.upgradePlan')}
                </Button>
              </Link>
            </Card>
          )}

          {/* Top Pages */}
          <Card padding="none" className="border-none shadow-2xl shadow-surface-200/50 bg-white overflow-hidden">
            <div className="p-8 border-b border-surface-100 bg-surface-50/50">
              <h3 className="text-xl font-display font-bold text-surface-900 tracking-tight">{t('dashboard.topPages')}</h3>
              <p className="text-sm font-medium text-surface-500 mt-1">{t('dashboard.topPagesDesc')}</p>
            </div>
            <div className="space-y-6 px-8 py-8">
              {pages.length > 0 ? pages.slice(0, 3).map((page, i) => (
                <div key={page.id} className="flex items-center gap-5 group animate-slide-up" style={{ animationDelay: `${(i + 5) * 0.1}s` } as React.CSSProperties}>
                  <div className="relative">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all shadow-sm border ${i === 0 ? 'bg-brand-50 text-brand-600 border-brand-100' : 'bg-surface-50 text-surface-600 border-surface-100'
                      } group-hover:scale-110 group-hover:rotate-3`}>
                      <FileText className="w-7 h-7" />
                    </div>
                    <div className="absolute -top-2 -end-2 w-7 h-7 rounded-xl bg-surface-900 shadow-lg border-2 border-white flex items-center justify-center text-[10px] font-bold text-white">
                      {i + 1}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 text-start">
                    <p className="font-bold text-surface-900 truncate group-hover:text-brand-600 transition-colors text-lg tracking-tight">{page.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                      <p className="text-xs font-bold text-surface-400 uppercase tracking-widest">
                        {page.commentsCount || 0} {t('dashboard.comments')}
                      </p>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="py-10 text-center text-surface-400 font-bold uppercase tracking-widest text-xs">
                  {t('common.noData')}
                </div>
              )}
            </div>
            <div className="px-8 py-5 border-t border-surface-100 bg-surface-50/30">
              <Link href="/pages" className="text-sm text-brand-600 hover:text-brand-700 font-bold flex items-center justify-center gap-2 group transition-all">
                {t('dashboard.managePages')}
                <ChevronRight className={`w-4 h-4 transition-transform group-hover:translate-x-1 ${language === 'ar' ? 'rotate-180 group-hover:-translate-x-1' : ''}`} />
              </Link>
            </div>
          </Card>
        </div>
      </div>

      {/* Simple status message */}
      {statsData.activePages > 0 && (
        <Card className="mt-6 bg-emerald-50 border-emerald-200">
          <div className="flex items-center gap-3 text-emerald-700">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <Zap className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="font-medium">
                {t('dashboard.activeRepliesOn', { count: statsData.activePages })}
              </p>
              <p className="text-sm text-emerald-600">
                {t('dashboard.autoReplyNote')}
              </p>
            </div>
          </div>
        </Card>
      )}
    </DashboardLayout>
  );
}
