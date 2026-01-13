import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Toggle, EmptyState, PageHeader, PageSkeleton } from '@/components/ui';
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
      const data = Array.isArray(response.data)
        ? response.data
        : (Array.isArray(response.data?.data) ? response.data.data : []);
      setPages(data);
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

  // Auto-sync if no pages found after initial load (only once)
  const syncAttemptedRef = useRef(false);

  // Create a stable reference to handleSync
  const handleSyncRef = useRef<(() => Promise<void>) | null>(null);

  const handleSync = useCallback(async () => {
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
  }, [token, fbToken, apiUrl, fetchPages]);

  // Keep ref updated
  handleSyncRef.current = handleSync;

  useEffect(() => {
    if (!loading && pages.length === 0 && fbToken && token && !syncing && !syncAttemptedRef.current) {
      // Auto-sync pages from Facebook (only attempt once)
      syncAttemptedRef.current = true;
      handleSyncRef.current?.();
    }
  }, [loading, pages.length, fbToken, token, syncing]);

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
        <PageSkeleton type="grid" />
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
                        <span className={`text-sm font-bold truncate ${page.autoReplyEnabled ? 'text-blue-900' : 'text-surface-500'}`}>Facebook</span>
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

                  <div className={`p-4 rounded-2xl border transition-all ${page.instagramUsername ? (page.instagramAutoReplyEnabled ? 'bg-pink-50/50 border-pink-100 ring-1 ring-pink-100' : 'bg-surface-50 border-surface-100') : 'bg-surface-50 border-surface-50 opacity-60 cursor-not-allowed'}`}>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${page.instagramUsername ? (page.instagramAutoReplyEnabled ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-sm' : 'bg-surface-200 text-surface-400') : 'bg-surface-200 text-surface-300'}`}>
                          <Instagram className="w-4 h-4" />
                        </div>
                        <span className={`text-sm font-bold truncate ${page.instagramUsername ? (page.instagramAutoReplyEnabled ? 'text-pink-900' : 'text-surface-500') : 'text-surface-400'}`}>Instagram</span>
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

      {/* Knowledge Base Modal - Responsive for portrait, landscape, and desktop */}
      {editingPage && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 landscape:items-center sm:p-4 landscape:p-6">
          <div 
            className="bg-white rounded-t-3xl sm:rounded-2xl landscape:rounded-2xl shadow-xl w-full sm:max-w-2xl landscape:max-w-3xl h-[85vh] landscape:h-[90vh] sm:h-auto sm:max-h-[85vh] flex flex-col overflow-hidden pb-safe landscape:pb-2 landscape:px-safe"
          >
            {/* Modal Header - Ultra compact in landscape */}
            <div className="flex items-center justify-between px-4 py-3 landscape:py-2 sm:p-5 border-b border-surface-100 flex-shrink-0">
              <div className="flex items-center gap-3 landscape:gap-2">
                <div className="w-9 h-9 landscape:w-8 landscape:h-8 sm:w-10 sm:h-10 rounded-xl bg-brand-100 flex items-center justify-center">
                  <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 text-brand-600" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-semibold text-surface-900">
                    {t('pages.businessInfo')}
                  </h2>
                  <p className="text-xs sm:text-sm text-surface-500 landscape:hidden">{editingPage.name}</p>
                </div>
              </div>
              <button
                onClick={closeKnowledgeBase}
                className="p-2 rounded-lg hover:bg-surface-100 text-surface-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body - Textarea takes maximum space */}
            <div className="flex-1 flex flex-col min-h-0 p-4 landscape:p-3 landscape:pt-2 sm:p-5">
              {/* Brief hint - hidden in landscape to save vertical space */}
              <p className="text-xs sm:text-sm text-surface-500 mb-3 text-start landscape:hidden">
                {t('pages.businessInfoModalDesc')}
              </p>

              {/* Textarea - THE HERO of the modal */}
              <div className="flex-1 flex flex-col min-h-0">
                <textarea
                  className="flex-1 w-full min-h-[100px] landscape:min-h-0 sm:min-h-[200px] p-4 landscape:p-3 border-2 border-surface-200 rounded-2xl landscape:rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none text-surface-900 text-base leading-relaxed"
                  placeholder={t('pages.writeBusinessInfo')}
                  value={knowledgeBase}
                  onChange={(e) => setKnowledgeBase(e.target.value.slice(0, 2000))}
                  maxLength={2000}
                  dir={language === 'ar' ? 'rtl' : 'ltr'}
                  autoFocus
                />
                
                {/* Character Counter - inline, simplified in landscape */}
                <div className="flex items-center justify-between mt-2 landscape:mt-1 px-1">
                  <span className="text-xs text-surface-400 landscape:hidden">
                    {t('pages.example')}: {language === 'ar' ? 'ساعات العمل، العنوان، المنتجات...' : 'Hours, location, products...'}
                  </span>
                  <span className={`text-xs font-medium landscape:ml-auto ${
                    knowledgeBase.length > 1900
                      ? 'text-red-500'
                      : knowledgeBase.length > 1500
                        ? 'text-amber-500'
                        : 'text-surface-400'
                  }`}>
                    {knowledgeBase.length.toLocaleString()}/2,000
                  </span>
                </div>
              </div>
            </div>

            {/* Modal Footer - Compact, extra compact in landscape */}
            <div className="flex items-center justify-end gap-3 landscape:gap-2 px-4 py-3 landscape:py-2 sm:p-5 border-t border-surface-100 flex-shrink-0 bg-surface-50">
              <Button variant="secondary" size="sm" onClick={closeKnowledgeBase}>
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
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
