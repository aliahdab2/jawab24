import React, { useState, useEffect, useCallback, type ReactElement, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { useInfiniteQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Badge, Input, PageHeader, PageSkeleton } from '@/components/ui';
import { useAuthStore } from '@/lib/store';
import { messagesApi, type MessagesQueryParams, type Message } from '@/lib/api';
import {
  MessageCircle,
  Search,
  Bot,
  Clock,
  CheckCircle,
  User,
  ArrowUpRight,
  ArrowDownLeft,
  X,
  Download,
  AlertTriangle,
  UserCheck,
  ChevronRight,
  Sparkles,
  Loader2
} from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { formatDistanceToNow, format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import type { NextPageWithLayout } from './_app';
import { useEscapeKey } from '@/hooks/useEscapeKey';

type FilterType = 'all' | 'incoming' | 'outgoing' | 'needs_attention';

interface Conversation {
  senderId: string;
  senderName: string | null;
  messages: Message[];
  lastMessage: Message;
  needsHumanAttention: boolean;
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
  const { t, language } = useTranslation();
  const { isAuthenticated } = useAuthStore();
  
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [filter, setFilter] = useState<FilterType>('all');
  const [stats, setStats] = useState({ total: 0, replied: 0, pending: 0 });
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [exporting, setExporting] = useState(false);

  // Infinite scroll observer ref
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // ESC key to close modal
  useEscapeKey(() => setSelectedConversation(null), !!selectedConversation);

  // Fetch Stats
  const fetchStats = useCallback(async () => {
    try {
      const response = await messagesApi.getStats();
      setStats(response.data);
    } catch (error) {
      console.error('Failed to fetch message stats:', error);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchStats();
    }
  }, [isAuthenticated, fetchStats]);

  // Infinite Query
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['messages', filter], // Refresh when filter changes? Or keep all calls generic?
    // We should probably pass the 'direction' filter to the backend if possible to optimize
    // 'needs_attention' must be client side. 'all' is default.
    queryFn: async ({ pageParam }) => {
      const params: MessagesQueryParams = {
        limit: MESSAGES_PER_PAGE,
        cursor: pageParam as string | undefined,
      };

      if (filter === 'incoming' || filter === 'outgoing') {
        params.direction = filter;
      }
      
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
    // Sort logic handled in formatting, but here input might be unsorted depending on group logic
    const lastIncoming = [...msgs].filter(m => m.direction === 'incoming').sort((a,b) => 
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
      
      const msgDate = new Date(msg.createdAt).getTime();
      const lastMsgDate = new Date(acc[key].lastMessage.createdAt).getTime();
      
      if (msgDate > lastMsgDate) {
        acc[key].lastMessage = msg;
      }
      return acc;
    }, {} as Record<string, Conversation>);

    // 3. Apply Conversation-level filters (Needs Attention) and Sort
    let convList = Object.values(groups).map(conv => {
       conv.needsHumanAttention = checkConversationNeedsAttention(conv.messages);
       return conv;
    });

    if (filter === 'needs_attention') {
      convList = convList.filter(c => c.needsHumanAttention);
    }
    // Note: 'incoming'/'outgoing' filters are applied at API level, so allMessages already filtered
    // But if we switch filter, the queryKey changes, so data reloads. Correct.

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
      const headers = ['ID', 'Sender ID', 'Sender Name', 'Message', 'Direction', 'Replied', 'Reply Text', 'Reply Method', 'Created At'];
      const rows = allMessages.map(msg => [
        msg.id, msg.senderId, msg.senderName || '', `"${(msg.message || '').replace(/"/g, '""')}"`,
        msg.direction, msg.replied ? 'Yes' : 'No', `"${(msg.replyText || '').replace(/"/g, '""')}"`,
        msg.replyMethod || '', msg.createdAt ? new Date(msg.createdAt).toISOString() : ''
      ]);
      const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
      const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `messages_${format(new Date(), 'yyyy-MM-dd')}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setExporting(false);
    }
  };

  const formatTime = (dateValue: string | Date | null | undefined) => {
    if (!dateValue) return '-';
    try {
      return formatDistanceToNow(new Date(dateValue), {
        addSuffix: true,
        locale: language === 'ar' ? ar : enUS
      });
    } catch {
      return String(dateValue);
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

  const needsAttentionCount = conversations.filter(c => c.needsHumanAttention).length;

  const StatCard = ({ title, value, icon, color }: { title: string; value: number; icon: React.ReactNode; color: string }) => (
    <Card
      className="border-none hover:shadow-xl transition-all duration-300 hover:-translate-y-1 group relative overflow-hidden"
      padding="none"
      style={{ boxShadow: '0 10px 30px rgba(0,0,0,0.04)' }}
    >
      <div className={clsx(
        "absolute -end-4 -bottom-4 w-16 h-16 rounded-full opacity-[0.06] transition-all duration-700 group-hover:scale-125 group-hover:opacity-[0.1]",
        color === 'brand' ? 'bg-brand-500' :
          color === 'emerald' ? 'bg-emerald-500' :
            color === 'amber' ? 'bg-amber-500' :
              'bg-red-500'
      )}></div>

      <div className="px-4 py-4 sm:px-5 sm:py-5 flex items-center justify-between relative z-10">
        <div>
          <p className="text-[24px] sm:text-[28px] font-bold text-surface-900 leading-none tracking-tight mb-1.5">
            {value.toLocaleString()}
          </p>
          <p className="text-[10px] sm:text-xs font-bold text-surface-500 uppercase tracking-widest truncate leading-tight opacity-70">{title}</p>
        </div>
        <div className={clsx(
          "w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shadow-lg transition-all duration-500 group-hover:scale-110 group-hover:rotate-6",
          color === 'brand' ? 'bg-brand-50 text-brand-600 shadow-brand-500/10' :
            color === 'emerald' ? 'bg-emerald-50 text-emerald-600 shadow-emerald-500/10' :
              color === 'amber' ? 'bg-amber-50 text-amber-600 shadow-amber-500/10' :
                'bg-red-50 text-red-600 shadow-red-500/10'
        )}>
          {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<{ className?: string }>, {
            className: 'w-6 h-6 sm:w-7 sm:h-7'
          }) : icon}
        </div>
      </div>
    </Card>
  );

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

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-8">
        <div onClick={() => setFilter('all')} className="cursor-pointer transition-transform active:scale-95">
          <StatCard title={t('messages.totalMessages')} value={stats.total} icon={<MessageCircle />} color="brand" />
        </div>
        <div className="cursor-default">
          <StatCard title={t('comments.replied')} value={stats.replied} icon={<CheckCircle />} color="emerald" />
        </div>
        <div className="cursor-default">
          <StatCard title={t('comments.pending')} value={stats.pending} icon={<Clock />} color="amber" />
        </div>
        <div onClick={() => setFilter('needs_attention')} className="cursor-pointer transition-transform active:scale-95">
          <StatCard title={t('comments.needsAttention')} value={needsAttentionCount} icon={<AlertTriangle />} color="red" />
        </div>
      </div>

      {/* Filters & Search */}
      <Card className="mb-8 border-none shadow-md shadow-surface-200/20 overflow-visible" padding="none">
        <div className="p-5 sm:p-7 flex flex-col gap-5">
          <div className="relative group">
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
        </div>
      </Card>

      {/* Conversations List */}
      {conversations.length > 0 ? (
        <>
        <div className="space-y-4 pb-12">
          {conversations.map((conv, i) => (
            <Card
              key={conv.senderId}
              hover
              className={clsx(
                "animate-slide-up group/card cursor-pointer border-none shadow-sm hover:shadow-lg transition-all duration-300 rounded-2xl overflow-hidden relative",
                conv.needsHumanAttention && 'ring-1 ring-red-100'
              )}
              style={{ animationDelay: `${Math.min(i, 10) * 0.05}s` } as React.CSSProperties}
              onClick={() => setSelectedConversation(conv)}
            >
              {/* Left Accent Bar */}
              <div className={clsx(
                  "absolute inset-y-0 start-0 w-1 transition-all duration-300",
                  conv.lastMessage.replied || conv.lastMessage.direction === 'outgoing' ? "bg-emerald-500" : "bg-amber-500",
                  conv.needsHumanAttention && "bg-red-500 w-1.5"
              )} />

              <div className="p-4 sm:p-5">
                <div className="flex flex-col gap-3">
                   {/* Header: Name, Count, Time */}
                   <div className="flex items-start justify-between gap-4">
                      <div className="flex flex-col gap-1">
                          <h3 className="font-bold text-surface-900 text-base">
                             {conv.senderName || t('common.user' as TranslationKey)}
                          </h3>
                          <div className="flex items-center gap-2 text-xs text-surface-400">
                             <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatTime(conv.lastMessage.createdAt)}
                             </div>
                             <span className="text-surface-300">•</span>
                             <span>{t('messages.msgCount' as TranslationKey, { count: conv.messages.length })}</span>
                          </div>
                      </div>

                      {/* Status Badges */}
                      <div className="flex items-center gap-2">
                          {conv.needsHumanAttention ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-red-600 text-[10px] font-bold uppercase tracking-wider animate-pulse-soft">
                               <AlertTriangle className="w-3 h-3" />
                               {t('messages.needsHuman')}
                            </span>
                          ) : !conv.lastMessage.replied && conv.lastMessage.direction === 'incoming' && (
                             <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider">
                                <Clock className="w-3 h-3" />
                                {t('comments.pending')}
                             </span>
                          )}
                      </div>
                   </div>

                   {/* Message Preview */}
                   <div className="relative group/box mt-1">
                      <div className="absolute -top-1.5 start-6 w-3 h-3 bg-surface-50 rotate-45 border-t border-l border-surface-100/60 z-0"></div>
                      
                      <div className="relative z-10 p-4 bg-surface-50 rounded-2xl rounded-tl-sm border border-surface-100/60 transition-colors group-hover/card:bg-brand-50/30 group-hover/card:border-brand-100/30">
                         <div className="flex items-start gap-3">
                            {conv.lastMessage.direction === 'incoming' ? (
                              <ArrowDownLeft className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                            ) : (
                              <ArrowUpRight className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                            )}
                            <p className="text-surface-700 text-sm leading-relaxed italic-arabic line-clamp-2">
                               {conv.lastMessage.message}
                            </p>
                         </div>
                      </div>
                   </div>

                   {/* Reply Hint */}
                   <div className="flex items-center justify-end mt-1">
                       <div className="flex items-center gap-1 text-xs font-bold text-brand-600 opacity-0 group-hover/card:opacity-100 transition-opacity transform translate-y-1 group-hover/card:translate-y-0 duration-300">
                          <span>{t('comments.reply')}</span>
                          <ChevronRight className={clsx(
                            "w-4 h-4 transition-transform",
                            language === 'ar' && "rotate-180"
                          )} />
                       </div>
                   </div>
                </div>
              </div>
            </Card>
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
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner ${selectedConversation.needsHumanAttention ? 'bg-red-100 text-red-600' : 'bg-brand-100 text-brand-600'
                  }`}>
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
                onClick={() => setSelectedConversation(null)}
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
                  <div className={`flex items-center gap-2 mt-1.5 text-[10px] font-bold uppercase tracking-tighter ${msg.direction === 'outgoing' ? 'text-brand-500' : 'text-surface-400'
                    }`}>
                    <span>{formatFullTime(msg.createdAt)}</span>
                    {msg.direction === 'outgoing' && msg.replyMethod && (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-surface-100 text-surface-600">
                        {msg.replyMethod === 'ai' ? (
                          <>
                            <Sparkles className="w-2.5 h-2.5" />
                            AI
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

            {/* Modal Footer */}
            <div className="p-6 border-t border-surface-100 bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-brand-600">
                  <Bot className="w-5 h-5" />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    {t('messages.aiAutomationActive')}
                  </span>
                </div>
                <Button variant="secondary" onClick={() => setSelectedConversation(null)} className="rounded-xl px-8">
                  {t('comments.close')}
                </Button>
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
