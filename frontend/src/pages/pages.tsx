import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Toggle, Badge, EmptyState, PageHeader } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { 
  FileText, 
  RefreshCw, 
  ExternalLink,
  MessageSquare,
  TrendingUp,
  Settings
} from 'lucide-react';

// Demo data
const demoPages = [
  {
    id: '1',
    name: 'متجر التقنية',
    facebookPageId: '123456789',
    autoReplyEnabled: true,
    commentsCount: 1234,
    repliesCount: 1198,
    replyRate: 97,
    lastActivity: 2,
  },
  {
    id: '2',
    name: 'الموضة',
    facebookPageId: '987654321',
    autoReplyEnabled: true,
    commentsCount: 856,
    repliesCount: 823,
    replyRate: 96,
    lastActivity: 5,
  },
  {
    id: '3',
    name: 'توصيل الطعام',
    facebookPageId: '456789123',
    autoReplyEnabled: false,
    commentsCount: 445,
    repliesCount: 420,
    replyRate: 94,
    lastActivity: 60,
  },
  {
    id: '4',
    name: 'وكالة السفر',
    facebookPageId: '789123456',
    autoReplyEnabled: true,
    commentsCount: 312,
    repliesCount: 250,
    replyRate: 80,
    lastActivity: 180,
  },
];

export default function PagesPage() {
  const { t } = useTranslation();
  const [pages, setPages] = useState(demoPages);
  const [syncing, setSyncing] = useState(false);

  const handleToggle = (pageId: string, enabled: boolean) => {
    setPages(pages.map(page => 
      page.id === pageId ? { ...page, autoReplyEnabled: enabled } : page
    ));
  };

  const handleSync = () => {
    setSyncing(true);
    setTimeout(() => setSyncing(false), 2000);
  };

  const formatTime = (minutes: number) => {
    if (minutes < 60) {
      return t('time.minutesAgo').replace('{count}', String(minutes));
    }
    return t('time.hoursAgo').replace('{count}', String(Math.floor(minutes / 60)));
  };

  return (
    <DashboardLayout title={t('pages.title')}>
      {/* Header */}
      <PageHeader 
        title={t('pages.title')} 
        description={t('pages.description')}
        action={
          <Button onClick={handleSync} loading={syncing} icon={<RefreshCw className="w-4 h-4" />}>
            {t('pages.connectPage')}
          </Button>
        }
      />

      {/* Pages Grid */}
      {pages.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {pages.map((page, i) => (
            <Card 
              key={page.id} 
              hover 
              className="animate-slide-up"
              style={{ animationDelay: `${i * 0.05}s` } as React.CSSProperties}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center">
                    <FileText className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-start">
                    <h3 className="font-semibold text-surface-900">{page.name}</h3>
                    <p className="text-sm text-surface-500">ID: {page.facebookPageId}</p>
                  </div>
                </div>
                <Toggle 
                  enabled={page.autoReplyEnabled} 
                  onChange={(enabled) => handleToggle(page.id, enabled)} 
                />
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4 py-4 border-y border-surface-100">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-surface-500 mb-1">
                    <MessageSquare className="w-4 h-4" />
                    <span className="text-xs">{t('comments.title')}</span>
                  </div>
                  <p className="text-lg font-semibold text-surface-900">{page.commentsCount.toLocaleString()}</p>
                </div>
                <div className="text-center border-x border-surface-100">
                  <div className="flex items-center justify-center gap-1 text-surface-500 mb-1">
                    <TrendingUp className="w-4 h-4" />
                    <span className="text-xs">{t('dashboard.autoReplies')}</span>
                  </div>
                  <p className="text-lg font-semibold text-surface-900">{page.repliesCount.toLocaleString()}</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-surface-500 mb-1">
                    <span className="text-xs">{t('dashboard.replyRate')}</span>
                  </div>
                  <p className="text-lg font-semibold text-emerald-600">{page.replyRate}%</p>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between mt-4">
                <div className="flex items-center gap-2">
                  <Badge variant={page.autoReplyEnabled ? 'success' : 'default'}>
                    {page.autoReplyEnabled ? t('common.active') : t('common.inactive')}
                  </Badge>
                  <span className="text-xs text-surface-400">
                    {t('pages.lastActivity')}: {formatTime(page.lastActivity)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm">
                    <Settings className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm">
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={FileText}
            title={t('pages.noPages')}
            description={t('pages.noPagesDesc')}
            action={
              <Button onClick={handleSync}>
                {t('pages.connectPage')}
              </Button>
            }
          />
        </Card>
      )}
    </DashboardLayout>
  );
}
