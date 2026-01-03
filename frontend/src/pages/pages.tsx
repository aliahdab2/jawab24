import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Toggle, EmptyState, PageHeader, PageSpinner } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useAuthStore } from '@/lib/store';
import {
  FileText,
  RefreshCw,
  ExternalLink,
  BookOpen,
  X,
  Save,
  Check,
  Instagram,
  ChevronRight,
  Clock
} from 'lucide-react';
import axios from 'axios';
import type { Page } from '@jawab24/shared';

export default function PagesPage() {
  const { t, language } = useTranslation();
  const { token, fbToken } = useAuthStore();
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [editingPage, setEditingPage] = useState<Page | null>(null);
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

  const fetchPages = useCallback(async () => {
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
  }, [token, apiUrl]);

  // Fetch pages on load, auto-sync if empty
  useEffect(() => {
    const loadPages = async () => {
      await fetchPages();
    };
    loadPages();
  }, [fetchPages]);

  // Auto-sync if no pages found after initial load
  useEffect(() => {
    if (!loading && pages.length === 0 && fbToken && token && !syncing) {
      // Auto-sync pages from Facebook
      handleSync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, pages.length, fbToken, token]);

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

  const handleInstagramToggle = async (pageId: string, enabled: boolean) => {
    // Optimistic update
    setPages(pages.map(page =>
      page.id === pageId ? { ...page, instagramAutoReplyEnabled: enabled } : page
    ));

    try {
      await axios.patch(`${apiUrl}/pages/${pageId}/instagram-auto-reply`,
        { enabled },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (error) {
      console.error('Failed to toggle Instagram auto-reply:', error);
      // Revert on error
      setPages(pages.map(page =>
        page.id === pageId ? { ...page, instagramAutoReplyEnabled: !enabled } : page
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

  const openKnowledgeBase = (page: Page) => {
    setEditingPage(page);
    setKnowledgeBase(page.knowledgeBase || '');
    setSaved(false);
  };

  const closeKnowledgeBase = () => {
    setEditingPage(null);
    setKnowledgeBase('');
    setSaved(false);
  };

  const saveKnowledgeBase = async () => {
    if (!editingPage || !token) return;

    setSaving(true);
    setSaved(false);
    try {
      await axios.put(`${apiUrl}/pages/${editingPage.id}`,
        { knowledgeBase },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Update local state
      setPages(pages.map(p =>
        p.id === editingPage.id ? { ...p, knowledgeBase } : p
      ));

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Failed to save knowledge base:', error);
    } finally {
      setSaving(false);
    }
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pb-12">
          {pages.map((page, i) => (
            <Card
              key={page.id}
              hover
              className="animate-slide-up border-none shadow-xl shadow-surface-200/50 flex flex-col h-full overflow-hidden"
              style={{ animationDelay: `${i * 0.05}s` } as React.CSSProperties}
            >
              {/* Header with gradient background */}
              <div className="p-6 bg-gradient-to-br from-surface-50 to-white border-b border-surface-100 flex items-start justify-between gap-4">
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

              <div className="p-6 flex-1 flex flex-col gap-6">
                {/* Platform Toggles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className={`p-4 rounded-2xl border transition-all ${page.autoReplyEnabled ? 'bg-blue-50/50 border-blue-100 ring-1 ring-blue-100' : 'bg-surface-50 border-surface-100'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${page.autoReplyEnabled ? 'bg-blue-100 text-blue-600' : 'bg-surface-200 text-surface-400'}`}>
                          <FileText className="w-4 h-4" />
                        </div>
                        <span className={`text-sm font-bold ${page.autoReplyEnabled ? 'text-blue-900' : 'text-surface-500'}`}>Facebook</span>
                      </div>
                      <Toggle
                        enabled={page.autoReplyEnabled ?? false}
                        onChange={(enabled) => handleToggle(page.id, enabled)}
                      />
                    </div>
                    <p className={`text-[10px] font-medium ${page.autoReplyEnabled ? 'text-blue-600' : 'text-surface-400'}`}>
                      {page.autoReplyEnabled ? t('common.enabled') : t('common.disabled')}
                    </p>
                  </div>

                  <div className={`p-4 rounded-2xl border transition-all ${page.instagramUsername ? (page.instagramAutoReplyEnabled ? 'bg-pink-50/50 border-pink-100 ring-1 ring-pink-100' : 'bg-surface-50 border-surface-100') : 'bg-surface-50 border-surface-50 opacity-60 cursor-not-allowed'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${page.instagramUsername ? (page.instagramAutoReplyEnabled ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-sm' : 'bg-surface-200 text-surface-400') : 'bg-surface-200 text-surface-300'}`}>
                          <Instagram className="w-4 h-4" />
                        </div>
                        <span className={`text-sm font-bold ${page.instagramUsername ? (page.instagramAutoReplyEnabled ? 'text-pink-900' : 'text-surface-500') : 'text-surface-400'}`}>Instagram</span>
                      </div>
                      {page.instagramUsername ? (
                        <Toggle
                          enabled={page.instagramAutoReplyEnabled ?? false}
                          onChange={(enabled) => handleInstagramToggle(page.id, enabled)}
                        />
                      ) : (
                        <div className="w-8 h-4 bg-surface-200 rounded-full"></div>
                      )}
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
                <div className="grid grid-cols-3 gap-4 p-4 rounded-2xl bg-surface-50 border border-surface-100">
                  <div className="text-center">
                    <p className="text-[10px] font-bold text-surface-400 uppercase tracking-widest mb-1">{t('comments.title')}</p>
                    <p className="text-xl font-bold text-surface-900">{(page.commentsCount || 0).toLocaleString()}</p>
                  </div>
                  <div className="text-center border-x border-surface-200">
                    <p className="text-[10px] font-bold text-surface-400 uppercase tracking-widest mb-1">{t('dashboard.autoReplies')}</p>
                    <p className="text-xl font-bold text-surface-900">{(page.repliesCount || 0).toLocaleString()}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] font-bold text-surface-400 uppercase tracking-widest mb-1">{t('dashboard.replyRate')}</p>
                    <p className="text-xl font-bold text-emerald-600">{page.replyRate || 0}%</p>
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
                    <ChevronRight className={`w-5 h-5 transition-transform group-hover:translate-x-1 ${page.knowledgeBase ? 'text-brand-500' : 'text-surface-300'} ${language === 'ar' ? 'rotate-180 group-hover:-translate-x-1' : ''}`} />
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
                    {page.lastActivity ? formatTime(page.lastActivity) : t('common.noData')}
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

      {/* Knowledge Base Modal */}
      {editingPage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-surface-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-brand-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-surface-900">
                    {t('pages.businessInfo')}
                  </h2>
                  <p className="text-sm text-surface-500">{editingPage.name}</p>
                </div>
              </div>
              <button
                onClick={closeKnowledgeBase}
                className="p-2 rounded-lg hover:bg-surface-100 text-surface-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <p className="text-sm text-surface-600 mb-4 text-start">
                {t('pages.businessInfoModalDesc')}
              </p>

              <div className="bg-surface-50 rounded-xl p-4 mb-4 text-start">
                <p className="text-sm font-medium text-surface-700 mb-2">
                  {t('pages.example')}
                </p>
                <pre className="text-xs text-surface-500 whitespace-pre-wrap">
                  {t('pages.businessInfoExample' as TranslationKey)}
                </pre>
              </div>

              <textarea
                className="w-full h-64 p-4 border border-surface-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none text-surface-900"
                placeholder={t('pages.writeBusinessInfo')}
                value={knowledgeBase}
                onChange={(e) => setKnowledgeBase(e.target.value.slice(0, 2000))}
                maxLength={2000}
                dir={language === 'ar' ? 'rtl' : 'ltr'}
              />

              {/* Character Counter */}
              <div className="text-sm mt-2 text-end">
                <span className={
                  knowledgeBase.length > 1900
                    ? 'text-red-500 font-medium'
                    : knowledgeBase.length > 1500
                      ? 'text-amber-500'
                      : 'text-surface-400'
                }>
                  {knowledgeBase.length.toLocaleString()}/2,000 {t('pages.characters')}
                </span>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-surface-100">
              <Button variant="secondary" onClick={closeKnowledgeBase}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={saveKnowledgeBase}
                loading={saving}
                icon={saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                variant={saved ? 'secondary' : 'primary'}
              >
                {saved
                  ? t('pages.savedStatus')
                  : t('common.save')
                }
              </Button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
