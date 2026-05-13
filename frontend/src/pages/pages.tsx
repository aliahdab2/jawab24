import React, { useState, useEffect, useCallback, useRef, useMemo, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import clsx from 'clsx';
import { Capacitor } from '@capacitor/core';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Toggle, EmptyState, PageHeader, PageSkeleton, ConfirmationModal } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { useAuthStore } from '@/lib/store';
import { FB_CALLBACK_PATH } from '@/constants/auth';
import { BRAND_ASSETS } from '@/constants/brand';
import {
  FileText,
  RefreshCw,
  BookOpen,
  Instagram,
  ChevronRight,
  Clock,
  ShoppingBag,
  ExternalLink,
  AlertTriangle,
  LinkIcon,
  Info,
  FlaskConical
} from 'lucide-react';
import { toast } from 'sonner';
import { pagesApi, api } from '@/lib/api';
import { iosOr } from '@/lib/iosCopy';
import type { Page } from '@jawab24/shared';
import dynamic from 'next/dynamic';

const KnowledgeBaseModal = dynamic(() => import('@/components/knowledge-base/KnowledgeBaseModal').then(m => ({ default: m.KnowledgeBaseModal })), { ssr: false });
const TestSmartReplyModal = dynamic(() => import('@/components/test-smart-reply/TestSmartReplyModal').then(m => ({ default: m.TestSmartReplyModal })), { ssr: false });
import { captureError } from '@/lib/sentryHelpers';
import type { ApiError } from '@/lib/api-utils';
import { useWorkspaceRole } from '@/hooks';
import { getLocalePath } from '@/utils/locale';
import { formatConnectedDate } from '@/utils/dateUtils';
import { formatRelativeTime } from '@/utils/dateUtils';
import { getPageAvatarUrl, getPageExternalUrl } from '@/utils/pageUrl';
import type { NextPageWithLayout } from './_app';

