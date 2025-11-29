import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Toggle, Badge, EmptyState, PageHeader, PageSpinner } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { useAuthStore } from '@/lib/store';
import { 
  FileText, 
  RefreshCw, 
  ExternalLink,
  MessageSquare,
  TrendingUp,
  Settings
} from 'lucide-react';
import axios from 'axios';

// Define Page interface matching backend
interface Page {
  id: string;
  name: string;
  facebookPageId: string;
  autoReplyEnabled: boolean;
  commentsCount?: number;
  repliesCount?: number;
  replyRate?: number;
  lastActivity?: number;
  createdAt: string;
}

export default function PagesPage() {
  const { t } = useTranslation();
  const { token, fbToken } = useAuthStore();
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

  // Fetch pages on load
  useEffect(() => {
    fetchPages();
  }, [token]);

  const fetchPages = async () => {
    if (!token) return;
    
    try {
      setLoading(true);
      const response = await axios.get(`${apiUrl}/pages`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPages(response.data);
    } catch (error) {
      console.error('Failed to fetch pages:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (pageId: string, enabled: boolean) => {
    // Optimistic update
    setPages(pages.map(page => 
      page.id === pageId ? { ...page, autoReplyEnabled: enabled } : page
    ));

    try {
      await axios.patch(`${apiUrl}/pages/${pageId}/auto-reply`, 
        { enabled },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (error) {
      console.error('Failed to toggle auto-reply:', error);
      // Revert on error
      setPages(pages.map(page => 
        page.id === pageId ? { ...page, autoReplyEnabled: !enabled } : page
      ));
    }
  };

  const handleSync = async () => {
    if (!token || !fbToken) {
      console.error('No tokens available for sync');
      return;
    }
    
    try {
      setSyncing(true);
      // Call sync endpoint with user's FB token
      await axios.post(`${apiUrl}/pages/sync`, 
        { accessToken: fbToken },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      // Refresh list
      await fetchPages();
      
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setSyncing(false);
    }
  };

  const formatTime = (minutes: number) => {
    if (!minutes) return t('common.noData');
    if (minutes < 60) {
      return t('time.minutesAgo').replace('{count}', String(minutes));
    }
    return t('time.hoursAgo').replace('{count}', String(Math.floor(minutes / 60)));
  };

  if (loading && pages.length === 0) {
    return (
      <DashboardLayout title={t('pages.title')}>
        <div className="flex items-center justify-center h-64">
          <PageSpinner />
        </div>
      </DashboardLayout>
    );
  }

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
                  <p className="text-lg font-semibold text-surface-900">{(page.commentsCount || 0).toLocaleString()}</p>
                </div>
                <div className="text-center border-x border-surface-100">
                  <div className="flex items-center justify-center gap-1 text-surface-500 mb-1">
                    <TrendingUp className="w-4 h-4" />
                    <span className="text-xs">{t('dashboard.autoReplies')}</span>
                  </div>
                  <p className="text-lg font-semibold text-surface-900">{(page.repliesCount || 0).toLocaleString()}</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-surface-500 mb-1">
                    <span className="text-xs">{t('dashboard.replyRate')}</span>
                  </div>
                  <p className="text-lg font-semibold text-emerald-600">{page.replyRate || 0}%</p>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between mt-4">
                <div className="flex items-center gap-2">
                  <Badge variant={page.autoReplyEnabled ? 'success' : 'default'}>
                    {page.autoReplyEnabled ? t('common.active') : t('common.inactive')}
                  </Badge>
                  <span className="text-xs text-surface-400">
                    {page.lastActivity ? formatTime(page.lastActivity) : t('common.noData')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm">
                    <Settings className="w-4 h-4" />
                  </Button>
                  <a 
                    href={`https://facebook.com/${page.facebookPageId}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center p-2 rounded-xl hover:bg-surface-100 text-surface-600 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
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
