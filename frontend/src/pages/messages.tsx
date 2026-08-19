import React, { useState, useEffect, useCallback, type ReactElement, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { useRouter } from 'next/router';
import { useInfiniteQuery, useQuery, keepPreviousData } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button, Input, PageHeader, PageSkeleton, EmptyState, FilterChipBar } from '@/components/ui';
import { InboxTitle, InboxExportButton } from '@/components/inbox/InboxHeaderActions';
import { SwipeableMessageCard, type Conversation } from '@/components/messages';
import dynamic from 'next/dynamic';

const MessageDetailModal = dynamic(() => import('@/components/messages/MessageDetailModal').then(m => ({ default: m.MessageDetailModal })), { ssr: false });
import { useAuthStore, useUIStore } from '@/lib/store';
import { useDebounce, useConversationActions, usePageFilter, useLoadConversation, useDeepLinkResource, useInfiniteScrollObserver } from '@/hooks';
import { messagesApi, pagesApi, type MessagesQueryParams, type Message } from '@/lib/api';
import type { Page } from '@jawab24/shared';
import {
  MessageCircle,
  Search,
  X,
  Check,
  CheckCircle,
  Sparkles,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { format } from 'date-fns';
import { downloadCSV, formatDateForExport } from '@/utils/csvExport';
import { captureError } from '@/lib/sentryHelpers';
import { getPageExternalUrl } from '@/utils/pageUrl';
import { hasMultipleActiveChannels } from '@/utils/channels';
import type { NextPageWithLayout } from './_app';
import { useEscapeKey } from '@/hooks/useEscapeKey';

import { type InboxFilterType, resolveInboxFilter, inboxFilterToApiParams } from '@/utils/inboxFilters';
type FilterType = InboxFilterType;
const resolveFilter = resolveInboxFilter;
const getApiParams = (filter: FilterType): MessagesQueryParams => inboxFilterToApiParams(filter);

const MESSAGES_PER_PAGE = 50;
const deepLinkErrorTag = { page: 'messages', action: 'deep-link' } as const;

const MessagesPage: NextPageWithLayout = () => {
  const t = useTranslations('messages');
  const tc = useTranslations('common');
  const tExport = useTranslations('export');
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
  const [exporting, setExporting] = useState(false);

  // Infinite scroll observer ref
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Fetch pages (must come before usePageFilter + URL sync that references syncFromUrl)
  const { data: pagesData = [] } = useQuery({
    queryKey: ['pages'],
    queryFn: async () => {
      const { data } = await pagesApi.getAll();
      return data;
    },
    enabled: isAuthenticated,
  });
  const pages = pagesData as Page[];
  const { pageId, activePages, updatePageId, syncFromUrl } = usePageFilter(pages);

  // Channel ribbons only make sense when the workspace actively runs more than one
  // channel — a single active channel (e.g. just Facebook) keeps a clean list.
  const showChannelBadge = useMemo(() => hasMultipleActiveChannels(pages), [pages]);

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

  // URL-driven modal open: ?conversation=<senderId> — back button / swipe-back pops
  // the entry naturally, which triggers setSelectedConversation(null) via the sync
  // effect below. Open adds a history entry via router.push; close uses router.back
  // if we pushed it, otherwise router.replace to strip the param (deep-link case).
  const pushedModalRef = useRef(false);
  const openConversation = useCallback((conv: Conversation) => {
    pushedModalRef.current = true;
    router.push(
      { pathname: router.pathname, query: { ...router.query, conversation: conv.senderId } },
      undefined,
      { shallow: true },
    );
  }, [router]);
  const closeConversation = useCallback(() => {
    if (pushedModalRef.current) {
      pushedModalRef.current = false;
      router.back();
    } else {
      const { conversation: _c, ...rest } = router.query;
      void _c;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }
  }, [router]);

  // API params derived from current filter + page
  const apiParams = useMemo(() => ({
    ...getApiParams(filter),
    ...(pageId && { pageId }),
  }), [filter, pageId]);

  // Conversation modal actions (reply, pause, resume, resolve, pause-status)
  const {
    selectedConversation,
    setSelectedConversation,
    handleReply,
    handleReplyToConversation,
    handlePause,
    handleResume,
    handleResolve,
    handleUnresolve,
    isReplying,
    isPausing,
    isResuming,
  } = useConversationActions({ extraInvalidateKeys: [['messages']] });

  // ESC key to close modal (goes through closeConversation so URL stays in sync)
  useEscapeKey(() => closeConversation(), !!selectedConversation);

  // Fetch Stats — scoped to the active page filter so chip counts match the list below.
  const { data: statsData } = useQuery({
    queryKey: ['messages-stats', pageId ?? null],
    queryFn: async () => {
      const res = await messagesApi.getStats(pageId ? { pageId } : undefined);
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
    placeholderData: keepPreviousData,
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

  // Deep-link: fetch the conversation directly by messageId (bypasses list pagination/filters).
  const loadConversation = useLoadConversation();
  const fetchConversationByMessageId = useCallback(async (messageId: string) => {
    const { data: locate } = await messagesApi.locateMessage(messageId);
    return loadConversation({ senderId: locate.senderId, pageId: locate.pageId, limit: 100 });
  }, [loadConversation]);
  // Deep-link opens: the fetched conversation likely isn't in the paginated list,
  // so stash it in pendingOpenRef and let the sync effect pick it up when
  // router.replace lands. This keeps the URL as the source of truth and avoids
  // the race where a premature setSelectedConversation would be cleared by the
  // sync effect before the URL caught up. router.replace (not push) since the
  // notification tap already created the history entry.
  const pendingOpenRef = useRef<Map<string, Conversation>>(new Map());
  const openDeepLinkedConversation = useCallback((conv: Conversation) => {
    pendingOpenRef.current.set(conv.senderId, conv);
    router.replace(
      { pathname: router.pathname, query: { ...router.query, conversation: conv.senderId } },
      undefined,
      { shallow: true },
    );
  }, [router]);
  useDeepLinkResource<Conversation>('messageId', {
    fetch: fetchConversationByMessageId,
    onOpen: openDeepLinkedConversation,
    notFoundMessage: t('deepLinkNotFound'),
    errorTag: deepLinkErrorTag,
  });

  // Sync modal state from URL (?conversation=<senderId>). Drives open via
  // click/deep-link AND close via browser back / swipe-back / hardware back.
  useEffect(() => {
    if (!router.isReady) return;
    const senderId = router.query.conversation as string | undefined;
    if (!senderId) {
      if (selectedConversation) setSelectedConversation(null);
      return;
    }
    if (selectedConversation?.senderId === senderId) return;
    const pending = pendingOpenRef.current.get(senderId);
    if (pending) {
      pendingOpenRef.current.delete(senderId);
      setSelectedConversation(pending);
      return;
    }
    const found = conversations.find(c => c.senderId === senderId);
    if (found) setSelectedConversation(found);
  }, [router.isReady, router.query.conversation, conversations, selectedConversation, setSelectedConversation]);

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
  const selectedPage = useMemo(
    () => selectedConversation
      ? pages.find(p => p.id === selectedConversation.lastMessage.pageId)
      : undefined,
    [selectedConversation, pages]
  );
  const selectedPageName = selectedPage?.name;
  const selectedPageUrl = useMemo(() => {
    if (!selectedPage) return undefined;
    const source = selectedConversation?.lastMessage.platform === 'instagram' ? 'instagram' : undefined;
    return getPageExternalUrl(selectedPage, source);
  }, [selectedPage, selectedConversation?.lastMessage.platform]);
  const selectedFacebookPageId = selectedPage?.facebookPageId ?? undefined;

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

  // (resolve handler provided by useConversationActions)

  // CSV Export
  const exportToCSV = async () => {
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
      const { savedToFiles } = await downloadCSV(`messages_${format(new Date(), 'yyyy-MM-dd')}.csv`, headers, rows);
      toast.success(savedToFiles ? tc('exportSavedToFiles') : tc('export'));
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
        title={
          <InboxTitle
            title={t('title')}
            activePages={activePages}
            pageId={pageId}
            onPageChange={updatePageId}
          />
        }
        description={t('description')}
        action={<InboxExportButton onExport={exportToCSV} exporting={exporting} />}
      />

      {/* Filter Chips + Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 mb-3 sm:mb-5">
        <FilterChipBar
          ariaLabel={t('title')}
          activeKey={filter}
          onSelect={updateFilter}
          chips={[
            { key: 'needs_action' as FilterType, label: t('needsAction'), count: stats.needsAction },
            { key: 'all' as FilterType, label: t('allMessages'), count: stats.total },
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
      </div>

      {/* Conversations count hint */}
      {conversations.length > 0 && (() => {
        const incomingCount = allMessages.filter(m => m.direction === 'incoming').length;
        return conversations.length !== incomingCount ? (
          <p className="text-xs text-subtle mb-3 -mt-1">
            {t('conversationCount', { count: conversations.length, msgCount: incomingCount })}
          </p>
        ) : null;
      })()}

      {/* Conversations List */}
      {conversations.length > 0 ? (
        <div className="max-w-4xl">
          <div
            className={clsx(
              "flex flex-col gap-1 sm:gap-1.5 pb-4 sm:pb-6 transition-all duration-300 ease-out",
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
                <SwipeableMessageCard
                  key={conv.senderId}
                  conversation={conv}
                  showChannelBadge={showChannelBadge}
                  animationDelay={i < 10 ? i * 0.05 : 0}
                  onClick={() => openConversation(conv)}
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
            ) : conversations.length > 0 ? (
              <div className="text-center py-8 text-xs text-subtle">
                <Check className="w-3.5 h-3.5 inline-block" /> {tc('allLoaded')}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="max-w-4xl rounded-2xl bg-card shadow-md shadow-surface-200/20">
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
          onClose={closeConversation}
          onReply={handleReply}
          onReplyToConversation={handleReplyToConversation}
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
          facebookPageId={selectedFacebookPageId}
          isInstagram={selectedConversation.lastMessage.platform === 'instagram'}
          platform={selectedConversation.lastMessage.platform ?? 'facebook'}
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
