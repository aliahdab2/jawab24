import React, { useState, useEffect, useCallback, type ReactElement, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { useRouter } from 'next/router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button, Input, PageHeader, PageSkeleton, EmptyState } from '@/components/ui';
import { MessageCard, type Conversation } from '@/components/messages';
import dynamic from 'next/dynamic';

const MessageDetailModal = dynamic(() => import('@/components/messages/MessageDetailModal').then(m => ({ default: m.MessageDetailModal })), { ssr: false });
import { useAuthStore, useUIStore } from '@/lib/store';
import { useDebounce, useConversationActions } from '@/hooks';
import { messagesApi, pagesApi, type MessagesQueryParams, type Message } from '@/lib/api';
import type { Page } from '@jawab24/shared';
import {
  MessageCircle,
  Search,
  X,
  Check,
  CheckCircle,
  Sparkles,
  Download,
  MoreVertical,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { format } from 'date-fns';
import { downloadCSV, formatDateForExport } from '@/utils/csvExport';
import { isNativePlatform } from '@/lib/capacitor';
import { captureError } from '@/lib/sentryHelpers';
import { getPageExternalUrl } from '@/utils/pageUrl';
import type { NextPageWithLayout } from './_app';
import { useEscapeKey } from '@/hooks/useEscapeKey';

import { type InboxFilterType, resolveInboxFilter, inboxFilterToApiParams } from '@/utils/inboxFilters';
type FilterType = InboxFilterType;
const resolveFilter = resolveInboxFilter;
const getApiParams = (filter: FilterType): MessagesQueryParams => inboxFilterToApiParams(filter);

const MESSAGES_PER_PAGE = 50;

const MessagesPage: NextPageWithLayout = () => {
  const t = useTranslations('messages');
  const tc = useTranslations('common');
  const tExport = useTranslations('export');
  const tComments = useTranslations('comments');
  const { language, dateLocale } = useLanguage();
  const { isAuthenticated } = useAuthStore();
  const resetUnreadMessages = useUIStore((s) => s.resetUnreadMessages);
  const router = useRouter();

  // Reset unread badge when visiting messages page
  useEffect(() => { resetUnreadMessages(); }, [resetUnreadMessages]);

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [filter, setFilter] = useState<FilterType>('needs_action');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const pendingDeepLinkRef = useRef<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Infinite scroll observer ref
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Close overflow menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
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
    const messageId = router.query.messageId as string | undefined;
    if (messageId) {
      pendingDeepLinkRef.current = messageId;
      setFilter('all');
      const params = new URLSearchParams(window.location.search);
      params.delete('messageId');
      params.delete('filter');
      router.replace({ pathname: router.pathname, query: Object.fromEntries(params) }, undefined, { shallow: true });
      return;
    }
    const currentParam = router.query.filter as string | undefined;
    setFilter(resolveFilter(currentParam));
  }, [router.isReady, router.query.filter, router.query.messageId, router]);

  // API params derived from current filter
  const apiParams = useMemo(() => getApiParams(filter), [filter]);

  // Conversation modal actions (reply, pause, resume, resolve, pause-status)
  const {
    selectedConversation,
    setSelectedConversation,
    handleReply,
    handlePause,
    handleResume,
    handleResolve,
    handleUnresolve,
    isReplying,
    isPausing,
    isResuming,
  } = useConversationActions({ extraInvalidateKeys: [['messages']] });

  // ESC key to close modal
  useEscapeKey(() => setSelectedConversation(null), !!selectedConversation);

  // Fetch pages for CSV page name resolution
  const { data: pagesData = [] } = useQuery({
    queryKey: ['pages'],
    queryFn: async () => {
      const { data } = await pagesApi.getAll();
      return data;
    },
    enabled: isAuthenticated,
  });
  const pages = pagesData as Page[];

  // Fetch Stats
  const { data: statsData } = useQuery({
    queryKey: ['messages-stats'],
    queryFn: async () => {
      const res = await messagesApi.getStats();
      return res.data;
    },
    enabled: isAuthenticated,
    // SSE handles real-time updates — no polling needed
  });

  const stats = useMemo(() => {
    if (statsData) {
      return {
        // Conversation counts for tab labels (matches what the user sees in the list)
        total: statsData.convTotal ?? statsData.total,
        autoReplied: statsData.convAutoReplied ?? statsData.autoReplied ?? 0,
        needsAction: statsData.convActionRequired ?? statsData.actionRequired ?? statsData.pending,
        handled: statsData.convHandled ?? statsData.resolved ?? 0,
        // Keep message-level pending for internal use
        pending: statsData.pending,
      };
    }
    return { total: 0, pending: 0, autoReplied: 0, needsAction: 0, handled: 0 };
  }, [statsData]);

  // Infinite Query — with server-side filter params
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['messages', apiParams],
    queryFn: async ({ pageParam }) => {
      const params: MessagesQueryParams = {
        limit: MESSAGES_PER_PAGE,
        cursor: pageParam as string | undefined,
        ...apiParams,
      };

      const response = await messagesApi.getAll(params);
      return response.data;
    },
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    enabled: isAuthenticated,
  });

  // Flatten messages
  const allMessages = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap(page => page.data);
  }, [data]);

  // Check if a conversation needs human attention (single-pass, no copy/sort)
  const checkConversationNeedsAttention = useCallback((msgs: Message[]): boolean => {
    let latestIncoming: Message | null = null;
    let latestIncomingTime = 0;

    for (const m of msgs) {
      // Check backend flags first
      if (m.needsAttention && !m.replied) return true;

      // Track latest incoming message in the same pass
      if (m.direction === 'incoming') {
        const time = m.createdAt ? new Date(m.createdAt).getTime() : 0;
        if (time > latestIncomingTime) {
          latestIncomingTime = time;
          latestIncoming = m;
        }
      }
    }

    // Fallback: client-side keyword check for messages predating the flagging system
    if (latestIncoming && !latestIncoming.replied) {
      const helpKeywords = ['human', 'agent', 'help', 'support', 'talk to someone', 'مساعدة', 'بشري', 'شخص', 'موظف'];
      const messageText = latestIncoming.message.toLowerCase();
      if (helpKeywords.some(kw => messageText.includes(kw))) {
        return true;
      }
    }
    return false;
  }, []);

  // Process conversations — grouping + search filter (server handles replied/resolved filtering)
  const conversations = useMemo(() => {
    let filteredMsgs = allMessages;
    const query = debouncedSearch.trim().toLowerCase();
    if (query) {
      filteredMsgs = allMessages.filter(m =>
        m.message.toLowerCase().includes(query) ||
        (m.senderName || '').toLowerCase().includes(query)
      );
    }

    // Group by Sender
    const groups = filteredMsgs.reduce((acc, msg) => {
      const key = msg.senderId;
      if (!acc[key]) {
        acc[key] = {
          senderId: msg.senderId,
          senderName: msg.senderName,
          messages: [],
          lastMessage: msg,
          needsHumanAttention: false,
        };
      }
      acc[key].messages.push(msg);
      if (!acc[key].senderName && msg.senderName) {
        acc[key].senderName = msg.senderName;
      }

      const msgDate = msg.createdAt ? new Date(msg.createdAt).getTime() : 0;
      const lastMsgDate = acc[key].lastMessage.createdAt ? new Date(acc[key].lastMessage.createdAt).getTime() : 0;

      if (msgDate > lastMsgDate) {
        acc[key].lastMessage = msg;
      }
      return acc;
    }, {} as Record<string, Conversation>);

    const convList = Object.values(groups).map(conv => {
      conv.needsHumanAttention = checkConversationNeedsAttention(conv.messages);
      return conv;
    });

    // Sort by latest message
    return convList.sort((a, b) => {
      const dateA = new Date(a.lastMessage.createdAt).getTime();
      const dateB = new Date(b.lastMessage.createdAt).getTime();
      return dateB - dateA;
    });

  }, [allMessages, debouncedSearch, checkConversationNeedsAttention]);

  // Deep-link: auto-select conversation after "all" data loads
  useEffect(() => {
    if (!pendingDeepLinkRef.current || isLoading || filter !== 'all') return;
    const targetId = pendingDeepLinkRef.current;
    const found = conversations.find(c =>
      c.messages.some(m => m.id === targetId)
    );
    if (found) {
      setSelectedConversation(found);
    } else if (allMessages.length > 0) {
      toast.info(t('deepLinkNotFound'));
    }
    pendingDeepLinkRef.current = null;
  }, [conversations, allMessages, isLoading, filter, t, setSelectedConversation]);

  // Live sync: when SSE invalidates the messages query, update the open conversation thread.
  // Only sync when server has MORE messages to avoid reverting optimistic updates from manual replies.
  useEffect(() => {
    if (!selectedConversation) return;
    const updated = conversations.find(c => c.senderId === selectedConversation.senderId);
    if (updated && updated.messages.length > selectedConversation.messages.length) {
      setSelectedConversation(updated);
    }
  }, [conversations, selectedConversation, setSelectedConversation]);

  // Resolved page name + URL for modal — avoids pages.find() in JSX on every render
  const selectedPageName = useMemo(
    () => selectedConversation
      ? pages.find(p => p.id === selectedConversation.lastMessage.pageId)?.name
      : undefined,
    [selectedConversation, pages]
  );

  const selectedPageUrl = useMemo(() => {
    if (!selectedConversation) return undefined;
    const page = pages.find(p => p.id === selectedConversation.lastMessage.pageId);
    if (!page) return undefined;
    return getPageExternalUrl(page);
  }, [selectedConversation, pages]);

  // Intersection Observer
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

  // (resolve handler provided by useConversationActions)

  // CSV Export
  const exportToCSV = () => {
    setExporting(true);
    try {
      const headers = [
        tExport('pageName'), tExport('contact'), tExport('message'),
        tExport('direction'), tExport('replied'), t('resolved'),
        tExport('reply'), tExport('method'), tExport('date'), tExport('repliedAt'),
      ];
      const rows = allMessages.map(msg => {
        const page = pages.find(p => p.id === msg.pageId);
        return [
          page?.name || '', msg.senderName || '', msg.message || '',
          msg.direction, msg.replied ? tc('yes') : tc('no'),
          msg.resolved ? tc('yes') : tc('no'),
          msg.replyText || '', msg.replyMethod || '',
          formatDateForExport(msg.createdAt, language),
          formatDateForExport(msg.repliedAt, language),
        ];
      });
      downloadCSV(`messages_${format(new Date(), 'yyyy-MM-dd')}.csv`, headers, rows);
    } catch (error) {
      captureError(error, 'Message export failed', { tags: { page: 'messages', action: 'export' } });
    } finally {
      setExporting(false);
    }
  };

  // (reply, pause, resume handlers provided by useConversationActions)

  type EmptyConfig = { icon: LucideIcon; variant: 'success' | 'empty' | 'search'; title: string; subtitle: string; iconColorClass?: string; iconBgClass?: string };

  const emptyStateContent = useMemo((): EmptyConfig => {
    if (searchQuery) {
      return { icon: Search, variant: 'search', title: tc('noData'), subtitle: '' };
    }
    const config: Record<FilterType, EmptyConfig> = {
      needs_action: {
        icon: CheckCircle,
        variant: 'success',
        title: t('emptyNeedsAction'),
        subtitle: t('emptyNeedsActionSub'),
      },
      all: {
        icon: MessageCircle,
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
    return config[filter];
  }, [filter, searchQuery, t, tc]);

  if (isLoading && !data) {
    return <PageSkeleton type="list" />;
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={!isNativePlatform() ? (
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
                  {tComments('exportCSV')}
                </button>
              </div>
            )}
          </div>
        ) : undefined}
      />

      {/* Filter Chips + Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
        <div className="w-full sm:flex-1 sm:min-w-0 flex flex-wrap items-center gap-2">
          {([
            { key: 'needs_action' as FilterType, label: t('needsAction'), count: stats.needsAction },
            { key: 'all' as FilterType, label: t('allMessages'), count: stats.total },
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
                  : "bg-muted text-muted-foreground hover:bg-muted"
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

      {/* Conversations count hint - clarifies that tab counts refer to messages, not conversations */}
      {conversations.length > 0 && (() => {
        const incomingCount = allMessages.filter(m => m.direction === 'incoming').length;
        return conversations.length !== incomingCount ? (
          <p className="text-xs text-muted-foreground mb-3 -mt-2">
            {t('conversationCount', { count: conversations.length, msgCount: incomingCount })}
          </p>
        ) : null;
      })()}

      {/* Conversations Grid */}
      {conversations.length > 0 ? (
        <>
          <div
            className={clsx(
              "grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 pb-4 sm:pb-6 transition-all duration-300 ease-out",
              isTransitioning ? "opacity-40 translate-y-2 scale-[0.99]" : "opacity-100 translate-y-0 scale-100"
            )}
          >
            {conversations.map((conv, i) => {
              const needsResolve = conv.messages.some(
                m => m.direction === 'incoming' && !m.resolved && (!m.replied || m.needsAttention)
              );
              const isResolved = conv.messages.some(
                m => m.direction === 'incoming' && m.resolved
              );
              return (
                <MessageCard
                  key={conv.senderId}
                  conversation={conv}
                  animationDelay={i < 10 ? i * 0.05 : 0}
                  onClick={() => setSelectedConversation(conv)}
                  onResolve={needsResolve ? () => handleResolve(conv.senderId, conv.lastMessage.pageId) : undefined}
                  onUnresolve={isResolved ? () => handleUnresolve(conv.senderId, conv.lastMessage.pageId) : undefined}
                />
              );
            })}
          </div>

          {/* Load More Trigger */}
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
            ) : conversations.length > 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <Check className="w-3.5 h-3.5 inline-block" /> {tc('allLoaded')}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="rounded-2xl bg-card shadow-md shadow-surface-200/20">
          <EmptyState
            icon={emptyStateContent.icon}
            variant={emptyStateContent.variant}
            title={emptyStateContent.title}
            description={emptyStateContent.subtitle || ''}
            iconColorClass={emptyStateContent.iconColorClass}
            iconBgClass={emptyStateContent.iconBgClass}
          />
        </div>
      )}

      {/* Conversation Detail Modal */}
      {selectedConversation && (
        <MessageDetailModal
          key={selectedConversation.senderId}
          conversation={selectedConversation}
          onClose={() => setSelectedConversation(null)}
          onReply={handleReply}
          onResolve={handleResolve}
          onUnresolve={handleUnresolve}
          onPause={handlePause}
          onResume={handleResume}
          isReplying={isReplying}
          isPausing={isPausing}
          isResuming={isResuming}
          dateLocale={dateLocale}
          pageName={selectedPageName}
          pageUrl={selectedPageUrl}
          isInstagram={false}
        />
      )}
    </>
  );
};

MessagesPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Messages">{page}</DashboardLayout>
);

export default MessagesPage;

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.messages]);
