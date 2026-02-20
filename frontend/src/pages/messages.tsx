import React, { useState, useEffect, useCallback, type ReactElement, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { useRouter } from 'next/router';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button, Input, PageHeader, PageSkeleton } from '@/components/ui';
import { MessageCard, type Conversation } from '@/components/messages';
import { MessageDetailModal } from '@/components/messages/MessageDetailModal';
import { useAuthStore } from '@/lib/store';
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
} from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { format } from 'date-fns';
import { downloadCSV, formatDateForExport } from '@/utils/csvExport';
import { captureError } from '@/lib/sentryHelpers';
import type { NextPageWithLayout } from './_app';
import { useEscapeKey } from '@/hooks/useEscapeKey';

type FilterType = 'needs_action' | 'all' | 'auto_replied';

// Map frontend filters to API params
function getApiParams(filter: FilterType): MessagesQueryParams {
  switch (filter) {
    case 'needs_action':
      return { replied: false, resolved: false };
    case 'auto_replied':
      return { replied: true };
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

const MESSAGES_PER_PAGE = 50;

const MessagesPage: NextPageWithLayout = () => {
  const { t, language, dateLocale } = useTranslation();
  const { isAuthenticated } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [filter, setFilter] = useState<FilterType>('needs_action');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [exporting, setExporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Infinite scroll observer ref
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // ESC key to close modal
  useEscapeKey(() => setSelectedConversation(null), !!selectedConversation);

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

  // Update internal filter when URL changes
  useEffect(() => {
    const currentParam = searchParams.get('filter');
    if (currentParam && ['all', 'auto_replied'].includes(currentParam)) {
      setFilter(currentParam as FilterType);
    } else {
      setFilter('needs_action');
    }
  }, [searchParams]);

  // API params derived from current filter
  const apiParams = useMemo(() => getApiParams(filter), [filter]);

  // Manual reply mutation
  const sendReplyMutation = useMutation({
    mutationFn: async ({ messageId, text }: { messageId: string; text: string }) => {
      const res = await messagesApi.reply(messageId, text);
      return res.data;
    },
    onSuccess: (outgoingMessage) => {
      if (selectedConversation) {
        setSelectedConversation({
          ...selectedConversation,
          messages: [...selectedConversation.messages, outgoingMessage],
          lastMessage: outgoingMessage,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['messages-stats'] });
      toast.success(t('messages.replySent' as TranslationKey));
    },
    onError: (error: Error) => {
      toast.error(error.message || t('messages.replyFailed' as TranslationKey));
    },
  });

  // Pause/Resume conversation mutations
  const pauseMutation = useMutation({
    mutationFn: async ({ senderId, pageId }: { senderId: string; pageId: string }) => {
      const res = await messagesApi.pauseConversation(senderId, pageId);
      return res.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pause-status', variables.senderId] });
      if (selectedConversation) {
        setSelectedConversation({
          ...selectedConversation,
          pauseStatus: { paused: true, pausedUntil: _data.pausedUntil, remainingMinutes: null },
        });
      }
      toast.success(t('messages.pauseSuccess' as TranslationKey), { id: 'smart-reply-status' });
    },
    onError: () => {
      toast.error(t('messages.pauseFailed' as TranslationKey), { id: 'smart-reply-status' });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async ({ senderId, pageId }: { senderId: string; pageId: string }) => {
      const res = await messagesApi.resumeConversation(senderId, pageId);
      return res.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pause-status', variables.senderId] });
      if (selectedConversation) {
        setSelectedConversation({
          ...selectedConversation,
          pauseStatus: { paused: false, pausedUntil: null, remainingMinutes: null },
        });
      }
      toast.success(t('messages.resumeSuccess' as TranslationKey), { id: 'smart-reply-status' });
    },
    onError: () => {
      toast.error(t('messages.resumeFailed' as TranslationKey), { id: 'smart-reply-status' });
    },
  });

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
    refetchInterval: 30000,
  });

  const stats = useMemo(() => {
    if (statsData) {
      return {
        total: statsData.total,
        pending: statsData.pending,
        autoReplied: statsData.autoReplied ?? 0,
        needsAction: statsData.pending,
      };
    }
    return { total: 0, pending: 0, autoReplied: 0, needsAction: 0 };
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

  // Check if a conversation needs human attention
  const checkConversationNeedsAttention = useCallback((msgs: Message[]): boolean => {
    // Check backend flags first
    if (msgs.some(m => m.needsAttention && !m.replied)) return true;

    // Fallback: client-side keyword check for messages predating the flagging system
    const lastIncoming = [...msgs].filter(m => m.direction === 'incoming').sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];

    if (lastIncoming && !lastIncoming.replied) {
      const helpKeywords = ['human', 'agent', 'help', 'support', 'talk to someone', 'مساعدة', 'بشري', 'شخص', 'موظف'];
      const messageText = lastIncoming.message.toLowerCase();
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
    return `https://facebook.com/${page.facebookPageId}`;
  }, [selectedConversation, pages]);

  // Fetch pause status when a conversation is selected
  useEffect(() => {
    if (!selectedConversation) return;
    const pageId = selectedConversation.lastMessage.pageId;
    if (!pageId) return;
    messagesApi.getPauseStatus(selectedConversation.senderId, pageId)
      .then(res => {
        setSelectedConversation(prev => prev ? { ...prev, pauseStatus: res.data } : null);
      })
      .catch(() => { /* ignore — pause status is optional */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversation?.senderId]);

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

  // Resolve conversation handler
  const handleResolve = useCallback(async (senderId: string, pageId: string) => {
    try {
      await messagesApi.resolveConversation(senderId, pageId);
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['messages-stats'] });
      toast.success(t('messages.resolveSuccess' as TranslationKey));
      // Close modal if the resolved conversation is open
      if (selectedConversation?.senderId === senderId) {
        setSelectedConversation(null);
      }
    } catch {
      toast.error(t('common.error' as TranslationKey));
    }
  }, [queryClient, t, selectedConversation]);

  // CSV Export
  const exportToCSV = () => {
    setExporting(true);
    try {
      const headers = [
        t('export.pageName'), t('export.contact'), t('export.message'),
        t('export.direction'), t('export.replied'), t('messages.resolved' as TranslationKey),
        t('export.reply'), t('export.method'), t('export.date'), t('export.repliedAt'),
      ];
      const rows = allMessages.map(msg => {
        const page = pages.find(p => p.id === msg.pageId);
        return [
          page?.name || '', msg.senderName || '', msg.message || '',
          msg.direction, msg.replied ? t('common.yes') : t('common.no'),
          msg.resolved ? t('common.yes') : t('common.no'),
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

  // Reply handler for modal
  const handleReply = useCallback((messageId: string, text: string) => {
    sendReplyMutation.mutate({ messageId, text });
  }, [sendReplyMutation]);

  // Pause handler for modal
  const handlePause = useCallback((senderId: string, pageId: string) => {
    pauseMutation.mutate({ senderId, pageId });
  }, [pauseMutation]);

  // Resume handler for modal
  const handleResume = useCallback((senderId: string, pageId: string) => {
    resumeMutation.mutate({ senderId, pageId });
  }, [resumeMutation]);

  const emptyStateContent = useMemo(() => {
    if (searchQuery) {
      return { icon: Search, iconClass: 'text-surface-300', bgClass: 'bg-surface-100', title: t('common.noData'), subtitle: '' };
    }
    const config: Record<FilterType, { icon: React.ElementType; iconClass: string; bgClass: string; title: string; subtitle: string }> = {
      needs_action: {
        icon: CheckCircle,
        iconClass: 'text-emerald-400',
        bgClass: 'bg-emerald-50',
        title: t('messages.emptyNeedsAction' as TranslationKey),
        subtitle: t('messages.emptyNeedsActionSub' as TranslationKey),
      },
      all: {
        icon: MessageCircle,
        iconClass: 'text-surface-300',
        bgClass: 'bg-surface-100',
        title: t('messages.emptyAll' as TranslationKey),
        subtitle: t('messages.emptyAllSub' as TranslationKey),
      },
      auto_replied: {
        icon: Sparkles,
        iconClass: 'text-violet-400',
        bgClass: 'bg-violet-50',
        title: t('messages.emptyAutoReplied' as TranslationKey),
        subtitle: t('messages.emptyAutoRepliedSub' as TranslationKey),
      },
    };
    return config[filter];
  }, [filter, searchQuery, t]);

  if (isLoading && !data) {
    return <PageSkeleton type="list" />;
  }

  return (
    <>
      <PageHeader
        title={t('messages.title')}
        description={t('messages.description')}
        action={
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen(prev => !prev)}
              className="p-2 rounded-xl text-surface-500 hover:text-surface-700 hover:bg-surface-100 transition-colors"
              aria-label={t('common.export' as TranslationKey)}
              aria-expanded={menuOpen}
            >
              <MoreVertical className="w-5 h-5" />
            </button>
            {menuOpen && (
              <div className="absolute end-0 top-full mt-1 w-44 sm:w-48 bg-white rounded-xl shadow-lg ring-1 ring-surface-200/60 py-1 z-20 animate-in fade-in slide-in-from-top-2 duration-150">
                <button
                  onClick={() => { exportToCSV(); setMenuOpen(false); }}
                  disabled={exporting}
                  className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 text-sm text-surface-700 hover:bg-surface-50 transition-colors disabled:opacity-50"
                >
                  <Download className="w-4 h-4 flex-shrink-0" />
                  {t('comments.exportCSV')}
                </button>
              </div>
            )}
          </div>
        }
      />

      {/* Filter Chips + Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
        <div className="w-full sm:flex-1 sm:min-w-0 flex flex-wrap sm:flex-nowrap items-center gap-2 sm:overflow-x-auto pb-1 sm:pb-0">
          {([
            { key: 'needs_action' as FilterType, label: t('messages.needsAction' as TranslationKey), count: stats.needsAction },
            { key: 'all' as FilterType, label: t('messages.allMessages' as TranslationKey), count: stats.total },
            { key: 'auto_replied' as FilterType, label: t('messages.autoReplied' as TranslationKey), count: stats.autoReplied },
          ]).map(chip => (
            <button
              key={chip.key}
              onClick={() => updateFilter(chip.key)}
              aria-pressed={filter === chip.key}
              className={clsx(
                "flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap transition-all duration-200",
                filter === chip.key
                  ? "bg-brand-500 text-white shadow-sm shadow-brand-500/25"
                  : "bg-surface-100 text-surface-600 hover:bg-surface-200"
              )}
            >
              {chip.label}
              <span className={clsx(
                "text-xs tabular-nums",
                filter === chip.key ? "text-white/80" : "text-surface-400"
              )}>
                ({chip.count.toLocaleString()})
              </span>
            </button>
          ))}
        </div>

        <div role="search" aria-label={t('common.search')} className="relative group w-full sm:w-[300px] sm:flex-none">
          <Search
            className="absolute top-1/2 -translate-y-1/2 start-3.5 w-4.5 h-4.5 text-surface-400 group-focus-within:text-brand-500 transition-colors z-10"
          />
          <Input
            type="search"
            inputMode="search"
            autoComplete="off"
            aria-label={t('common.search')}
            placeholder={t('common.search') + '...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="py-2.5 ps-10 pe-10 rounded-full bg-surface-50 border-none focus:ring-2 focus:ring-brand-500/20 focus:bg-white transition-all text-sm"
          />
          {searchQuery.trim().length > 0 && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute top-1/2 -translate-y-1/2 end-2.5 p-1 rounded-full text-surface-400 hover:text-surface-600 hover:bg-surface-100 transition-colors z-10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Conversations count hint - clarifies that tab counts refer to messages, not conversations */}
      {conversations.length > 0 && conversations.length !== allMessages.length && (
        <p className="text-xs text-surface-400 mb-3 -mt-2">
          {conversations.length === 1
            ? t('messages.oneConversation' as TranslationKey)
            : t('messages.conversationCount' as TranslationKey).replace('{count}', String(conversations.length))
          }
        </p>
      )}

      {/* Conversations Grid */}
      {conversations.length > 0 ? (
        <>
          <div
            className={clsx(
              "grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8 pb-8 transition-all duration-300 ease-out",
              isTransitioning ? "opacity-40 translate-y-2 scale-[0.99]" : "opacity-100 translate-y-0 scale-100"
            )}
          >
            {conversations.map((conv, i) => {
              const hasUnresolvedUnreplied = conv.messages.some(
                m => m.direction === 'incoming' && !m.replied && !m.resolved
              );
              return (
                <MessageCard
                  key={conv.senderId}
                  conversation={conv}
                  animationDelay={i < 10 ? i * 0.05 : 0}
                  onClick={() => setSelectedConversation(conv)}
                  onResolve={hasUnresolvedUnreplied ? () => handleResolve(conv.senderId, conv.lastMessage.pageId) : undefined}
                />
              );
            })}
          </div>

          {/* Load More Trigger */}
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
            ) : conversations.length > 0 ? (
              <div className="text-center py-8 text-sm text-surface-400">
                <Check className="w-3.5 h-3.5 inline-block" /> {t('common.allLoaded')}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="rounded-2xl bg-white shadow-md shadow-surface-200/20 p-6 sm:p-10">
          <div className="py-6 sm:py-10 text-center">
            <div className={`w-20 h-20 rounded-2xl ${emptyStateContent.bgClass} flex items-center justify-center mx-auto mb-5`}>
              <emptyStateContent.icon className={`w-10 h-10 ${emptyStateContent.iconClass}`} />
            </div>
            <p className="text-base font-semibold text-surface-700">{emptyStateContent.title}</p>
            {emptyStateContent.subtitle && (
              <p className="text-sm text-surface-400 mt-1">{emptyStateContent.subtitle}</p>
            )}
          </div>
        </div>
      )}

      {/* Conversation Detail Modal */}
      {selectedConversation && (
        <MessageDetailModal
          conversation={selectedConversation}
          onClose={() => setSelectedConversation(null)}
          onReply={handleReply}
          onResolve={handleResolve}
          onPause={handlePause}
          onResume={handleResume}
          isReplying={sendReplyMutation.isPending}
          isPausing={pauseMutation.isPending}
          isResuming={resumeMutation.isPending}
          dateLocale={dateLocale}
          pageName={selectedPageName}
          pageUrl={selectedPageUrl}
        />
      )}
    </>
  );
};

MessagesPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Messages">{page}</DashboardLayout>
);

export default MessagesPage;
