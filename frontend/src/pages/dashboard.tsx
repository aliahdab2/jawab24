import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardHeader, Badge, PageHeader, PageSpinner } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { useAuthStore } from '@/lib/store';
import axios from 'axios';
import { 
  MessageSquare, 
  TrendingUp, 
  Zap, 
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  Bot,
  FileText
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import type { Comment, Page } from '@jawab24/shared';

export default function DashboardPage() {
  const { t, language } = useTranslation();
  const { token } = useAuthStore();
  const [loading, setLoading] = useState(true);
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

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      const [commentsRes, pagesRes, templatesRes, rulesRes] = await Promise.all([
        axios.get(`${apiUrl}/comments`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${apiUrl}/pages`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${apiUrl}/templates`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${apiUrl}/rules`, { headers: { Authorization: `Bearer ${token}` } })
      ]);

      const comments: Comment[] = commentsRes.data;
      const fetchedPages: Page[] = pagesRes.data;
      const templates = templatesRes.data;
      const rules = rulesRes.data;

      setRecentComments(comments.slice(0, 5));
      setPages(fetchedPages);

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

  const stats = [
    { 
      nameKey: 'dashboard.totalComments', 
      value: statsData.totalComments.toLocaleString(), 
      change: '+0%', // Real trend requires historical data
      trend: 'up',
      icon: MessageSquare,
      color: 'brand'
    },
    { 
      nameKey: 'dashboard.autoReplies', 
      value: statsData.autoReplies.toLocaleString(), 
      change: '+0%', 
      trend: 'up',
      icon: Zap,
      color: 'accent'
    },
    { 
      nameKey: 'dashboard.aiReplies', 
      value: statsData.aiReplies.toLocaleString(), 
      change: '+0%', 
      trend: 'up',
      icon: Bot,
      color: 'emerald'
    },
    { 
      nameKey: 'dashboard.avgResponseTime', 
      value: statsData.avgResponseTime, 
      change: '0%', 
      trend: 'up',
      icon: Clock,
      color: 'violet'
    },
  ];

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
      {/* Header */}
      <PageHeader 
        title={t('dashboard.title')} 
        description={t('dashboard.overview')} 
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 lg:gap-6 mb-6 md:mb-8">
        {stats.map((stat, i) => (
          <Card 
            key={stat.nameKey} 
            hover 
            className="animate-slide-up"
            style={{ animationDelay: `${i * 0.1}s` } as React.CSSProperties}
          >
            <div className="flex items-start justify-between">
              <div className="text-start flex-1 min-w-0">
                <p className="text-xs md:text-sm text-surface-500 mb-1 truncate">{t(stat.nameKey)}</p>
                <p className="text-xl md:text-2xl lg:text-3xl font-display font-bold text-surface-900">
                  {stat.value}
                </p>
              </div>
              <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                stat.color === 'brand' ? 'bg-brand-100' :
                stat.color === 'accent' ? 'bg-accent-100' :
                stat.color === 'emerald' ? 'bg-emerald-100' :
                'bg-violet-100'
              }`}>
                <stat.icon className={`w-5 h-5 md:w-6 md:h-6 ${
                  stat.color === 'brand' ? 'text-brand-600' :
                  stat.color === 'accent' ? 'text-accent-600' :
                  stat.color === 'emerald' ? 'text-emerald-600' :
                  'text-violet-600'
                }`} />
              </div>
            </div>
            {/* Trend - hidden on small mobile */}
            <div className="mt-2 md:mt-4 hidden sm:flex items-center gap-1 opacity-50">
              <ArrowUpRight className="w-3 h-3 md:w-4 md:h-4 text-surface-400" />
              <span className="text-xs md:text-sm text-surface-400">
                {t('dashboard.vsLastWeek')}
              </span>
            </div>
          </Card>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Comments */}
        <Card className="lg:col-span-2" padding="none">
          <CardHeader 
            title={t('dashboard.recentComments')} 
            description={t('dashboard.latestCommentsDesc')}
          />
          <div className="divide-y divide-surface-100">
            {recentComments.length > 0 ? recentComments.map((comment) => (
              <div key={comment.id} className="px-6 py-4 hover:bg-surface-50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 text-start">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-medium text-surface-900">{comment.fromName || t('common.unknownUser')}</span>
                      <span className="text-surface-300">•</span>
                      <span className="text-xs text-surface-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(comment.createdAt)}
                      </span>
                    </div>
                    <p className="text-surface-600 truncate">{comment.message}</p>
                  </div>
                  <div className="flex-shrink-0">
                    {comment.replied ? (
                      <Badge variant={comment.replyMethod === 'ai' ? 'info' : 'success'}>
                        {comment.replyMethod === 'ai' ? t('dashboard.aiReply') : t('dashboard.templateReply')}
                      </Badge>
                    ) : (
                      <Badge variant="warning">{t('dashboard.pending')}</Badge>
                    )}
                  </div>
                </div>
              </div>
            )) : (
                <div className="p-6 text-center text-surface-500">
                    {t('common.noData')}
                </div>
            )}
          </div>
          <div className="px-6 py-4 border-t border-surface-100 text-start">
            <Link href="/comments" className="text-sm text-brand-600 hover:text-brand-700 font-medium">
              {t('dashboard.viewAllComments')} {language === 'ar' ? '←' : '→'}
            </Link>
          </div>
        </Card>

        {/* Top Pages */}
        <Card padding="none">
          <CardHeader 
            title={t('dashboard.topPages')} 
            description={t('dashboard.topPagesDesc')}
          />
          <div className="space-y-4 px-6 pb-6">
            {pages.length > 0 ? pages.slice(0, 3).map((page, i) => (
              <div key={page.id} className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-surface-100 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-surface-600" />
                </div>
                <div className="flex-1 min-w-0 text-start">
                  <p className="font-medium text-surface-900 truncate">{page.name}</p>
                  <p className="text-sm text-surface-500">
                    {page.commentsCount || 0} {t('dashboard.comments')}
                  </p>
                </div>
                <div className="text-end">
                  <span className="text-lg font-semibold text-surface-900">#{i + 1}</span>
                </div>
              </div>
            )) : (
                <div className="text-center text-surface-500">
                    {t('common.noData')}
                </div>
            )}
          </div>
          <div className="px-6 py-4 border-t border-surface-100 text-start">
            <Link href="/pages" className="text-sm text-brand-600 hover:text-brand-700 font-medium">
              {t('dashboard.managePages')} {language === 'ar' ? '←' : '→'}
            </Link>
          </div>
        </Card>
      </div>

      {/* Quick Stats Bar */}
      <Card className="mt-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0">
              <BarChart3 className="w-5 h-5 text-brand-600" />
            </div>
            <div className="text-start min-w-0">
              <p className="text-xs md:text-sm text-surface-500 truncate">{t('dashboard.replyRate')}</p>
              <p className="text-lg md:text-xl font-bold text-surface-900">{statsData.replyRate}%</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="text-start min-w-0">
              <p className="text-xs md:text-sm text-surface-500 truncate">{t('dashboard.activePages')}</p>
              <p className="text-lg md:text-xl font-bold text-surface-900">{statsData.activePages}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent-100 flex items-center justify-center flex-shrink-0">
              <FileText className="w-5 h-5 text-accent-600" />
            </div>
            <div className="text-start min-w-0">
              <p className="text-xs md:text-sm text-surface-500 truncate">{t('dashboard.templates')}</p>
              <p className="text-lg md:text-xl font-bold text-surface-900">{statsData.templatesCount}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
              <Zap className="w-5 h-5 text-violet-600" />
            </div>
            <div className="text-start min-w-0">
              <p className="text-xs md:text-sm text-surface-500 truncate">{t('dashboard.activeRules')}</p>
              <p className="text-lg md:text-xl font-bold text-surface-900">{statsData.activeRules}</p>
            </div>
          </div>
        </div>
      </Card>
    </DashboardLayout>
  );
}
