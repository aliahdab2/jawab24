import React, { useState, useEffect, useCallback, useRef, type ReactElement } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Toggle, EmptyState, PageHeader, PageSkeleton } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useAuthStore } from '@/lib/store';
import {
  FileText,
  RefreshCw,
  ExternalLink,
  BookOpen,
  Instagram,
  ChevronRight,
  Clock
} from 'lucide-react';
import { pagesApi, api } from '@/lib/api';
import type { Page } from '@jawab24/shared';
import { KnowledgeBaseModal } from '@/components/knowledge-base/KnowledgeBaseModal';
import type { NextPageWithLayout } from './_app';

const PagesPage: NextPageWithLayout = () => {
  const { t } = useTranslation();
  const { isAuthenticated, fbToken } = useAuthStore();
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [editingPage, setEditingPage] = useState<Page | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // ESC key handled inside KnowledgeBaseModal

  const fetchPages = useCallback(async () => {
    try {
      setLoading(true);
      const response = await pagesApi.getAll();
      const data = Array.isArray(response.data)
        ? response.data
        : (Array.isArray(response.data?.data) ? response.data.data : []);
      setPages(data);
    } catch (error) {
      console.error('Failed to fetch pages:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch pages on load - use isAuthenticated instead of token (web uses cookies)
  useEffect(() => {
    if (isAuthenticated) {
      fetchPages();
    }
  }, [isAuthenticated, fetchPages]);

  // Auto-sync if no pages found after initial load (only once)
  const syncAttemptedRef = useRef(false);

  // Create a stable reference to handleSync
  const handleSyncRef = useRef<(() => Promise<void>) | null>(null);

  const handleSync = useCallback(async () => {
    if (!fbToken) {
      console.error('No FB token available for sync');
      return;
    }

    try {
      setSyncing(true);
      // Call sync endpoint with user's FB token
      await api.post('/pages/sync', { accessToken: fbToken });

      // Refresh list
      await fetchPages();

    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setSyncing(false);
    }
  }, [fbToken, fetchPages]);

  // Keep ref updated
  handleSyncRef.current = handleSync;

  useEffect(() => {
    if (!loading && pages.length === 0 && fbToken && isAuthenticated && !syncing && !syncAttemptedRef.current) {
      // Auto-sync pages from Facebook (only attempt once)
      syncAttemptedRef.current = true;
      handleSyncRef.current?.();
    }
  }, [loading, pages.length, fbToken, isAuthenticated, syncing]);

  const handleToggle = async (pageId: string, enabled: boolean) => {
    // Optimistic update
    setPages(pages.map(page =>
      page.id === pageId ? { ...page, autoReplyEnabled: enabled } : page
    ));

    try {
      await pagesApi.toggle(pageId, enabled);
    } catch (error) {
      console.error('Failed to toggle auto-reply:', error);
      // Revert on error
      setPages(pages.map(page =>
        page.id === pageId ? { ...page, autoReplyEnabled: !enabled } : page
      ));
    }
  };

  const handleInstagramToggle = async (pageId: string, enabled: boolean) => {
    // Optimistic update
    setPages(pages.map(page =>
      page.id === pageId ? { ...page, instagramAutoReplyEnabled: enabled } : page
    ));

    try {
      await api.patch(`/pages/${pageId}/instagram-auto-reply`, { enabled });
    } catch (error) {
      console.error('Failed to toggle Instagram auto-reply:', error);
      // Revert on error
      setPages(pages.map(page =>
        page.id === pageId ? { ...page, instagramAutoReplyEnabled: !enabled } : page
      ));
    }
  };

  const formatTime = (epochMs: number) => {
    if (!epochMs) return t('common.noData');
    const diffMs = Date.now() - epochMs;
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return t('time.justNow' as TranslationKey);
    if (minutes < 60) return t('time.minutesAgo').replace('{count}', String(minutes));
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('time.hoursAgo').replace('{count}', String(hours));
    const days = Math.floor(hours / 24);
    return t('time.daysAgo' as TranslationKey).replace('{count}', String(days));
  };

  const formatConnectedDate = (dateStr: string | null) => {
    if (!dateStr) return t('common.noData');
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diffMs / 86400000);
    if (days < 1) return t('pages.connectedToday' as TranslationKey);
    return t('pages.connectedAgo' as TranslationKey).replace('{count}', String(days));
  };

  const openKnowledgeBase = (page: Page) => {
    setEditingPage(page);
    setSaved(false);
  };

  const closeKnowledgeBase = () => {
    setEditingPage(null);
    setSaved(false);
  };

  if (loading && pages.length === 0) {
    return <PageSkeleton type="grid" />;
  }

  return (
    <>
      {/* Header */}
      <PageHeader
        title={t('pages.title')}
        description={t('pages.description')}
        action={
          <Button
            onClick={handleSync}
            disabled={syncing}
            icon={<RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />}
          >
            {syncing ? t('pages.syncing' as TranslationKey) : t('pages.connectPage')}
          </Button>
        }
      />

      {/* Pages Grid */}
      {pages.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pb-12">
          {pages.map((page, i) => (
            <Card
              key={page.id}
              hover
              className="animate-slide-up border-none shadow-xl shadow-surface-200/50 flex flex-col h-full overflow-hidden transition-all duration-300 hover:-translate-y-1"
              style={{ animationDelay: `${i * 0.05}s` } as React.CSSProperties}
            >
              {/* Header with gradient background */}
              <div className="p-4 sm:p-6 bg-gradient-to-br from-surface-50 to-white border-b border-surface-100 flex items-start justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className="w-14 h-14 rounded-2xl bg-brand-600 text-white flex items-center justify-center flex-shrink-0 shadow-lg shadow-brand-100">
                    <FileText className="w-7 h-7" />
                  </div>
                  <div className="text-start min-w-0">
                    <h3 className="text-lg font-bold text-surface-900 truncate">{page.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 text-[10px] font-bold uppercase tracking-wider border border-blue-100">
                        Facebook
                      </div>
                      {page.instagramUsername && (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-pink-50 text-pink-600 text-[10px] font-bold uppercase tracking-wider border border-pink-100">
                          <Instagram className="w-3 h-3" />
                          @{page.instagramUsername}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <a
                    href={`https://facebook.com/${page.facebookPageId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded-xl bg-white border border-surface-200 text-surface-400 hover:text-blue-600 hover:border-blue-200 hover:shadow-sm transition-all"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>

              <div className="p-4 sm:p-6 flex-1 flex flex-col gap-6">
                {/* Platform Toggles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className={`p-4 rounded-2xl border transition-all ${page.autoReplyEnabled ? 'bg-blue-50/50 border-blue-100 ring-1 ring-blue-100' : 'bg-surface-50 border-surface-100'}`}>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${page.autoReplyEnabled ? 'bg-blue-100 text-blue-600' : 'bg-surface-200 text-surface-400'}`}>
                          <FileText className="w-4 h-4" />
                        </div>
                        <span className={`text-sm font-bold ${page.autoReplyEnabled ? 'text-blue-900' : 'text-surface-500'}`}>Facebook</span>
                      </div>
                      <div className="flex-shrink-0">
                        <Toggle
                          enabled={page.autoReplyEnabled ?? false}
                          onChange={(enabled) => handleToggle(page.id, enabled)}
                        />
                      </div>
                    </div>
                    <p className={`text-[10px] font-medium ${page.autoReplyEnabled ? 'text-blue-600' : 'text-surface-400'}`}>
                      {page.autoReplyEnabled ? t('common.enabled') : t('common.disabled')}
                    </p>
                  </div>

                  <div
                    className={`p-4 rounded-2xl border transition-all ${page.instagramUsername ? (page.instagramAutoReplyEnabled ? 'bg-pink-50/50 border-pink-100 ring-1 ring-pink-100' : 'bg-surface-50 border-surface-100') : 'bg-surface-50 border-surface-50 opacity-60 cursor-not-allowed'}`}
                    {...(!page.instagramUsername && { title: t('pages.instagramTooltip' as TranslationKey) })}
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${page.instagramUsername ? (page.instagramAutoReplyEnabled ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-sm' : 'bg-surface-200 text-surface-400') : 'bg-surface-200 text-surface-300'}`}>
                          <Instagram className="w-4 h-4" />
                        </div>
                        <span className={`text-sm font-bold ${page.instagramUsername ? (page.instagramAutoReplyEnabled ? 'text-pink-900' : 'text-surface-500') : 'text-surface-400'}`}>Instagram</span>
                      </div>
                      <div className="flex-shrink-0">
                        {page.instagramUsername ? (
                          <Toggle
                            enabled={page.instagramAutoReplyEnabled ?? false}
                            onChange={(enabled) => handleInstagramToggle(page.id, enabled)}
                          />
                        ) : (
                          <div className="w-8 h-4 bg-surface-200 rounded-full"></div>
                        )}
                      </div>
                    </div>
                    <p className={`text-[10px] font-medium ${page.instagramUsername ? (page.instagramAutoReplyEnabled ? 'text-pink-600' : 'text-surface-400') : 'text-surface-300'}`}>
                      {page.instagramUsername
                        ? (page.instagramAutoReplyEnabled ? t('common.enabled') : t('common.disabled'))
                        : t('pages.notLinked')

                      }
                    </p>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-3 gap-2 px-1 py-1 rounded-2xl bg-surface-50 border border-surface-100">
                  <div className="py-3 text-center">
                    <p className="text-[9px] font-bold text-surface-400 uppercase tracking-widest mb-1.5 opacity-70">{t('comments.title')}</p>
                    <p className="text-lg font-bold text-surface-900 leading-none">{(page.commentsCount || 0).toLocaleString()}</p>
                  </div>
                  <div className="py-3 text-center border-x border-surface-200">
                    <p className="text-[9px] font-bold text-surface-400 uppercase tracking-widest mb-1.5 opacity-70">{t('dashboard.autoReplies')}</p>
                    <p className="text-lg font-bold text-surface-900 leading-none">{(page.repliesCount || 0).toLocaleString()}</p>
                  </div>
                  <div className="py-3 text-center">
                    <p className="text-[9px] font-bold text-surface-400 uppercase tracking-widest mb-1.5 opacity-70">{t('dashboard.replyRate')}</p>
                    <p className="text-lg font-bold text-emerald-600 leading-none">{page.replyRate || 0}%</p>
                  </div>
                </div>

                {/* Knowledge Base CTA - More prominent */}
                <button
                  onClick={() => openKnowledgeBase(page)}
                  className={`group relative overflow-hidden w-full p-4 rounded-2xl border-2 transition-all duration-300 ${page.knowledgeBase
                    ? 'border-brand-500 bg-brand-50/30'
                    : 'border-dashed border-surface-300 bg-white hover:border-brand-400 hover:bg-brand-50/10'
                    }`}
                >
                  <div className="relative z-10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${page.knowledgeBase ? 'bg-brand-500 text-white shadow-lg shadow-brand-100' : 'bg-surface-100 text-surface-400 group-hover:bg-brand-100 group-hover:text-brand-600'}`}>
                        <BookOpen className="w-5 h-5" />
                      </div>
                      <div className="text-start">
                        <p className={`text-sm font-bold ${page.knowledgeBase ? 'text-brand-900' : 'text-surface-700'}`}>
                          {page.knowledgeBase
                            ? t('pages.businessInfoActive')
                            : t('pages.addBusinessInfo')
                          }
                        </p>
                        <p className="text-[10px] font-medium text-surface-500 uppercase tracking-tight mt-0.5">
                          {page.knowledgeBase
                            ? t('pages.clickToEdit')
                            : t('pages.improveAIQuality')
                          }
                        </p>
                      </div>
                    </div>
                    <ChevronRight className={`w-5 h-5 transition-transform ${page.knowledgeBase ? 'text-brand-500' : 'text-surface-300'} rtl:rotate-180 rtl:group-hover:-translate-x-1 ltr:group-hover:translate-x-1`} />
                  </div>
                </button>
              </div>

              {/* Status Footer */}
              <div className="px-6 py-4 bg-surface-50/50 border-t border-surface-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${(page.autoReplyEnabled || page.instagramAutoReplyEnabled) ? 'bg-emerald-500 animate-pulse' : 'bg-surface-300'}`}></div>
                  <span className="text-xs font-bold text-surface-500 uppercase tracking-widest">
                    {(page.autoReplyEnabled || page.instagramAutoReplyEnabled) ? t('common.active') : t('common.inactive')}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-surface-400">
                  <Clock className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-tighter">
                    {page.lastActivity ? formatTime(page.lastActivity) : formatConnectedDate(page.createdAt as unknown as string)}
                  </span>
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

      {/* Knowledge Base Modal - Structured sections */}
      {editingPage && (
        <KnowledgeBaseModal
          page={editingPage}
          onClose={closeKnowledgeBase}
          onSave={async (text) => {
            setSaving(true);
            setSaved(false);
            try {
              await api.put(`/pages/${editingPage.id}`, { knowledgeBase: text });
              setPages(pages.map(p =>
                p.id === editingPage.id ? { ...p, knowledgeBase: text } : p
              ));
              setSaved(true);
              setTimeout(() => setSaved(false), 3000);
            } catch (error) {
              console.error('Failed to save knowledge base:', error);
            } finally {
              setSaving(false);
            }
          }}
          saving={saving}
          saved={saved}
        />
      )}
    </>
  );
};

// Persistent layout - prevents Sidebar remounting on navigation
PagesPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Pages">{page}</DashboardLayout>
);

export default PagesPage;
