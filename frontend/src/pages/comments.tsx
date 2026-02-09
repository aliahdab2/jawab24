import React, { useState, useEffect, useCallback, type ReactElement, useMemo, useRef } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Input, PageHeader, PageSkeleton } from '@/components/ui';
import { StatCard } from '@/components/dashboard/StatCard';
import { CommentDetailModal, CommentCard, checkNeedsAttention } from '@/components/comments';
import { useAuthStore } from '@/lib/store';
import { commentsApi, pagesApi, type CommentsQueryParams } from '@/lib/api';
import {
  MessageSquare,
  Search,
  Bot,
  Clock,
  CheckCircle,
  Download,
  AlertTriangle,
  ExternalLink,
  X,
  Zap,
  Loader2
} from 'lucide-react';
import { useTranslation } from '@/i18n';
import { format, isToday } from 'date-fns';
import { downloadCSV, formatDateForExport } from '@/utils/csvExport';
import type { Comment, Page } from '@jawab24/shared';
import type { NextPageWithLayout } from './_app';
import { useEscapeKey } from '@/hooks/useEscapeKey';

// Filter types - server-side filters use API params, client-side filters use local filtering
type FilterType = 'all' | 'template' | 'ai' | 'pending' | 'needs_attention' | 'replied_today' | 'flagged';

// Map frontend filters to API params
function getApiParams(filter: FilterType): CommentsQueryParams {
  switch (filter) {
    case 'pending':
      return { replied: false };
    case 'ai':
      return { replied: true, replyMethod: 'ai' };
    case 'template':
      return { replied: true, replyMethod: 'template' };
    case 'needs_attention':
    case 'flagged':
      return { needsAttention: true };
    // These filters need client-side filtering on top of server data
    case 'replied_today':
    case 'all':
    default:
      return {};
  }
}


// Custom hook for debounced value
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

const COMMENTS_PER_PAGE = 50;