function RepliesBreakdownTooltip({ page }: { page: Page }) {
  const t = useTranslations('pages');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const panelId = `replies-breakdown-${page.id}`;

  const b = page.breakdown ?? { ai: 0, template: 0, postReply: 0, manual: 0 };
  const rows: Array<{ label: string; value: number }> = [
    { label: t('breakdownAi'), value: b.ai },
    { label: t('breakdownGreetingAway'), value: b.template },
    { label: t('breakdownPostReply'), value: b.postReply },
    { label: t('breakdownManual'), value: b.manual },
  ];
  const hasAny = rows.some((row) => row.value > 0);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!hasAny) return null;

  return (
    <span ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={t('repliesBreakdownTitle')}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center rounded-full text-icon-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <Info className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {open && (
        <span
          id={panelId}
          role="dialog"
          aria-label={t('repliesBreakdownTitle')}
          className="absolute bottom-full end-0 mb-2 px-3 py-2.5 text-xs bg-surface-800 text-white dark:bg-surface-100 dark:text-surface-900 rounded-lg shadow-lg w-[min(14rem,calc(100vw-2rem))] text-start z-20"
        >
          <span className="block font-semibold mb-1.5">{t('repliesBreakdownTitle')}</span>
          {rows.map((row) => (
            <span key={row.label} className="flex justify-between gap-2 py-0.5">
              <span className="opacity-90">{row.label}</span>
              <span className="font-mono font-semibold tabular-nums">{row.value.toLocaleString()}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

const PagesPage: NextPageWithLayout = () => {
  const t = useTranslations('pages');
  const tc = useTranslations('common');
  const tDash = useTranslations('dashboard');
  const tTime = useTranslations('time');
  const tTest = useTranslations('testSmartReply');
  const { language } = useLanguage();
  const router = useRouter();
  const { isAuthenticated, fbToken } = useAuthStore();
  const setActiveWorkspace = useAuthStore((s) => s.setActiveWorkspace);
  const { canEdit, isOwner } = useWorkspaceRole();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [editingPage, setEditingPage] = useState<Page | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [showReconnectDialog, setShowReconnectDialog] = useState(false);
  const [imgError, setImgError] = useState<Record<string, boolean>>({});
  const [testSmartReplyPage, setTestSmartReplyPage] = useState<Page | null>(null);

  // ESC key handled inside KnowledgeBaseModal

  const { data: pagesRaw, isLoading: loading, isError: pagesError, refetch: refetchPages } = useQuery({
    queryKey: ['pages'],
    queryFn: async () => {
      const response = await pagesApi.getAll();
      const data = Array.isArray(response.data)
        ? response.data
        : (Array.isArray(response.data?.data) ? response.data.data : []);
      return data as Page[];
    },
    enabled: isAuthenticated,
  });

  const pages = useMemo(() => {
    const raw = pagesRaw ?? [];
    return [...raw].sort((a, b) => {
      // Priority: active (0), inactive (1), disconnected (2)
      const priority = (p: Page) =>
        p.isConnected === false ? 2
        : (p.autoReplyEnabled || p.instagramAutoReplyEnabled) ? 0
        : 1;
      const diff = priority(a) - priority(b);
      if (diff !== 0) return diff;
      // Within same group, most recent activity first
      return (b.lastActivity || 0) - (a.lastActivity || 0);
    });
  }, [pagesRaw]);

  const setPages = useCallback((updater: Page[] | ((prev: Page[]) => Page[])) => {
    queryClient.setQueryData<Page[]>(['pages'], (old) => {
      const prev = old ?? [];
      return typeof updater === 'function' ? updater(prev) : updater;
    });
  }, [queryClient]);

  const fetchPages = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['pages'] });
  }, [queryClient]);

  // Auto-sync if no pages found after initial load (only once)
  const syncAttemptedRef = useRef(false);

  // Create a stable reference to handleSync
  const handleSyncRef = useRef<(() => Promise<void>) | null>(null);

  const handleSync = useCallback(async () => {
    if (!fbToken) {
      return;
    }

    try {
      setSyncing(true);
      type SyncResponse = {
        takenCount?: number;
        alreadyMemberOf?: { workspaceId: string; workspaceName: string; role: string; pageName: string }[];
      };
      const { data } = await api.post<SyncResponse>('/pages/sync', { accessToken: fbToken });

      // If any of the conflicting pages live in workspaces the user is already
      // a member of, surface a one-tap switch instead of the generic "ask the
      // owner to invite you" warning. We use the first match — typically all
      // conflicts route to the same workspace anyway (a user only has one or
      // two workspace memberships in practice).
      const memberHit = data?.alreadyMemberOf?.[0];
      if (memberHit) {
        toast.warning(t('pageTakenInWorkspace', {
          count: data!.alreadyMemberOf!.length,
          workspaceName: memberHit.workspaceName,
        }), {
          duration: Infinity,
          action: {
            label: t('switchWorkspaceCta', { workspaceName: memberHit.workspaceName }),
            onClick: () => {
              setActiveWorkspace(memberHit.workspaceId);
              fetchPages();
            },
          },
        });
      } else if (data?.takenCount && data.takenCount > 0) {
        toast.warning(t('pageTakenWarning', { count: data.takenCount }), { duration: Infinity });
      }

      // Refresh list
      fetchPages();

    } catch (error) {
      captureError(error, 'Page sync failed', { tags: { page: 'pages', action: 'sync' } });
    } finally {
      setSyncing(false);
    }
  }, [fbToken, fetchPages, t, setActiveWorkspace]);

  // Keep ref updated
  handleSyncRef.current = handleSync;

  const handleReconnectFacebook = useCallback(async () => {
    const fbAppId = process.env.NEXT_PUBLIC_FB_APP_ID;
    if (!fbAppId) {
      toast.error(t('reconnectFailed'));
      return;
    }

    const isMobile = Capacitor.isNativePlatform();

    // Use system browser OAuth on all platforms (same as login flow, RFC 8252).
    // The native Facebook SDK (@capacitor-community/facebook-login) is unreliable
    // for reconnect — system browser works consistently on Android + iOS + web.
    try {
      const normalizedOrigin = BRAND_ASSETS.urls.base;
      const localePath = getLocalePath(language);
      // Mobile: always use canonical origin (Capacitor serves from http://localhost)
      // Web dev: use window.location.origin for localhost
      const origin = isMobile ? normalizedOrigin : (window.location.hostname === 'localhost' ? window.location.origin : normalizedOrigin);
      const redirectUri = encodeURIComponent(`${origin}${localePath}${FB_CALLBACK_PATH}`);
      const scope = encodeURIComponent('email,pages_show_list,pages_read_engagement,pages_read_user_content,pages_manage_metadata,pages_manage_engagement,pages_messaging,instagram_basic,instagram_manage_messages,instagram_manage_comments');
      const state = encodeURIComponent(`/pages|${isMobile ? 'mobile' : 'web'}|${language}|reconnect`);
      const oauthUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${fbAppId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${state}&display=page&auth_type=rerequest`;

      if (isMobile) {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url: oauthUrl });
      } else {
        window.location.href = oauthUrl;
      }
    } catch (error) {
      captureError(error, 'Reconnect failed', { tags: { page: 'pages', action: 'reconnect' } });
      toast.error(t('reconnectFailed'));
    }
  }, [language, t]);

  useEffect(() => {
    if (!loading && pages.length === 0 && fbToken && isAuthenticated && isOwner && !syncing && !syncAttemptedRef.current) {
      // Auto-sync pages from Facebook (owner only — POST /pages/sync requires owner role)
      syncAttemptedRef.current = true;
      handleSyncRef.current?.();
    }
  }, [loading, pages.length, fbToken, isAuthenticated, isOwner, syncing]);

  // Auto-open KB modal when navigated with ?openKb=true (e.g. from dashboard nudge)
  const openKbHandledRef = useRef(false);
  useEffect(() => {
    if (openKbHandledRef.current || !router.isReady || loading || pages.length === 0) return;
    if (router.query.openKb !== 'true') return;

    openKbHandledRef.current = true;
    // Find the first page with thin KB (matches the dashboard nudge logic)
    const thinKbPage = pages.find(p => (p.knowledgeBase || '').length < 200);
    const target = thinKbPage ?? pages[0];
    setEditingPage(target);
    setSaved(false);

    // Clean up the URL without triggering a re-render
    router.replace('/pages', undefined, { shallow: true });
  }, [router.isReady, router.query.openKb, loading, pages, router]);

  const handleToggle = async (pageId: string, enabled: boolean) => {
    setPages(prev => prev.map(page =>
      page.id === pageId ? { ...page, autoReplyEnabled: enabled } : page
    ));

    try {
      await pagesApi.toggle(pageId, enabled);
    } catch (error) {
      setPages(prev => prev.map(page =>
        page.id === pageId ? { ...page, autoReplyEnabled: !enabled } : page
      ));
      const axiosErr = error as { response?: { status?: number; data?: { code?: string } } };
      if (axiosErr.response?.data?.code === 'PAGE_DISCONNECTED') {
        toast.error(t('reconnectRequired'));
      } else if (axiosErr.response?.status === 403 && axiosErr.response?.data?.code === 'PAGE_LIMIT_REACHED') {
        toast.error(t(iosOr('pageLimitReachedIOS', 'pageLimitReached')));
      } else {
        captureError(error, 'Failed to toggle auto-reply', { tags: { page: 'pages', action: 'toggle' } });
        toast.error(tc('error'));
      }
    }
  };

  const handleInstagramToggle = async (pageId: string, enabled: boolean) => {
    setPages(prev => prev.map(page =>
      page.id === pageId ? { ...page, instagramAutoReplyEnabled: enabled } : page
    ));

    try {
      await api.patch(`/pages/${pageId}/instagram-auto-reply`, { enabled });
    } catch (error) {
      setPages(prev => prev.map(page =>
        page.id === pageId ? { ...page, instagramAutoReplyEnabled: !enabled } : page
      ));
      const axiosErr = error as { response?: { status?: number; data?: { code?: string } } };
      if (axiosErr.response?.data?.code === 'PAGE_DISCONNECTED') {
        toast.error(t('reconnectRequired'));
      } else if (axiosErr.response?.status === 403 && axiosErr.response?.data?.code === 'PAGE_LIMIT_REACHED') {
        toast.error(t(iosOr('pageLimitReachedIOS', 'pageLimitReached')));
      } else {
        captureError(error, 'Failed to toggle Instagram auto-reply', { tags: { page: 'pages', action: 'instagram-toggle' } });
        toast.error(tc('error'));
      }
    }
  };

  const formatTime = (epochMs: number) => {
    if (!epochMs) return tc('noData');
    return formatRelativeTime(new Date(epochMs), tTime);
  };

  const formatDate = (dateStr: string | null) => formatConnectedDate(dateStr, t, tc('noData'));

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

  if (pagesError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        iconColorClass="text-red-500"
        iconBgClass="bg-red-50 dark:bg-red-900/20"
        title={tc('error')}
        description={t('loadFailed')}
        action={
          <Button onClick={() => refetchPages()} variant="ghost">
            {tc('tryAgain')}
          </Button>
        }
      />
    );
  }

  return (
    <>
      {/* Header */}
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={isOwner
          ? <Button
              onClick={() => setShowConnectDialog(true)}
              disabled={syncing}
              icon={<RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />}
            >
              {syncing ? t('syncing') : t('connectPage')}
            </Button>
          : undefined
        }
      />

      {/* Pages Grid */}
      {pages.length > 0 ? (
        <div className="flex flex-col gap-8 pb-12 landscape:px-6">
          {(() => {
            const activePages = pages.filter(p => p.isConnected !== false && (p.autoReplyEnabled || p.instagramAutoReplyEnabled));
            const inactivePages = pages.filter(p => p.isConnected !== false && !p.autoReplyEnabled && !p.instagramAutoReplyEnabled);
            const disconnectedPages = pages.filter(p => p.isConnected === false);
            const hasMultipleGroups = [activePages, inactivePages, disconnectedPages].filter(g => g.length > 0).length > 1;
            let globalIndex = 0;

            const renderSection = (sectionPages: Page[], label: string, dimmed: boolean) => {
              if (sectionPages.length === 0) return null;
              const section = (
                <div key={label}>
                  {hasMultipleGroups && (
                    <div className="flex items-center gap-3 mb-4">
                      <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{label}</span>
                      <span className="text-xs font-bold text-subtle bg-muted px-2 py-0.5 rounded-full">{sectionPages.length}</span>
                      <div className="flex-1 h-px bg-theme-border" />
                    </div>
                  )}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {sectionPages.map((page) => {
                      const i = globalIndex++;
                      return (
                        <Card
                          key={page.id}
                          id={`page-${page.id}`}
                          hover
                          className={clsx(
                            'animate-slide-up border-none shadow-2xl shadow-surface-200/50 flex flex-col h-full overflow-hidden transition-all duration-300 hover:-translate-y-1',
                            dimmed && 'opacity-75 hover:opacity-100'
                          )}
                          style={{ animationDelay: `${i * 0.05}s` } as React.CSSProperties}
                        >
              {/* Header with gradient background */}
              <div className="p-4 sm:p-6 bg-gradient-to-br from-background to-card border-b border-theme-border flex items-start gap-4">
                {/* Page avatar */}
                <div className="w-14 h-14 rounded-2xl flex-shrink-0 shadow-lg shadow-brand-100 overflow-hidden bg-brand-600 flex items-center justify-center">
                  {getPageAvatarUrl(page) && !imgError[page.id] ? (
                    <img
                      src={getPageAvatarUrl(page)!}
                      alt={page.name}
                      className="w-full h-full object-cover"
                      onError={() => setImgError(prev => ({ ...prev, [page.id]: true }))}
                    />
                  ) : (
                    <FileText className="w-7 h-7 text-white" />
                  )}
                </div>

                {/* Page info */}
                <div className="min-w-0 flex-1 text-start">
                  <h3 className="text-lg font-bold text-foreground line-clamp-2" title={page.name}>{page.name}</h3>
                  {/* Empty KB indicator — clickable chip for pages without business info and no e-commerce */}
                  {!page.knowledgeBase && !page.ecommerceStoreId && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openKnowledgeBase(page); }}
                      className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" aria-hidden="true" />
                      {t('addInfo')}
                    </button>
                  )}
                </div>

                {/* External link to Facebook page — only for Facebook-connected pages */}
                {getPageExternalUrl(page) && (
                  <a
                    href={getPageExternalUrl(page)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground hover:bg-surface-200 hover:text-muted-foreground transition-colors flex-shrink-0"
                    aria-label={`${tc('openOn')} Facebook`}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>

              {/* Disconnected Banner */}
              {page.isConnected === false && (
                <div className="mx-4 sm:mx-6 mt-4 sm:mt-6 p-3 rounded-xl alert-warning border flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold">{t('reconnectRequired')}</p>
                      <p className="text-xs mt-0.5">{t('reconnectDescription')}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setShowReconnectDialog(true)}
                    disabled={syncing}
                    className="w-full"
                    icon={<LinkIcon className="w-3.5 h-3.5" />}
                  >
                    {t('reconnect')}
                  </Button>
                </div>
              )}

              <div className={clsx('p-4 sm:p-6 flex-1 flex flex-col gap-6', page.isConnected === false && 'opacity-60 pointer-events-none')}>
                {/* Platform Toggles */}
                <div className="flex flex-col gap-3">
                  {/* Facebook row */}
                  <div className={`flex items-center justify-between gap-4 px-4 py-3 rounded-2xl border transition-all ${page.autoReplyEnabled ? 'bg-blue-50/50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800' : 'bg-background border-theme-border'}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${page.autoReplyEnabled ? 'icon-bg-blue' : 'bg-surface-200 text-icon-muted'}`}>
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm font-bold ${page.autoReplyEnabled ? 'text-blue-900 dark:text-blue-300' : 'text-muted-foreground'}`}>Facebook</p>
                        <p className={`text-xs font-medium ${page.autoReplyEnabled ? 'text-blue-500 dark:text-blue-400' : 'text-muted-foreground'}`}>
                          {page.autoReplyEnabled ? tc('enabled') : tc('disabled')}
                        </p>
                      </div>
                    </div>
                    <span title={!canEdit ? tc('viewOnlyHint') : undefined}>
                      <Toggle
                        enabled={page.autoReplyEnabled ?? false}
                        onChange={(enabled) => handleToggle(page.id, enabled)}
                        disabled={!canEdit}
                        aria-label={`${t('autoReply')} Facebook - ${page.name}`}
                      />
                    </span>
                  </div>

                  {/* Instagram row */}
                  <div
                    className={clsx(
                      'flex items-center justify-between gap-4 px-4 py-3 rounded-2xl border transition-all',
                      page.instagramUsername
                        ? (page.instagramAutoReplyEnabled ? 'bg-pink-50/50 dark:bg-pink-950/30 border-pink-200 dark:border-pink-800' : 'bg-background border-theme-border')
                        : 'bg-background border-theme-border border-dashed'
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={clsx(
                        'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                        page.instagramUsername
                          ? (page.instagramAutoReplyEnabled ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-sm' : 'bg-surface-200 text-icon-muted')
                          : 'bg-surface-100 text-icon-muted'
                      )}>
                        <Instagram className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className={clsx(
                          'text-sm font-bold',
                          page.instagramUsername
                            ? (page.instagramAutoReplyEnabled ? 'text-pink-900 dark:text-pink-300' : 'text-muted-foreground')
                            : 'text-muted-foreground'
                        )}>{t('platformInstagram')}</p>
                        <div className="flex items-center gap-1">
                          <p className={clsx(
                            'text-xs font-medium',
                            page.instagramUsername
                              ? (page.instagramAutoReplyEnabled ? 'text-pink-500 dark:text-pink-400' : 'text-muted-foreground')
                              : 'text-muted-foreground'
                          )}>
                            {page.instagramUsername
                              ? `@${page.instagramUsername}`
                              : t('instagramNotConnected')}
                          </p>
                          {!page.instagramUsername && (
                            <span className="relative group">
                              <Info className="w-3.5 h-3.5 text-icon-muted cursor-help" aria-label={t('instagramTooltip')} />
                              <span className="absolute bottom-full start-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-xs text-white bg-surface-800 dark:bg-surface-200 dark:text-surface-900 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-56 text-center z-10">
                                {t('instagramTooltip')}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {page.instagramUsername && (
                      <span title={!canEdit ? tc('viewOnlyHint') : undefined}>
                        <Toggle
                          enabled={page.instagramAutoReplyEnabled ?? false}
                          onChange={(enabled) => handleInstagramToggle(page.id, enabled)}
                          disabled={!canEdit}
                          aria-label={`${t('autoReply')} Instagram - ${page.name}`}
                        />
                      </span>
                    )}
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-3 gap-3 px-1 py-1 rounded-2xl bg-background border border-theme-border">
                  <div className="py-3 text-center">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5">{t('totalIncoming')}</p>
                    <p className="text-lg font-bold text-foreground leading-none">{(page.commentsCount || 0).toLocaleString()}</p>
                  </div>
                  <div className="py-3 text-center border-x border-theme-border">
                    <div className="flex items-center justify-center gap-1 mb-1.5">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{t('repliesSent')}</p>
                      <RepliesBreakdownTooltip page={page} />
                    </div>
                    <p className="text-lg font-bold text-foreground leading-none">{(page.repliesCount || 0).toLocaleString()}</p>
                  </div>
                  <div className="py-3 text-center">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5">{tDash('replyRate')}</p>
                    <p className="text-lg font-bold text-emerald-600 leading-none">{page.replyRate || 0}%</p>
                  </div>
                </div>

                {/* E-commerce Connected Badge — hidden on mobile when no store, invisible on desktop to keep card heights equal */}
                <div
                  className={`w-full flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl mb-3 bg-gradient-to-br from-[#96BF48] to-[#5A8A1F] shadow-md ${page.ecommerceStoreId ? 'visible' : 'hidden lg:flex lg:invisible'}`}
                  aria-hidden={!page.ecommerceStoreId}
                >
                  <ShoppingBag className="w-4 h-4 text-white" aria-hidden="true" />
                  <span className="text-white text-[12px] font-semibold">{t('shopifyConnectedBadge')}</span>
                </div>

                {/* Knowledge Base CTA - More prominent */}
                <button
                  onClick={() => openKnowledgeBase(page)}
                  className={`group relative overflow-hidden w-full p-4 rounded-2xl border-2 transition-all duration-300 ${page.knowledgeBase
                    ? 'border-brand-500 bg-brand-50/30 dark:bg-brand-950/20'
                    : 'border-dashed border-surface-300 bg-card hover:border-brand-400 hover:bg-brand-50/10 dark:hover:bg-brand-950/10'
                    }`}
                >
                  <div className="relative z-10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${page.knowledgeBase ? 'bg-brand-500 text-white shadow-lg shadow-brand-100' : 'bg-muted text-muted-foreground group-hover:bg-brand-100 group-hover:text-brand-600 dark:group-hover:bg-brand-900/50 dark:group-hover:text-brand-400'}`}>
                        <BookOpen className="w-5 h-5" />
                      </div>
                      <div className="text-start">
                        <p className={`text-sm font-bold ${page.knowledgeBase ? 'text-brand-900 dark:text-brand-300' : 'text-foreground/70'}`}>
                          {page.knowledgeBase
                            ? t('businessInfoActive')
                            : t('addBusinessInfo')
                          }
                        </p>
                        <p className="text-xs font-medium text-muted-foreground mt-0.5">
                          {page.knowledgeBase
                            ? t('clickToEdit')
                            : t('improveAIQuality')
                          }
                        </p>
                      </div>
                    </div>
                    <ChevronRight className={`w-5 h-5 transition-transform ${page.knowledgeBase ? 'text-brand-500' : 'text-icon-muted'} rtl:rotate-180 rtl:group-hover:-translate-x-1 ltr:group-hover:translate-x-1`} />
                  </div>
                </button>
              </div>

              {/* Test Smart Reply */}
              <div className="px-6 landscape:px-4 pb-4 landscape:pb-3">
                <button
                  onClick={() => setTestSmartReplyPage(page)}
                  className="group w-full p-3 landscape:p-2.5 rounded-xl border border-theme-border bg-card hover:bg-brand-50/10 dark:hover:bg-brand-900/10 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-muted text-muted-foreground group-hover:bg-brand-100 group-hover:text-brand-600 dark:group-hover:bg-brand-900/50 dark:group-hover:text-brand-400 transition-colors">
                        <FlaskConical className="w-5 h-5" />
                      </div>
                      <div className="text-start">
                        <p className="text-sm font-bold text-foreground/70">{tTest('title')}</p>
                        <p className="text-xs font-medium text-muted-foreground mt-0.5">{tTest('description')}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-icon-muted rtl:rotate-180 rtl:group-hover:-translate-x-1 ltr:group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>
              </div>

              {/* Status Footer */}
              <div className="px-6 py-4 bg-background/50 border-t border-theme-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={clsx(
                    'w-2 h-2 rounded-full',
                    page.isConnected === false
                      ? 'bg-amber-500'
                      : (page.autoReplyEnabled || page.instagramAutoReplyEnabled) ? 'bg-emerald-500 animate-pulse' : 'bg-surface-300'
                  )}></div>
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    {page.isConnected === false
                      ? t('disconnected')
                      : (page.autoReplyEnabled || page.instagramAutoReplyEnabled) ? tc('active') : tc('inactive')}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  <span
                    className="text-xs font-bold uppercase tracking-tighter"
                    title={page.lastActivity ? t('lastActivity') : ''}
                  >
                    {page.lastActivity ? formatTime(page.lastActivity) : formatDate(page.createdAt as unknown as string)}
                  </span>
                </div>
              </div>
            </Card>
                      );
                    })}
                  </div>
                </div>
              );
              return section;
            };

            return (
              <>
                {renderSection(activePages, t('sectionActive'), false)}
                {renderSection(inactivePages, t('sectionInactive'), true)}
                {renderSection(disconnectedPages, t('sectionDisconnected'), true)}
              </>
            );
          })()}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={FileText}
            title={t('noPages')}
            description={t('noPagesDesc')}
            action={isOwner
              ? <Button onClick={() => setShowConnectDialog(true)}>
                  {t('connectPage')}
                </Button>
              : undefined
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
              const apiError = error as ApiError;
              if (apiError.response?.status === 403 && apiError.response?.data?.code === 'WORKSPACE_ACCESS_DENIED') {
                toast.error(t('saveFailedAccessRevoked'));
              } else {
                captureError(error, 'Failed to save knowledge base', { tags: { page: 'pages', action: 'save-kb' } });
                toast.error(t('saveFailed'));
              }
            } finally {
              setSaving(false);
            }
          }}
          saving={saving}
          saved={saved}
        />
      )}

      {/* Test Smart Reply Modal */}
      {testSmartReplyPage && (
        <TestSmartReplyModal page={testSmartReplyPage} onClose={() => setTestSmartReplyPage(null)} />
      )}

      {/* Connect Page confirmation dialog */}
      <ConfirmationModal
        isOpen={showConnectDialog}
        onClose={() => setShowConnectDialog(false)}
        onConfirm={() => {
          setShowConnectDialog(false);
          handleReconnectFacebook();
        }}
        title={t('connectDialogTitle')}
        message={t('connectDialogBody')}
        confirmText={t('continueToFacebook')}
        variant="info"
      />

      {/* Reconnect Page confirmation dialog */}
      <ConfirmationModal
        isOpen={showReconnectDialog}
        onClose={() => setShowReconnectDialog(false)}
        onConfirm={() => {
          setShowReconnectDialog(false);
          handleReconnectFacebook();
        }}
        title={t('reconnectDialogTitle')}
        message={t('reconnectDialogBody')}
        confirmText={t('continueToFacebook')}
        variant="info"
      />
    </>
  );
};

// Persistent layout - prevents Sidebar remounting on navigation
PagesPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Pages">{page}</DashboardLayout>
);

export default PagesPage;

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.pages]);
