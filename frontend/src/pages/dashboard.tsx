import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardHeader, Badge, PageHeader } from '@/components/ui';
import { useTranslation } from '@/i18n';
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

// Demo data
const recentComments = [
  { 
    id: 1, 
    author: 'أحمد علي', 
    message: 'كم سعر هذا المنتج؟', 
    page: 'متجر التقنية', 
    time: 2,
    replied: true,
    method: 'template'
  },
  { 
    id: 2, 
    author: 'سارة محمد', 
    message: 'هل يتوفر باللون الأزرق؟', 
    page: 'الموضة', 
    time: 5,
    replied: true,
    method: 'ai'
  },
  { 
    id: 3, 
    author: 'محمد خالد', 
    message: 'هل يوجد توصيل؟', 
    page: 'متجر التقنية', 
    time: 8,
    replied: true,
    method: 'template'
  },
  { 
    id: 4, 
    author: 'فاطمة أحمد', 
    message: 'منتج رائع! أحببته!', 
    page: 'الموضة', 
    time: 12,
    replied: false,
    method: null
  },
];

const topPages = [
  { name: 'متجر التقنية', comments: 1234, rate: 97 },
  { name: 'الموضة', comments: 856, rate: 96 },
  { name: 'توصيل الطعام', comments: 445, rate: 94 },
];

export default function DashboardPage() {
  const { t } = useTranslation();

  const stats = [
    { 
      nameKey: 'dashboard.totalComments', 
      value: '2,847', 
      change: '+12.5%', 
      trend: 'up',
      icon: MessageSquare,
      color: 'brand'
    },
    { 
      nameKey: 'dashboard.autoReplies', 
      value: '2,691', 
      change: '+18.2%', 
      trend: 'up',
      icon: Zap,
      color: 'accent'
    },
    { 
      nameKey: 'dashboard.aiReplies', 
      value: '1,234', 
      change: '+25.1%', 
      trend: 'up',
      icon: Bot,
      color: 'emerald'
    },
    { 
      nameKey: 'dashboard.avgResponseTime', 
      value: '< 1s', 
      change: '-45%', 
      trend: 'up',
      icon: Clock,
      color: 'violet'
    },
  ];

  return (
    <DashboardLayout title={t('dashboard.title')}>
      {/* Header */}
      <PageHeader 
        title={t('dashboard.title')} 
        description={t('dashboard.overview')} 
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-8">
        {stats.map((stat, i) => (
          <Card 
            key={stat.nameKey} 
            hover 
            className="animate-slide-up"
            style={{ animationDelay: `${i * 0.1}s` } as React.CSSProperties}
          >
            <div className="flex items-start justify-between">
              <div className="text-start">
                <p className="text-sm text-surface-500 mb-1">{t(stat.nameKey)}</p>
                <p className="text-2xl lg:text-3xl font-display font-bold text-surface-900">
                  {stat.value}
                </p>
              </div>
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                stat.color === 'brand' ? 'bg-brand-100' :
                stat.color === 'accent' ? 'bg-accent-100' :
                stat.color === 'emerald' ? 'bg-emerald-100' :
                'bg-violet-100'
              }`}>
                <stat.icon className={`w-6 h-6 ${
                  stat.color === 'brand' ? 'text-brand-600' :
                  stat.color === 'accent' ? 'text-accent-600' :
                  stat.color === 'emerald' ? 'text-emerald-600' :
                  'text-violet-600'
                }`} />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-1">
              {stat.trend === 'up' ? (
                <ArrowUpRight className="w-4 h-4 text-emerald-500" />
              ) : (
                <ArrowDownRight className="w-4 h-4 text-red-500" />
              )}
              <span className={`text-sm font-medium ${
                stat.trend === 'up' ? 'text-emerald-600' : 'text-red-600'
              }`}>
                {stat.change}
              </span>
              <span className="text-sm text-surface-400">{t('dashboard.vsLastWeek')}</span>
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
            {recentComments.map((comment) => (
              <div key={comment.id} className="px-6 py-4 hover:bg-surface-50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 text-start">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-medium text-surface-900">{comment.author}</span>
                      <span className="text-surface-300">•</span>
                      <span className="text-sm text-surface-400">{comment.page}</span>
                    </div>
                    <p className="text-surface-600 truncate">{comment.message}</p>
                    <p className="text-xs text-surface-400 mt-1">
                      {t('time.minutesAgo').replace('{count}', String(comment.time))}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    {comment.replied ? (
                      <Badge variant={comment.method === 'ai' ? 'info' : 'success'}>
                        {comment.method === 'ai' ? t('dashboard.aiReply') : t('dashboard.templateReply')}
                      </Badge>
                    ) : (
                      <Badge variant="warning">{t('dashboard.pending')}</Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="px-6 py-4 border-t border-surface-100 text-start">
            <a href="/comments" className="text-sm text-brand-600 hover:text-brand-700 font-medium">
              {t('dashboard.viewAllComments')} ←
            </a>
          </div>
        </Card>

        {/* Top Pages */}
        <Card padding="none">
          <CardHeader 
            title={t('dashboard.topPages')} 
            description={t('dashboard.topPagesDesc')}
          />
          <div className="space-y-4 px-6 pb-6">
            {topPages.map((page, i) => (
              <div key={page.name} className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-surface-100 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-surface-600" />
                </div>
                <div className="flex-1 min-w-0 text-start">
                  <p className="font-medium text-surface-900 truncate">{page.name}</p>
                  <p className="text-sm text-surface-500">
                    {page.comments} {t('dashboard.comments')} • {page.rate}% {t('dashboard.replied')}
                  </p>
                </div>
                <div className="text-end">
                  <span className="text-lg font-semibold text-surface-900">#{i + 1}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="px-6 py-4 border-t border-surface-100 text-start">
            <a href="/pages" className="text-sm text-brand-600 hover:text-brand-700 font-medium">
              {t('dashboard.managePages')} ←
            </a>
          </div>
        </Card>
      </div>

      {/* Quick Stats Bar */}
      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-brand-600" />
            </div>
            <div className="text-start">
              <p className="text-sm text-surface-500">{t('dashboard.replyRate')}</p>
              <p className="text-xl font-bold text-surface-900">94.5%</p>
            </div>
          </div>
          <div className="h-12 w-px bg-surface-200 hidden md:block" />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="text-start">
              <p className="text-sm text-surface-500">{t('dashboard.activePages')}</p>
              <p className="text-xl font-bold text-surface-900">8</p>
            </div>
          </div>
          <div className="h-12 w-px bg-surface-200 hidden md:block" />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent-100 flex items-center justify-center">
              <FileText className="w-5 h-5 text-accent-600" />
            </div>
            <div className="text-start">
              <p className="text-sm text-surface-500">{t('dashboard.templates')}</p>
              <p className="text-xl font-bold text-surface-900">12</p>
            </div>
          </div>
          <div className="h-12 w-px bg-surface-200 hidden md:block" />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
              <Zap className="w-5 h-5 text-violet-600" />
            </div>
            <div className="text-start">
              <p className="text-sm text-surface-500">{t('dashboard.activeRules')}</p>
              <p className="text-xl font-bold text-surface-900">5</p>
            </div>
          </div>
        </div>
      </Card>
    </DashboardLayout>
  );
}