const CommentsPage: NextPageWithLayout = () => {
  const { t, language } = useTranslation();
  const { isAuthenticated } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isTransitioning, setIsTransitioning] = useState(false);

  // Map URL 'flagged' -> 'needs_attention' internally
  const rawFilter = (searchParams.get('filter') as string) || 'all';
  const initialFilter = rawFilter === 'flagged' ? 'needs_attention' : (rawFilter as FilterType);

  const [filter, setFilter] = useState<FilterType>(initialFilter);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [selectedComment, setSelectedComment] = useState<Comment | null>(null);
  const [exporting, setExporting] = useState(false);

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

  // Client-side filtering for search and special filters
  const filteredComments = useMemo(() => {
    let result = allComments;

    // Apply client-side filter for special filters
    if (filter === 'replied_today') {
      result = result.filter(c => c.replied && c.repliedAt && isToday(new Date(c.repliedAt)));
    }

    // Apply search filter
    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase();
      result = result.filter(c =>
        c.message.toLowerCase().includes(query) ||
        (c.fromName || '').toLowerCase().includes(query)
      );
    }

    return result;
  }, [allComments, filter, debouncedSearch]);

  // Fetch global stats from server
  const { data: statsData } = useQuery({
    queryKey: ['comments-stats'],
    queryFn: async () => {
      const res = await commentsApi.getStats();
      return res.data;
    },
    enabled: isAuthenticated,
    refetchInterval: 30000, // Refresh every 30s
  });

  // Use server stats or fallback to defaults
  const stats = useMemo(() => {
    if (statsData) {
      return {
        total: statsData.total,
        templateReplies: statsData.byMethod.template,
        pending: statsData.unreplied,
        aiReplies: statsData.byMethod.ai,
        needsAttention: statsData.needsAttention,
        repliedToday: statsData.repliedToday,
      };
    }

    return {
      total: 0,
      templateReplies: 0,
      pending: 0,
      aiReplies: 0,
      needsAttention: 0,
      repliedToday: 0,
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

  // Sync Filter to URL
  const updateFilter = useCallback((newFilter: FilterType) => {
    if (newFilter === filter) return;

    setIsTransitioning(true);
    setTimeout(() => {
      setFilter(newFilter);
      setIsTransitioning(false);
    }, 120);

    const params = new URLSearchParams(window.location.search);
    let urlFilter = newFilter;
    if (newFilter === 'needs_attention') urlFilter = 'flagged';

    if (newFilter === 'all') {
      params.delete('filter');
    } else {
      params.set('filter', urlFilter);
    }
    router.push({ pathname: router.pathname, query: params.toString() }, undefined, { shallow: true });
  }, [filter, router]);

  // Update internal filter when URL changes
  useEffect(() => {
    const currentParam = searchParams.get('filter');
    if (currentParam === 'flagged') {
      setFilter('needs_attention');
    } else if (currentParam) {
      setFilter(currentParam as FilterType);
    } else {
      setFilter('all');
    }
  }, [searchParams]);

  // Update Page Title
  useEffect(() => {
    const filterLabel = filter === 'all' ? '' : ` — ${t(`comments.${filter}` as any)}`;
    const countLabel = filteredComments.length > 0 ? ` (${filteredComments.length})` : '';
    document.title = `${t('comments.title')}${filterLabel}${countLabel}`;
  }, [filter, filteredComments.length, t]);

  // Auto-scroll active card into view on mobile
  useEffect(() => {
    if (filter !== 'all') {
      const activeEl = document.getElementById('active-stat');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [filter]);

  // ESC key to close modal
  useEscapeKey(() => setSelectedComment(null), !!selectedComment);

  const getFilterChipLabel = (filterType: FilterType) => {
    switch (filterType) {
      case 'template': return t('comments.replied');
      case 'ai': return t('dashboard.aiReply');
      case 'pending': return t('comments.pending');
      case 'needs_attention': return t('comments.needsAttention');
      case 'replied_today': return t('comments.replied_today');
      default: return '';
    }
  };

  const exportToCSV = () => {
    setExporting(true);
    try {
      const headers = [
        t('export.pageName'), t('export.commenter'), t('export.comment'),
        t('export.replied'), t('export.reply'), t('export.method'),
        t('export.language'), t('export.date'), t('export.repliedAt'),
      ];
      const rows = allComments.map(c => {
        const page = pages.find(p => p.id === c.pageId);
        return [
          page?.name || '', c.fromName || '', c.message || '',
          c.replied ? t('common.yes') : t('common.no'), c.replyText || '', c.replyMethod || '',
          c.detectedLanguage || '', formatDateForExport(c.createdAt, language),
          formatDateForExport(c.repliedAt, language),
        ];
      });
      downloadCSV(`comments_${format(new Date(), 'yyyy-MM-dd')}.csv`, headers, rows);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setExporting(false);
    }
  };

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
        <p className="text-base font-semibold text-surface-600 mb-2">
          {t('errors.somethingWentWrong' as any)}
        </p>
        <p className="text-sm text-surface-500 mb-5">
          {(error as Error)?.message || t('errors.tryAgain' as any)}
        </p>
        <Button variant="primary" size="sm" onClick={() => refetch()}>
          {t('errors.tryAgain' as any)}
        </Button>
      </div>
    );
  }

  // Calculate platform visibility logic
  const showPageName = pages.length > 1;
  const hasFacebook = pages.some(p => !!p.facebookPageId);
  const hasInstagram = pages.some(p => !!p.instagramAccountId);
  const showPlatformIcon = hasFacebook && hasInstagram;

  return (
    <>
      <PageHeader
        title={t('comments.title')}
        description={t('comments.description')}
        action={
          <Button
            variant="secondary"
            size="sm"
            icon={<Download className="w-[18px] h-[18px] sm:w-5 sm:h-5" />}
            onClick={exportToCSV}
            loading={exporting}
          >
            {t('comments.exportCSV')}
          </Button>
        }
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-12">
        <div onClick={() => updateFilter('all')}>
          <StatCard
            nameKey="comments.allComments"
            value={stats.total.toLocaleString()}
            icon={MessageSquare}
            color="brand"
            index={0}
            isActive={filter === 'all'}
          />
        </div>
        <div onClick={() => updateFilter('pending')}>
          <StatCard
            nameKey="comments.pending"
            value={stats.pending.toLocaleString()}
            icon={Clock}
            color="amber"
            index={1}
            isActive={filter === 'pending'}
          />
        </div>
        <div onClick={() => updateFilter('replied_today')}>
          <StatCard
            nameKey="comments.repliedToday"
            value={stats.repliedToday.toLocaleString()}
            icon={CheckCircle}
            color="emerald"
            index={2}
            isActive={filter === 'replied_today'}
          />
        </div>
        <div onClick={() => updateFilter('ai')}>
          <StatCard
            nameKey="dashboard.aiReply"
            value={stats.aiReplies.toLocaleString()}
            icon={Bot}
            color="violet"
            index={3}
            isActive={filter === 'ai'}
          />
        </div>
        <div onClick={() => updateFilter('template')}>
          <StatCard
            nameKey="dashboard.templateReply"
            value={stats.templateReplies.toLocaleString()}
            icon={Zap}
            color="brand"
            index={4}
            isActive={filter === 'template'}
          />
        </div>
        <div onClick={() => updateFilter('needs_attention')}>
          <StatCard
            nameKey="comments.needsAttention"
            value={stats.needsAttention.toLocaleString()}
            icon={AlertTriangle}
            color="red"
            index={5}
            isActive={filter === 'needs_attention'}
          />
        </div>
      </div>

      {/* Filters & Search */}
      <Card className="mb-12 border-none shadow-md shadow-surface-200/20 overflow-visible" padding="none">
        <div className="p-4 sm:p-5 flex flex-col md:flex-row items-center gap-4">
          <div className="relative group flex-1 w-full">
            <Search
              className="absolute top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400 group-focus-within:text-brand-500 transition-colors z-10"
              style={{ insetInlineStart: '1.25rem' }}
            />
            <Input
              placeholder={t('common.search') + '...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="py-3.5 ps-14 rounded-2xl bg-surface-50 border-none focus:ring-4 focus:ring-brand-500/10 focus:bg-white transition-all shadow-sm"
            />
          </div>

          {filter !== 'all' && (
            <div className="flex shrink-0 animate-in fade-in slide-in-from-right-4 duration-300">
              <button
                onClick={() => updateFilter('all')}
                className={clsx(
                  "group relative flex items-center gap-2.5 py-2.5 px-5 rounded-full shadow-sm hover:shadow-md transition-all duration-300 ring-1 ring-inset",
                  filter === 'pending' && "bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100",
                  filter === 'ai' && "bg-violet-50 text-violet-700 ring-violet-200 hover:bg-violet-100",
                  filter === 'needs_attention' && "bg-red-50 text-red-700 ring-red-200 hover:bg-red-100",
                  (filter === 'template' || filter === 'replied_today') && "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100"
                )}
              >
                {filter === 'pending' && <Clock className="w-4 h-4" />}
                {filter === 'ai' && <Bot className="w-4 h-4" />}
                {filter === 'needs_attention' && <AlertTriangle className="w-4 h-4" />}
                {(filter === 'template' || filter === 'replied_today') && <CheckCircle className="w-4 h-4" />}

                <span className="font-bold text-sm tracking-wide">{getFilterChipLabel(filter)}</span>

                <div className="w-px h-4 mx-1 opacity-20 bg-current" />

                <div className="bg-white/50 rounded-full p-0.5 group-hover:bg-white transition-colors">
                  <X className="w-3.5 h-3.5" />
                </div>
              </button>
            </div>
          )}

          {filteredComments.length > 0 && (
            <div className="hidden md:flex items-center gap-2 text-[10px] font-bold text-surface-400 uppercase tracking-widest whitespace-nowrap">
              <span>{filteredComments.length} {t('dashboard.comments')}</span>
              {hasNextPage && <span className="text-brand-500">+</span>}
            </div>
          )}
        </div>
      </Card>

      {/* Comments List */}
      {filteredComments.length > 0 ? (
        <>
          <div
            className={clsx(
              "grid grid-cols-1 lg:grid-cols-2 gap-8 pb-8 transition-all duration-300 ease-out",
              isTransitioning ? "opacity-40 translate-y-2 scale-[0.99]" : "opacity-100 translate-y-0 scale-100"
            )}
          >
            {filteredComments.map((comment, i) => {
              const page = pages.find(p => p.id === comment.pageId);
              return (
                <CommentCard
                  key={comment.id}
                  comment={comment}
                  variant="full"
                  pageName={page?.name}
                  showPageName={showPageName}
                  showPlatformIcon={showPlatformIcon}
                  showPostInfo={true}
                  animationDelay={i < 10 ? i * 0.05 : 0}
                  onClick={() => setSelectedComment(comment)}
                  onQuickReply={() => setSelectedComment(comment)}
                />
              );
            })}
          </div>

          {/* Infinite Scroll Trigger / Load More */}
          <div ref={loadMoreRef} className="pb-12">
            {isFetchingNextPage ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
                <span className="ms-3 text-sm text-surface-500">{t('common.loading')}...</span>
              </div>
            ) : hasNextPage ? (
              <div className="flex justify-center py-8">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  className="rounded-full px-6"
                >
                  {t('common.loadMore')}
                </Button>
              </div>
            ) : allComments.length > COMMENTS_PER_PAGE ? (
              <div className="text-center py-8 text-sm text-surface-400">
                ✓ {t('common.allLoaded')}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <Card className="border-none shadow-md shadow-surface-200/20 rounded-2xl" padding="lg">
          <div className="py-10 text-center">
            <div className="w-16 h-16 rounded-2xl bg-surface-100 flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="w-8 h-8 text-surface-300 opacity-60" />
            </div>
            <p className="text-base font-semibold text-surface-600 mb-2">
              {debouncedSearch ? t('common.noData') : t('comments.noComments')}
            </p>
            <p className="text-sm text-surface-500 mb-5">
              {debouncedSearch ? t('comments.tryDifferentSearch') : (pages.length > 0) ? t('comments.noCommentsForFilter') : t('comments.noCommentsDesc')}
            </p>
            {!debouncedSearch && pages.length === 0 && (
              <Link href="/pages">
                <Button variant="primary" size="sm" icon={<ExternalLink className="w-[18px] h-[18px]" />}>
                  {t('comments.connectPage')}
                </Button>
              </Link>
            )}
          </div>
        </Card>
      )}

      {selectedComment && (
        <CommentDetailModal
          comment={selectedComment}
          onClose={() => setSelectedComment(null)}
          onReplySuccess={() => refetch()}
        />
      )}
    </>
  );
};

CommentsPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Comments">{page}</DashboardLayout>
);

export default CommentsPage;
