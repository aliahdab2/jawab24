import React, { useState, useEffect, useCallback, type ReactElement, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useInfiniteQuery, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Input, PageHeader, PageSkeleton, EmptyState, FilterChipBar } from '@/components/ui';
import { InboxTitle, InboxExportButton } from '@/components/inbox/InboxHeaderActions';
import dynamic from 'next/dynamic';
import { SwipeableCommentCard } from '@/components/comments';
import { PostReplyIntroBanner } from '@/components/comments/PostReplyIntroBanner';

const CommentDetailModal = dynamic(() => import('@/components/comments').then(m => ({ default: m.CommentDetailModal })), { ssr: false });
import { useAuthStore, useUIStore } from '@/lib/store';
import { useDebounce, usePageFilter, useUrlSelectedResource, useInfiniteScrollObserver, usePersistedBoolean, usePostReplySetup, useOpenOnQueryParam } from '@/hooks';
import { commentsApi, pagesApi, postsApi, type CommentsQueryParams } from '@/lib/api';
import { invalidateInfiniteListFresh } from '@/lib/queryInvalidation';
import {
  MessageSquare,
  Search,
  X,
  Check,
  CheckCircle,
  Sparkles,
  AlertTriangle,
  ExternalLink,
  Loader2,
  LayoutGrid,
  List,
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
import { groupComments, filterGroupsBySearch } from '@/utils/commentGrouping';
import { PostReplyIcon, postReplyIconClass } from '@/utils/postReply';

import { type InboxFilterType, resolveInboxFilter, inboxFilterToApiParams } from '@/utils/inboxFilters';
type FilterType = InboxFilterType;
const resolveFilter = resolveInboxFilter;
const deepLinkErrorTag = { page: 'comments', action: 'deep-link' } as const;
const getApiParams = (filter: FilterType): CommentsQueryParams => inboxFilterToApiParams(filter);


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
  // Card grid (masonry) vs. compact single-column list — persisted per user.
  const [listView, setListView] = usePersistedBoolean('comments:listView', false);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Fetch all posts so we can show active trigger state (⚡ green) on page load
  const { data: postsData = [] } = useQuery({
    queryKey: ['posts'],
    queryFn: async () => {
      const { data } = await postsApi.getAll();
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
    enabled: isAuthenticated,
    staleTime: 30_000,
  });
  const triggersByPostId = useMemo(() => {
    // A rule is active whenever a reply is set — keyword mode carries keyword+reply,
    // any-comment mode carries a reply only (keyword null).
    const map: Record<string, { keyword: string | null; reply: string } | null> = {};
    for (const post of postsData as Array<{ id: string; triggerKeyword?: string | null; triggerReply?: string | null }>) {
      map[post.id] = post.triggerReply
        ? { keyword: post.triggerKeyword ?? null, reply: post.triggerReply }
        : null;
    }
    return map;
  }, [postsData]);
  // Show NEW badge on the Post Reply button until the user creates their first trigger.
  // Once any post has a trigger, the badge disappears everywhere — we trust users to
  // remember the feature exists once they've used it.
  const showPostReplyNewBadge = useMemo(
    () => Object.values(triggersByPostId).every(v => !v),
    [triggersByPostId]
  );
  // Anchor the badge to a single card (the first un-configured one in the visible list)
  // — rendering it on every card creates visual noise and reads as a bug.
  // Computed below once filteredGroups is available.
  const [exporting, setExporting] = useState(false);
  const queryClient = useQueryClient();

  // Infinite scroll observer ref
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Fetch pages
  const { data: pagesData = [], isFetched: pagesFetched } = useQuery({
    queryKey: ['pages'],
    queryFn: async () => {
      const { data } = await pagesApi.getAll();
      return Array.isArray(data) ? data : (data?.data || []);
    },
    enabled: isAuthenticated,
  });
  const pages = pagesData as Page[];
  // Shared Post Reply setup (config modal + picker sheet + safe open flow). Given
  // `pages` so the header "رد البوست" button can open the post picker.
  const postReplySetup = usePostReplySetup(pages);
  // ?openPostReply=true → open the post picker directly (deep link from the
  // Settings Auto-Reply board's "Manage" — same pattern as /pages?openKb=true).
  // Callback identity churn is harmless: the hook one-shots via a ref guard.
  const openPostReplyPicker = useCallback(() => {
    postReplySetup.openPicker();
  }, [postReplySetup]);
  // Ready = the pages query SETTLED, not "pages exist": a zero-page merchant
  // arriving from the Settings Manage link must still get the picker (its
  // no-active-pages empty state), not a silent dead-end whose un-stripped param
  // pops the picker minutes later when a background refetch finds pages.
  useOpenOnQueryParam('openPostReply', pagesFetched, openPostReplyPicker);
  const { pageId, activePages, updatePageId, syncFromUrl } = usePageFilter(pages);

  // Get API params based on current filter + page
  const apiParams = useMemo(() => ({
    ...getApiParams(filter),
    ...(pageId && { pageId }),
  }), [filter, pageId]);

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
    placeholderData: keepPreviousData,
  });

  // Flatten all pages of comments
  const allComments = useMemo((): Comment[] => {
    if (!data?.pages) return [];
    // The API returns CommentData which is compatible with Comment
    return data.pages.flatMap(page => page.data as unknown as Comment[]);
  }, [data]);

  // Group comments by person+post, then filter by search
  const commentGroups = useMemo(() => groupComments(allComments), [allComments]);
  const filteredGroups = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    if (!query) return commentGroups;
    return filterGroupsBySearch(commentGroups, query);
  }, [commentGroups, debouncedSearch]);

  // The first un-configured post in the visible list — anchors both the NEW badge
  // and the first-run intro banner's "set one up" CTA.
  const firstTriggerableGroup = useMemo(
    () => filteredGroups.find(g => {
      const postId = g.latestComment.postId;
      return postId && !triggersByPostId[postId];
    }) ?? null,
    [filteredGroups, triggersByPostId]
  );
  // Show the NEW badge on that single card until the user creates their first
  // trigger. Null when the badge should not be shown anywhere.
  const newBadgeGroupKey = showPostReplyNewBadge ? (firstTriggerableGroup?.groupKey ?? null) : null;

  // Track which groups are expanded (show earlier comments)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }, []);

  // Fetch stats — scoped to the active page filter so chip counts always match the list below.
  const { data: statsData } = useQuery({
    queryKey: ['comments-stats', pageId ?? null],
    queryFn: async () => {
      const res = await commentsApi.getStats(pageId ? { pageId } : undefined);
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
        autoReplied: statsData.byMethod.ai + statsData.byMethod.template + (statsData.byMethod.postReply ?? 0),
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

  // Infinite scroll — auto-load is paused while a search is active. Search filters
  // the loaded list client-side, so a short filtered list leaves the sentinel in
  // view; without this gate the observer would page through the entire dataset to
  // feed a client-side filter, flooding the network/console. Manual "Load More" stays.
  useInfiniteScrollObserver({
    targetRef: loadMoreRef,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    enabled: debouncedSearch.trim().length === 0,
  });

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

  // Update internal filter when URL changes
  useEffect(() => {
    if (!router.isReady) return;
    const currentParam = router.query.filter as string | undefined;
    setFilter(resolveFilter(currentParam));
    syncFromUrl(router.query.page as string | undefined);
  }, [router.isReady, router.query.filter, router.query.page, syncFromUrl]);

  // URL-driven detail drawer (?comment=<id>) + notification deep-link
  // (?commentId=<id>), shared with the Messages and Leads pages via
  // useUrlSelectedResource. Opening a comment first closes any open trigger modal.
  const getCommentKey = useCallback((c: Comment) => c.id, []);
  const fetchCommentById = useCallback(async (commentId: string): Promise<Comment | null> => {
    const { data } = await commentsApi.getById(commentId);
    return (data as unknown as Comment) ?? null;
  }, []);
  const {
    selected: selectedComment,
    open: openComment,
    close: closeComment,
  } = useUrlSelectedResource<Comment>({
    urlParam: 'comment',
    getKey: getCommentKey,
    list: allComments,
    deepLink: {
      paramName: 'commentId',
      fetch: fetchCommentById,
      notFoundMessage: t('deepLinkNotFound'),
      errorTag: deepLinkErrorTag,
    },
    onBeforeOpen: postReplySetup.close,
  });

  // Prev/next navigation across the visible cards (one card = a group's latest
  // comment), so the detail modal can step through without close/reopen.
  const navComments = useMemo(() => filteredGroups.map(g => g.latestComment), [filteredGroups]);
  const navIndex = selectedComment ? navComments.findIndex(c => c.id === selectedComment.id) : -1;
  const goToPrevComment = useCallback(() => {
    if (navIndex > 0) openComment(navComments[navIndex - 1]);
  }, [navIndex, navComments, openComment]);
  const goToNextComment = useCallback(() => {
    if (navIndex >= 0 && navIndex < navComments.length - 1) openComment(navComments[navIndex + 1]);
  }, [navIndex, navComments, openComment]);

  // Update Page Title — use server stats counts to match chip badges
  useEffect(() => {
    const filterLabels: Record<FilterType, string> = {
      needs_action: t('needsAction'),
      all: '',
      auto_replied: t('autoReplied'),
      handled: t('handled'),
    };
    const filterCounts: Record<FilterType, number> = {
      needs_action: stats.actionRequired,
      all: stats.total,
      auto_replied: stats.autoReplied,
      handled: stats.handled,
    };
    const filterLabel = filterLabels[filter] ? ` — ${filterLabels[filter]}` : '';
    const count = filterCounts[filter];
    const countLabel = count > 0 ? ` (${count})` : '';
    document.title = `${t('title')}${filterLabel}${countLabel}`;
  }, [filter, stats, t]);

  // ESC key to close modal (goes through closeComment so URL stays in sync)
  useEscapeKey(() => closeComment(), !!selectedComment);

  const handleResolve = useCallback(async (commentId: string) => {
    try {
      await commentsApi.resolve(commentId);
      invalidateInfiniteListFresh(queryClient, ['comments']);
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
      invalidateInfiniteListFresh(queryClient, ['comments']);
      queryClient.invalidateQueries({ queryKey: ['comments-stats'] });
      toast.success(t('unresolveSuccess'));
    } catch (err) {
      captureError(err, 'Failed to unresolve comment', { tags: { page: 'comments', action: 'unresolve' } });
      toast.error(tc('error'));
    }
  }, [queryClient, t, tc]);

  const exportToCSV = async () => {
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
      const { savedToFiles } = await downloadCSV(`comments_${format(new Date(), 'yyyy-MM-dd')}.csv`, headers, rows);
      toast.success(savedToFiles ? tc('exportSavedToFiles') : tc('export'));
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
        title={
          <InboxTitle
            title={t('title')}
            activePages={activePages}
            pageId={pageId}
            onPageChange={updatePageId}
          />
        }
        description={t('description')}
        action={
          <div className="flex items-center gap-1">
            {/* Lightweight ghost action — labeled on every breakpoint so the feature
                reads clearly on mobile and web (owner call). The ghost weight (vs the
                old filled block) keeps it from dominating the header even with the
                label always shown; the sky key carries the Post Reply identity,
                distinct from the icon-only Export beside it. */}
            <Button
              size="sm"
              variant="ghost"
              onClick={postReplySetup.openPicker}
              icon={<PostReplyIcon className={clsx('w-4 h-4 flex-shrink-0', postReplyIconClass)} aria-hidden="true" />}
              className="whitespace-nowrap"
            >
              {t('postReplyPickerButton')}
            </Button>
            <InboxExportButton onExport={exportToCSV} exporting={exporting} />
          </div>
        }
      />

      {/* First-run education: only before the merchant has set up any Post Reply,
          and only when there's an eligible post to configure. */}
      {showPostReplyNewBadge && firstTriggerableGroup && (
        <PostReplyIntroBanner
          onSetup={() => postReplySetup.open(firstTriggerableGroup.latestComment)}
        />
      )}

      {/* Filter Chips + Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 mb-3 sm:mb-5">
        <FilterChipBar
          ariaLabel={t('title')}
          activeKey={filter}
          onSelect={updateFilter}
          chips={[
            { key: 'needs_action' as FilterType, label: t('needsAction'), count: stats.actionRequired },
            { key: 'all' as FilterType, label: t('allComments'), count: stats.total },
            { key: 'auto_replied' as FilterType, label: t('autoReplied'), count: stats.autoReplied },
            { key: 'handled' as FilterType, label: t('handled'), count: stats.handled },
          ]}
        />

        <div role="search" aria-label={tc('search')} className="relative group w-full sm:w-[280px] sm:flex-none">
          <Search
            className="absolute top-1/2 -translate-y-1/2 start-3.5 w-4 h-4 text-muted-foreground group-focus-within:text-brand-500 transition-colors z-10"
          />
          <Input
            type="search"
            inputMode="search"
            autoComplete="off"
            aria-label={tc('search')}
            placeholder={tc('search') + '...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="py-2 ps-10 pe-10 rounded-full bg-muted/50 border-none focus:ring-2 focus:ring-brand-500/20 focus:bg-card transition-all text-sm"
          />
          {searchQuery.trim().length > 0 && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute top-1/2 -translate-y-1/2 end-2.5 p-2 rounded-full text-muted-foreground hover:text-muted-foreground hover:bg-muted transition-colors z-10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Grid / List view toggle */}
        <div
          role="group"
          aria-label={tc('view')}
          className="hidden sm:flex items-center gap-0.5 p-1 rounded-full bg-muted/50 flex-shrink-0"
        >
          {([
            { list: false, icon: LayoutGrid, label: t('viewGrid') },
            { list: true, icon: List, label: t('viewList') },
          ] as const).map(({ list, icon: Icon, label }) => {
            const active = listView === list;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setListView(list)}
                aria-pressed={active}
                aria-label={label}
                className={clsx(
                  'p-2 rounded-full transition-colors',
                  active ? 'bg-card shadow-sm text-brand-600' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Comments List */}
      {filteredGroups.length > 0 ? (
        <>
          <div
            className={clsx(
              "pb-4 sm:pb-6 transition-all duration-300 ease-out",
              listView ? "flex flex-col gap-3 sm:gap-4" : "columns-1 lg:columns-2 gap-3 sm:gap-4",
              isTransitioning ? "opacity-40 translate-y-2 scale-[0.99]" : "opacity-100 translate-y-0 scale-100"
            )}
          >
            {filteredGroups.map((group, i) => {
              const comment = group.latestComment;
              const page = comment.pageId ? pageById.get(comment.pageId) : undefined;
              const earlierComments = group.count > 1 ? group.comments.slice(1) : undefined;
              return (
                <div key={group.groupKey} className={clsx("break-inside-avoid", !listView && "mb-3 sm:mb-4")}>
                  <SwipeableCommentCard
                    comment={comment}
                    variant={listView ? 'compact' : 'full'}
                    pageName={page?.name}
                    showPlatformIcon={showPlatformIcon}
                    animationDelay={i < 10 ? i * 0.05 : 0}
                    onClick={() => openComment(comment)}
                    onQuickReply={() => openComment(comment)}
                    onResolve={!comment.resolved ? () => handleResolve(comment.id) : undefined}
                    onUnresolve={comment.resolved ? () => handleUnresolve(comment.id) : undefined}
                    groupCount={group.count}
                    earlierComments={earlierComments}
                    isExpanded={expandedGroups.has(group.groupKey)}
                    onToggleExpand={() => toggleExpand(group.groupKey)}
                    onTriggerClick={comment.postId ? () => postReplySetup.open(comment) : undefined}
                    triggerActive={comment.postId ? !!triggersByPostId[comment.postId] : false}
                    showNewBadge={group.groupKey === newBadgeGroupKey}
                  />
                </div>
              );
            })}
          </div>

          {/* Infinite Scroll Trigger / Load More */}
          <div ref={loadMoreRef} className="pb-12">
            {isFetchingNextPage ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-brand-500 animate-spin" />
                <span className="ms-2.5 text-sm text-muted-foreground">{tc('loading')}...</span>
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
              <div className="text-center py-8 text-xs text-subtle">
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
          onClose={closeComment}
          onReplySuccess={() => refetch()}
          onResolve={!selectedComment.resolved ? () => handleResolve(selectedComment.id) : undefined}
          onUnresolve={selectedComment.resolved ? () => handleUnresolve(selectedComment.id) : undefined}
          pageName={selectedComment.pageId ? pageById.get(selectedComment.pageId)?.name : undefined}
          pageUrl={selectedCommentPageUrl}
          postTrigger={selectedComment.postId ? triggersByPostId[selectedComment.postId] ?? null : null}
          // Post Reply is post-scoped: rather than stack a second modal inside this
          // URL-driven detail modal (z-index + routing conflicts), transition to the
          // shared config modal (usePostReplySetup) — open it, then close the detail.
          onSetupPostReply={async () => { if (await postReplySetup.open(selectedComment)) closeComment(); }}
          onPrev={goToPrevComment}
          onNext={goToNextComment}
          hasPrev={navIndex > 0}
          hasNext={navIndex >= 0 && navIndex < navComments.length - 1}
        />
      )}

      {postReplySetup.modal}
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
