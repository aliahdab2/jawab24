import React, { useState, useEffect, useCallback, type ReactElement, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Input, PageHeader, PageSkeleton, EmptyState } from '@/components/ui';
import dynamic from 'next/dynamic';
import { CommentCard } from '@/components/comments';

const CommentDetailModal = dynamic(() => import('@/components/comments').then(m => ({ default: m.CommentDetailModal })), { ssr: false });
import { useAuthStore, useUIStore } from '@/lib/store';
import { useDebounce } from '@/hooks';
import { commentsApi, pagesApi, type CommentsQueryParams } from '@/lib/api';
import {
  MessageSquare,
  Search,
  X,
  Check,
  CheckCircle,
  Sparkles,
  Download,
  AlertTriangle,
  ExternalLink,
  MoreVertical,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { format } from 'date-fns';
import { downloadCSV, formatDateForExport } from '@/utils/csvExport';
import type { Comment, Page } from '@jawab24/shared';
import { captureError } from '@/lib/sentryHelpers';
import { getPageExternalUrl } from '@/utils/pageUrl';
import type { NextPageWithLayout } from './_app';
import { useEscapeKey } from '@/hooks/useEscapeKey';

type FilterType = 'needs_action' | 'all' | 'auto_replied' | 'handled';

const VALID_FILTERS: FilterType[] = ['needs_action', 'all', 'auto_replied', 'handled'];

// Map legacy/dashboard filter values to valid filter types
const FILTER_ALIASES: Record<string, FilterType> = {
  pending: 'needs_action',
  flagged: 'needs_action',
  replied_today: 'auto_replied',
};

function resolveFilter(value: string | undefined): FilterType {
  if (!value) return 'needs_action';
  if (VALID_FILTERS.includes(value as FilterType)) return value as FilterType;
  return FILTER_ALIASES[value] || 'needs_action';
}

// Map frontend filters to API params
function getApiParams(filter: FilterType): CommentsQueryParams {
  switch (filter) {
    case 'needs_action':
      return { actionRequired: true };
    case 'auto_replied':
      return { replied: true };
    case 'handled':
      return { resolved: true };
    case 'all':
    default:
      return {};
  }
}


const COMMENTS_PER_PAGE = 50;

const CommentsPage: NextPageWithLayout = () => {
  const t = useTranslations('comments');
  const tc = useTranslations('common');
  const tErr = useTranslations('errors');
  const tExport = useTranslations('export');
  const { language } = useLanguage();
  const { isAuthenticated } = useAuthStore();
  const resetUnreadComments = useUIStore((s) => s.resetUnreadComments);
  const router = useRouter();

  // Reset unread badge when visiting comments page
  useEffect(() => { resetUnreadComments(); }, [resetUnreadComments]);

  const [isTransitioning, setIsTransitioning] = useState(false);

  const [filter, setFilter] = useState<FilterType>('needs_action');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [selectedComment, setSelectedComment] = useState<Comment | null>(null);
  const pendingDeepLinkRef = useRef<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Infinite scroll observer ref
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Fetch pages
  const { data: pagesData = [] } = useQuery({
    queryKey: ['pages'],
    queryFn: async () => {
      const { data } = await pagesApi.getAll();
      return Array.isArray(data) ? data : (data?.data || []);
    },
    enabled: isAuthenticated,
  });
  const pages = pagesData as Page[];

  // Get API params based on current filter
  const apiParams = useMemo(() => getApiParams(filter), [filter]);

  // Infinite query for comments
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isPending,
    error,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['comments', apiParams],
    queryFn: async ({ pageParam }) => {
      const params: CommentsQueryParams = {
        ...apiParams,
        limit: COMMENTS_PER_PAGE,
        cursor: pageParam as string | undefined,
      };
      const response = await commentsApi.getAll(params);
      return response.data;
    },
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    enabled: isAuthenticated,
  });

  // Flatten all pages of comments
  const allComments = useMemo((): Comment[] => {
    if (!data?.pages) return [];
    // The API returns CommentData which is compatible with Comment
    return data.pages.flatMap(page => page.data as unknown as Comment[]);
  }, [data]);

  // Client-side filtering for search
  const filteredComments = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    if (!query) return allComments;
    return allComments.filter(c =>
      c.message.toLowerCase().includes(query) ||
      (c.fromName || '').toLowerCase().includes(query)
    );
  }, [allComments, debouncedSearch]);

  // Fetch global stats from server
  const { data: statsData } = useQuery({
    queryKey: ['comments-stats'],
    queryFn: async () => {
      const res = await commentsApi.getStats();
      return res.data;
    },
    enabled: isAuthenticated,
    // SSE handles real-time updates — no polling needed
  });

  // Use server stats or fallback to defaults
  const stats = useMemo(() => {
    if (statsData) {
      return {
        total: statsData.total,
        actionRequired: statsData.actionRequired ?? statsData.unreplied,
        autoReplied: statsData.byMethod.ai + statsData.byMethod.template,
        handled: statsData.resolved ?? 0,
      };
    }

    return {
      total: 0,
      actionRequired: 0,
      autoReplied: 0,
      handled: 0,
    };
  }, [statsData]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!loadMoreRef.current || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Close overflow menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // Sync Filter to URL
  const updateFilter = useCallback((newFilter: FilterType) => {
    if (newFilter === filter) return;

    setIsTransitioning(true);
    setTimeout(() => {
      setFilter(newFilter);
      setIsTransitioning(false);
    }, 120);

    const params = new URLSearchParams(window.location.search);
    if (newFilter === 'needs_action') {
      params.delete('filter');
    } else {
      params.set('filter', newFilter);
    }
    router.push({ pathname: router.pathname, query: params.toString() }, undefined, { shallow: true });
  }, [filter, router]);

  // Update internal filter when URL changes (+ deep-link handling)
  useEffect(() => {
    if (!router.isReady) return;
    const commentId = router.query.commentId as string | undefined;
    if (commentId) {
      // Store target ID and switch to "all" so the comment is visible regardless of status
      pendingDeepLinkRef.current = commentId;
      setFilter('all');
      // Clean URL immediately to avoid re-triggering
      const params = new URLSearchParams(window.location.search);
      params.delete('commentId');
      params.delete('filter');
      router.replace({ pathname: router.pathname, query: Object.fromEntries(params) }, undefined, { shallow: true });
      return;
    }
    const currentParam = router.query.filter as string | undefined;
    setFilter(resolveFilter(currentParam));
  }, [router.isReady, router.query.filter, router.query.commentId, router]);

  // Deep-link: auto-select comment after "all" data loads
  useEffect(() => {
    if (!pendingDeepLinkRef.current || isLoading || filter !== 'all') return;
    const targetId = pendingDeepLinkRef.current;
    const found = allComments.find(c => c.id === targetId);
    if (found) {
      setSelectedComment(found);
    } else if (allComments.length > 0) {
      toast.info(t('deepLinkNotFound'));
    }
    pendingDeepLinkRef.current = null;
  }, [allComments, isLoading, filter, t]);

  // Update Page Title
  useEffect(() => {
    const filterLabels: Record<FilterType, string> = {
      needs_action: t('needsAction'),
      all: '',
      auto_replied: t('autoReplied'),
      handled: t('handled'),
    };
    const filterLabel = filterLabels[filter] ? ` — ${filterLabels[filter]}` : '';
    const countLabel = filteredComments.length > 0 ? ` (${filteredComments.length})` : '';
    document.title = `${t('title')}${filterLabel}${countLabel}`;
  }, [filter, filteredComments.length, t]);

  // ESC key to close modal
  useEscapeKey(() => setSelectedComment(null), !!selectedComment);

  const handleResolve = useCallback(async (commentId: string) => {
    try {
      await commentsApi.resolve(commentId);
      queryClient.invalidateQueries({ queryKey: ['comments'] });
      queryClient.invalidateQueries({ queryKey: ['comments-stats'] });
      toast.success(t('resolveSuccess'));
    } catch (err) {
      captureError(err, 'Failed to resolve comment', { tags: { page: 'comments', action: 'resolve' } });
      toast.error(tc('error'));
    }
  }, [queryClient, t, tc]);

  const handleUnresolve = useCallback(async (commentId: string) => {
    try {
      await commentsApi.unresolve(commentId);
      queryClient.invalidateQueries({ queryKey: ['comments'] });
      queryClient.invalidateQueries({ queryKey: ['comments-stats'] });
      toast.success(t('unresolveSuccess'));
    } catch (err) {
      captureError(err, 'Failed to unresolve comment', { tags: { page: 'comments', action: 'unresolve' } });
      toast.error(tc('error'));
    }
  }, [queryClient, t, tc]);

  const exportToCSV = () => {
    setExporting(true);
    try {
      const headers = [
        tExport('pageName'), tExport('commenter'), tExport('comment'),
        tExport('replied'), tExport('reply'), tExport('method'),
        tExport('language'), tExport('date'), tExport('repliedAt'),
      ];
      const rows = allComments.map(c => {
        const page = pages.find(p => p.id === c.pageId);
        return [
          page?.name || '', c.fromName || '', c.message || '',
          c.replied ? tc('yes') : tc('no'), c.replyText || '', c.replyMethod || '',
          c.detectedLanguage || '', formatDateForExport(c.createdAt, language),
          formatDateForExport(c.repliedAt, language),
        ];
      });
      downloadCSV(`comments_${format(new Date(), 'yyyy-MM-dd')}.csv`, headers, rows);
    } catch (error) {
      captureError(error, 'Comment export failed', { tags: { page: 'comments', action: 'export' } });
      toast.error(tc('error'));
    } finally {
      setExporting(false);
    }
  };

  type EmptyConfig = { icon: LucideIcon; variant: 'success' | 'empty' | 'search'; title: string; subtitle: string; iconColorClass?: string; iconBgClass?: string; showConnectCta: boolean };

  const emptyStateContent = useMemo((): EmptyConfig => {
    if (debouncedSearch) {
      return { icon: Search, variant: 'search', title: tc('noData'), subtitle: t('tryDifferentSearch'), showConnectCta: false };
    }
    if (pages.length === 0) {
      return { icon: MessageSquare, variant: 'empty', title: t('noComments'), subtitle: t('noCommentsDesc'), showConnectCta: true };
    }
    const config: Record<FilterType, Omit<EmptyConfig, 'showConnectCta'>> = {
      needs_action: {
        icon: CheckCircle,
        variant: 'success',
        title: t('emptyNeedsAction'),
        subtitle: t('emptyNeedsActionSub'),
      },
      all: {
        icon: MessageSquare,
        variant: 'empty',
        title: t('emptyAll'),
        subtitle: t('emptyAllSub'),
      },
      auto_replied: {
        icon: Sparkles,
        variant: 'empty',
        iconColorClass: 'text-violet-500',
        iconBgClass: 'icon-bg-violet-light',
        title: t('emptyAutoReplied'),
        subtitle: t('emptyAutoRepliedSub'),
      },
      handled: {
        icon: CheckCircle,
        variant: 'empty',
        title: t('emptyHandled'),
        subtitle: t('emptyHandledSub'),
      },
    };
    return { ...config[filter], showConnectCta: false };
  }, [debouncedSearch, pages, filter, t, tc]);

  // Lookup map: O(1) page resolution inside comment list render
  const pageById = useMemo(() => new Map(pages.map(p => [p.id, p])), [pages]);

  // Page URL for selected comment modal — Instagram pages use instagram.com, Facebook use facebook.com
  const selectedCommentPageUrl = useMemo(() => {
    if (!selectedComment?.pageId) return undefined;
    const page = pageById.get(selectedComment.pageId);
    if (!page) return undefined;
    return getPageExternalUrl(page, selectedComment.source);
  }, [selectedComment, pageById]);

  // Platform visibility — only recomputes when pages data changes
  const showPlatformIcon = useMemo(
    () => pages.some(p => !!p.facebookPageId) && pages.some(p => !!p.instagramAccountId),
    [pages]
  );

  if ((isLoading || isPending) && allComments.length === 0) {
    return <PageSkeleton type="list" />;
  }

  // Show error state if the query failed
  if (error && allComments.length === 0) {
    return (
      <div className="py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-8 h-8 text-red-400" />
        </div>
        <p className="text-base font-semibold text-muted-foreground mb-2">
          {tErr('somethingWentWrong')}
        </p>
        <p className="text-sm text-muted-foreground mb-5">
          {(error as Error)?.message || tErr('tryAgain')}
        </p>
        <Button variant="primary" size="sm" onClick={() => refetch()}>
          {tErr('tryAgain')}
        </Button>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen(prev => !prev)}
              className="p-2 rounded-xl text-muted-foreground hover:text-foreground/70 hover:bg-muted transition-colors"
              aria-label={tc('export')}
              aria-expanded={menuOpen}
            >
              <MoreVertical className="w-5 h-5" />
            </button>
            {menuOpen && (
              <div className="absolute end-0 top-full mt-1 w-44 sm:w-48 bg-card rounded-xl shadow-lg ring-1 ring-theme-border/60 py-1 z-20 animate-in fade-in slide-in-from-top-2 duration-150">
                <button
                  onClick={() => { exportToCSV(); setMenuOpen(false); }}
                  disabled={exporting}
                  className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 text-sm text-foreground/70 hover:bg-background transition-colors disabled:opacity-50"
                >
                  <Download className="w-4 h-4 flex-shrink-0" />
                  {t('exportCSV')}
                </button>
              </div>
            )}
          </div>
        }
      />

      {/* Filter Chips + Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
        <div className="w-full sm:flex-1 sm:min-w-0 flex flex-wrap items-center gap-2">
          {([
            { key: 'needs_action' as FilterType, label: t('needsAction'), count: stats.actionRequired },
            { key: 'all' as FilterType, label: t('allComments'), count: stats.total },
            { key: 'auto_replied' as FilterType, label: t('autoReplied'), count: stats.autoReplied },
            { key: 'handled' as FilterType, label: t('handled'), count: stats.handled },
          ]).map(chip => (
            <button
              key={chip.key}
              onClick={() => updateFilter(chip.key)}
              aria-pressed={filter === chip.key}
              className={clsx(
                "flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap transition-all duration-200",
                filter === chip.key
                  ? "bg-brand-500 text-white shadow-sm shadow-brand-500/25"
                  : "bg-muted text-muted-foreground hover:bg-surface-200"
              )}
            >
              {chip.label}
              <span className={clsx(
                "text-xs tabular-nums",
                filter === chip.key ? "text-white/80" : "text-muted-foreground"
              )}>
                ({chip.count.toLocaleString()})
              </span>
            </button>
          ))}
        </div>

        <div role="search" aria-label={tc('search')} className="relative group w-full sm:w-[300px] sm:flex-none">
          <Search
            className="absolute top-1/2 -translate-y-1/2 start-3.5 w-4.5 h-4.5 text-muted-foreground group-focus-within:text-brand-500 transition-colors z-10"
          />
          <Input
            type="search"
            inputMode="search"
            autoComplete="off"
            aria-label={tc('search')}
            placeholder={tc('search') + '...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="py-2.5 ps-10 pe-10 rounded-full bg-background border-none focus:ring-2 focus:ring-brand-500/20 focus:bg-card transition-all text-sm"
          />
          {searchQuery.trim().length > 0 && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute top-1/2 -translate-y-1/2 end-2.5 p-1 rounded-full text-muted-foreground hover:text-muted-foreground hover:bg-muted transition-colors z-10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Comments List */}
      {filteredComments.length > 0 ? (
        <>
          <div
            className={clsx(
              "grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 pb-4 sm:pb-6 transition-all duration-300 ease-out",
              isTransitioning ? "opacity-40 translate-y-2 scale-[0.99]" : "opacity-100 translate-y-0 scale-100"
            )}
          >
            {filteredComments.map((comment, i) => {
              const page = comment.pageId ? pageById.get(comment.pageId) : undefined;
              return (
                <CommentCard
                  key={comment.id}
                  comment={comment}
                  variant="full"
                  pageName={page?.name}
                  showPlatformIcon={showPlatformIcon}
                  animationDelay={i < 10 ? i * 0.05 : 0}
                  onClick={() => setSelectedComment(comment)}
                  onQuickReply={() => setSelectedComment(comment)}
                  onResolve={!comment.resolved ? () => handleResolve(comment.id) : undefined}
                  onUnresolve={comment.resolved ? () => handleUnresolve(comment.id) : undefined}
                />
              );
            })}
          </div>

          {/* Infinite Scroll Trigger / Load More */}
          <div ref={loadMoreRef} className="pb-12">
            {isFetchingNextPage ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
                <span className="ms-3 text-sm text-muted-foreground">{tc('loading')}...</span>
              </div>
            ) : hasNextPage ? (
              <div className="flex justify-center py-8">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  className="rounded-full px-6"
                >
                  {tc('loadMore')}
                </Button>
              </div>
            ) : allComments.length > COMMENTS_PER_PAGE ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <Check className="w-3.5 h-3.5 inline-block" /> {tc('allLoaded')}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <Card className="border-none shadow-md shadow-surface-200/20 rounded-2xl">
          <EmptyState
            icon={emptyStateContent.icon}
            variant={emptyStateContent.variant}
            title={emptyStateContent.title}
            description={emptyStateContent.subtitle || ''}
            iconColorClass={'iconColorClass' in emptyStateContent ? emptyStateContent.iconColorClass : undefined}
            iconBgClass={'iconBgClass' in emptyStateContent ? emptyStateContent.iconBgClass : undefined}
            action={emptyStateContent.showConnectCta ? (
              <Link href="/pages">
                <Button variant="primary" size="sm" icon={<ExternalLink className="w-[18px] h-[18px]" />}>
                  {t('connectPage')}
                </Button>
              </Link>
            ) : undefined}
          />
        </Card>
      )}

      {selectedComment && (
        <CommentDetailModal
          key={selectedComment.id}
          comment={selectedComment}
          onClose={() => setSelectedComment(null)}
          onReplySuccess={() => refetch()}
          onResolve={!selectedComment.resolved ? () => handleResolve(selectedComment.id) : undefined}
          onUnresolve={selectedComment.resolved ? () => handleUnresolve(selectedComment.id) : undefined}
          pageName={selectedComment.pageId ? pageById.get(selectedComment.pageId)?.name : undefined}
          pageUrl={selectedCommentPageUrl}
        />
      )}
    </>
  );
};

CommentsPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Comments">{page}</DashboardLayout>
);

export default CommentsPage;

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.comments]);
