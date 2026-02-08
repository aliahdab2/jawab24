import React, { useState, useEffect, useCallback, type ReactElement, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Badge, Input, PageHeader, PageSkeleton } from '@/components/ui';
import { StatCard } from '@/components/dashboard/StatCard';
import { MessageCard, type Conversation } from '@/components/messages';
import { useAuthStore } from '@/lib/store';
import { messagesApi, pagesApi, type MessagesQueryParams, type Message } from '@/lib/api';
import type { Page } from '@jawab24/shared';
import {
  MessageCircle,
  Search,
  Bot,
  Clock,
  CheckCircle,
  User,
  X,
  Download,
  AlertTriangle,
  UserCheck,
  Sparkles,
  Zap,
  Loader2,
  Send
} from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { downloadCSV, formatDateForExport } from '@/utils/csvExport';
import type { NextPageWithLayout } from './_app';
import { useEscapeKey } from '@/hooks/useEscapeKey';

type FilterType = 'all' | 'pending' | 'ai' | 'template' | 'needs_attention' | 'replied_today';

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
  const { t, language } = useTranslation();
  const { isAuthenticated } = useAuthStore();

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [filter, setFilter] = useState<FilterType>('all');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [exporting, setExporting] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Infinite scroll observer ref
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // ESC key to close modal
  useEscapeKey(() => { setSelectedConversation(null); setReplyText(''); setSendError(null); }, !!selectedConversation);

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
      setReplyText('');
      setSendError(null);
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['messages-stats'] });
    },
    onError: (error: Error) => {
      setSendError(error.message || t('messages.replyFailed' as TranslationKey));
    },
  });

  const getReplyTargetMessageId = (conv: Conversation): string | null => {
    const incoming = conv.messages
      .filter(m => m.direction === 'incoming')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const unreplied = incoming.find(m => !m.replied);
    return unreplied?.id || incoming[0]?.id || null;
  };

  const handleSendReply = () => {
    if (!selectedConversation || !replyText.trim()) return;
    const targetId = getReplyTargetMessageId(selectedConversation);
    if (!targetId) return;
    sendReplyMutation.mutate({ messageId: targetId, text: replyText.trim() });
  };

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

  // Fetch Stats via useQuery (matches comments pattern)
  const { data: statsData } = useQuery({
    queryKey: ['messages-stats'],
    queryFn: async () => {
      const res = await messagesApi.getStats();
      return res.data;
    },
    enabled: isAuthenticated,
    refetchInterval: 30000,
  });

  // Infinite Query
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['messages'],
    queryFn: async ({ pageParam }) => {
      const params: MessagesQueryParams = {
        limit: MESSAGES_PER_PAGE,
        cursor: pageParam as string | undefined,
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

  // Process conversations
  const conversations = useMemo(() => {
    // 1. Filter raw messages first based on Search
    let filteredMsgs = allMessages;
    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase();
      filteredMsgs = allMessages.filter(m =>
        m.message.toLowerCase().includes(query) ||
        (m.senderName || '').toLowerCase().includes(query)
      );
    }

    // 2. Group by Sender
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
      // Use the first non-null sender name we find
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

    // 3. Apply Conversation-level filters and Sort
    let convList = Object.values(groups).map(conv => {
      conv.needsHumanAttention = checkConversationNeedsAttention(conv.messages);
      return conv;
    });

    // Apply filter
    if (filter === 'needs_attention') {
      convList = convList.filter(c => c.needsHumanAttention);
    } else if (filter === 'pending') {
      convList = convList.filter(c => !c.lastMessage.replied && c.lastMessage.direction === 'incoming');
    } else if (filter === 'ai') {
      convList = convList.filter(c => c.messages.some(m => m.direction === 'outgoing' && m.replyMethod === 'ai'));
    } else if (filter === 'template') {
      convList = convList.filter(c => c.messages.some(m => m.direction === 'outgoing' && m.replyMethod === 'template'));
    } else if (filter === 'replied_today') {
      convList = convList.filter(c => {
        const lastOutgoing = c.messages.find(m => m.direction === 'outgoing');
        if (!lastOutgoing?.createdAt) return false;
        const d = new Date(lastOutgoing.createdAt);
        const now = new Date();
        return d.toDateString() === now.toDateString();
      });
    }

    // 4. Sort by latest message
    return convList.sort((a, b) => {
      const dateA = new Date(a.lastMessage.createdAt).getTime();
      const dateB = new Date(b.lastMessage.createdAt).getTime();
      return dateB - dateA;
    });

  }, [allMessages, debouncedSearch, filter, checkConversationNeedsAttention]);

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

  // CSV Export
  const exportToCSV = () => {
    setExporting(true);
    try {
      const headers = [
        t('export.pageName'), t('export.contact'), t('export.message'),
        t('export.direction'), t('export.replied'), t('export.reply'),
        t('export.method'), t('export.date'), t('export.repliedAt'),
      ];
      const rows = allMessages.map(msg => {
        const page = pages.find(p => p.id === msg.pageId);
        return [
          page?.name || '', msg.senderName || '', msg.message || '',
          msg.direction, msg.replied ? t('common.yes') : t('common.no'),
          msg.replyText || '', msg.replyMethod || '',
          formatDateForExport(msg.createdAt, language),
          formatDateForExport(msg.repliedAt, language),
        ];
      });
      downloadCSV(`messages_${format(new Date(), 'yyyy-MM-dd')}.csv`, headers, rows);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setExporting(false);
    }
  };

  const formatFullTime = (dateValue: string | Date | null | undefined) => {
    if (!dateValue) return '-';
    try {
      return format(new Date(dateValue), 'PPp', { locale: language === 'ar' ? ar : enUS });
    } catch {
      return String(dateValue);
    }
  };

  const getSortedMessages = (conv: Conversation) => {
    return [...conv.messages].sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateA - dateB;
    });
  };

  // Stats
  const needsAttentionCount = useMemo(() =>
    conversations.filter(c => c.needsHumanAttention).length
  , [conversations]);

  const stats = useMemo(() => {
    if (statsData) {
      return {
        total: statsData.total,
        pending: statsData.pending,
        replied: statsData.replied,
        aiReplies: statsData.byMethod?.ai ?? 0,
        templateReplies: statsData.byMethod?.template ?? 0,
        needsAttention: needsAttentionCount,
        repliedToday: 0,
      };
    }
    return { total: 0, pending: 0, replied: 0, aiReplies: 0, templateReplies: 0, needsAttention: 0, repliedToday: 0 };
  }, [statsData, needsAttentionCount]);

  // Filter transition
  const updateFilter = useCallback((newFilter: FilterType) => {
    if (newFilter === filter) return;
    setIsTransitioning(true);
    setTimeout(() => {
      setFilter(newFilter);
      setIsTransitioning(false);
    }, 120);
  }, [filter]);

  // Filter chip label
  const getFilterChipLabel = (filterType: FilterType) => {
    switch (filterType) {
      case 'template': return t('dashboard.templateReply');
      case 'ai': return t('dashboard.aiReply');
      case 'pending': return t('comments.pending');
      case 'needs_attention': return t('comments.needsAttention');
      case 'replied_today': return t('comments.repliedToday');
      default: return '';
    }
  };

  if (isLoading && !data) {
    return <PageSkeleton type="list" />;
  }

  return (
    <>
      <PageHeader
        title={t('messages.title')}
        description={t('messages.description')}
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
      <div className={clsx(
        "grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mb-12",
        stats.pending > 0 ? "lg:grid-cols-6" : "lg:grid-cols-5"
      )}>
        <div onClick={() => updateFilter('all')}>
          <StatCard
            nameKey="messages.totalMessages"
            value={stats.total.toLocaleString()}
            icon={MessageCircle}
            color="brand"
            index={0}
            isActive={filter === 'all'}
          />
        </div>
        {stats.pending > 0 && (
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
        )}
        <div>
          <StatCard
            nameKey="comments.replied"
            value={stats.replied.toLocaleString()}
            icon={CheckCircle}
            color="emerald"
            index={2}
            isActive={false}
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
          {/* Search Input */}
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

          {/* Active Filter Chip */}
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

          {/* Conversation Counter */}
          {conversations.length > 0 && (
            <div className="hidden md:flex items-center gap-2 text-[10px] font-bold text-surface-400 uppercase tracking-widest whitespace-nowrap">
              <span>{conversations.length} {t('messages.title')}</span>
              {hasNextPage && <span className="text-brand-500">+</span>}
            </div>
          )}
        </div>
      </Card>

      {/* Conversations Grid */}
      {conversations.length > 0 ? (
        <>
          <div
            className={clsx(
              "grid grid-cols-1 lg:grid-cols-2 gap-8 pb-8 transition-all duration-300 ease-out",
              isTransitioning ? "opacity-40 translate-y-2 scale-[0.99]" : "opacity-100 translate-y-0 scale-100"
            )}
          >
            {conversations.map((conv, i) => (
              <MessageCard
                key={conv.senderId}
                conversation={conv}
                animationDelay={i < 10 ? i * 0.05 : 0}
                onClick={() => setSelectedConversation(conv)}
              />
            ))}
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
                ✓ {t('common.allLoaded')}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <Card className="border-none shadow-md shadow-surface-200/20 rounded-2xl" padding="lg">
          <div className="py-10 text-center">
            <div className="w-16 h-16 rounded-2xl bg-surface-100 flex items-center justify-center mx-auto mb-4">
              <MessageCircle className="w-8 h-8 text-surface-300 opacity-60" />
            </div>
            <p className="text-base font-semibold text-surface-600 mb-2">
              {searchQuery ? t('common.noData') : t('messages.noMessages' as TranslationKey)}
            </p>
          </div>
        </Card>
      )}

      {/* Conversation Detail Modal */}
      {selectedConversation && (
        <div className="fixed inset-0 bg-surface-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-scale-in">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-surface-100">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner ${selectedConversation.needsHumanAttention ? 'bg-red-100 text-red-600' : 'bg-brand-100 text-brand-600'}`}>
                  <User className="w-6 h-6" />
                </div>
                <div className="text-start">
                  <h2 className="text-xl font-bold text-surface-900 leading-tight">
                    {selectedConversation.senderName || t('common.user' as TranslationKey)}
                  </h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] font-bold text-surface-400 uppercase tracking-widest text-start">
                      {t('messages.msgCount' as TranslationKey, { count: selectedConversation.messages.length })}
                    </span>
                    {selectedConversation.needsHumanAttention && (
                      <Badge variant="warning" size="sm">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        {t('messages.needsHuman')}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => { setSelectedConversation(null); setReplyText(''); setSendError(null); }}
                className="p-2.5 rounded-xl hover:bg-surface-100 text-surface-400 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-surface-50/50">
              {getSortedMessages(selectedConversation).map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.direction === 'outgoing' ? 'items-end' : 'items-start'}`}
                >
                  <div className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${msg.direction === 'outgoing'
                    ? 'bg-brand-600 text-white rounded-br-none'
                    : 'bg-white text-surface-900 rounded-bl-none border border-surface-100'
                    }`}>
                    <p className="text-sm leading-relaxed italic-arabic">{msg.message}</p>
                  </div>
                  <div className={`flex items-center gap-2 mt-1.5 text-[10px] font-bold uppercase tracking-tighter ${msg.direction === 'outgoing' ? 'text-brand-500' : 'text-surface-400'}`}>
                    <span>{formatFullTime(msg.createdAt)}</span>
                    {msg.direction === 'outgoing' && msg.replyMethod && (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-surface-100 text-surface-600">
                        {msg.replyMethod === 'ai' ? (
                          <>
                            <Sparkles className="w-2.5 h-2.5" />
                            {t('dashboard.aiReply')}
                          </>
                        ) : msg.replyMethod === 'template' ? (
                          <>
                            <CheckCircle className="w-2.5 h-2.5" />
                            {t('dashboard.templateReply')}
                          </>
                        ) : (
                          <>
                            <UserCheck className="w-2.5 h-2.5" />
                            {t('common.manual' as TranslationKey)}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Modal Footer — Reply Input */}
            <div className="p-4 sm:p-6 border-t border-surface-100 bg-white flex-shrink-0">
              {sendError && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 text-red-600 text-xs font-medium">
                  {sendError}
                </div>
              )}
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <textarea
                    value={replyText}
                    onChange={(e) => { setReplyText(e.target.value); setSendError(null); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendReply();
                      }
                    }}
                    placeholder={t('messages.typeReply' as TranslationKey)}
                    rows={1}
                    className="w-full resize-none rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 text-sm text-surface-900 placeholder:text-surface-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:bg-white transition-all outline-none"
                    style={{ minHeight: '44px', maxHeight: '120px' }}
                    disabled={sendReplyMutation.isPending}
                  />
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSendReply}
                  loading={sendReplyMutation.isPending}
                  disabled={!replyText.trim() || sendReplyMutation.isPending}
                  className="rounded-xl px-4 h-[44px] flex-shrink-0"
                  icon={<Send className="w-4 h-4" />}
                >
                  {t('comments.reply')}
                </Button>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-1.5 text-surface-400">
                  <Bot className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    {t('messages.autoReplyWillPause' as TranslationKey)}
                  </span>
                </div>
                <button
                  onClick={() => { setSelectedConversation(null); setReplyText(''); setSendError(null); }}
                  className="text-xs text-surface-400 hover:text-surface-600 transition-colors font-medium"
                >
                  {t('comments.close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

MessagesPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Messages">{page}</DashboardLayout>
);

export default MessagesPage;
