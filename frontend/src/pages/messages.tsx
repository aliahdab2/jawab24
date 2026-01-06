import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Badge, Input, EmptyState, PageHeader, PageSpinner } from '@/components/ui';
import { useAuthStore } from '@/lib/store';
import axios from 'axios';
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
  Sparkles
} from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { formatDistanceToNow, format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { Message } from '@jawab24/shared';

type FilterType = 'all' | 'incoming' | 'outgoing' | 'needs_attention';

interface Conversation {
  senderId: string;
  senderName: string | null;
  messages: Message[];
  lastMessage: Message;
  needsHumanAttention: boolean;
}

export default function MessagesPage() {
  const { t, language } = useTranslation();
  const { token } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [stats, setStats] = useState({ total: 0, replied: 0, pending: 0 });
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [exporting, setExporting] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

  const fetchMessages = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const response = await axios.get(`${apiUrl}/messages`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessages(response.data);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    } finally {
      setLoading(false);
    }
  }, [token, apiUrl]);

  const fetchStats = useCallback(async () => {
    if (!token) return;
    try {
      const response = await axios.get(`${apiUrl}/messages/stats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStats(response.data);
    } catch (error) {
      console.error('Failed to fetch message stats:', error);
    }
  }, [token, apiUrl]);

  useEffect(() => {
    fetchMessages();
    fetchStats();
  }, [fetchMessages, fetchStats]);

  // Check if a conversation needs human attention
  const checkNeedsAttention = (msgs: Message[]): boolean => {
    const lastIncoming = msgs.filter(m => m.direction === 'incoming').slice(-1)[0];
    if (lastIncoming && !lastIncoming.replied) {
      const helpKeywords = ['human', 'agent', 'help', 'support', 'talk to someone', 'مساعدة', 'بشري', 'شخص', 'موظف'];
      const messageText = lastIncoming.message.toLowerCase();
      if (helpKeywords.some(kw => messageText.includes(kw))) {
        return true;
      }
    }
    return false;
  };

  const filteredMessages = messages.filter(message => {
    const matchesSearch = message.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (message.senderName || '').toLowerCase().includes(searchQuery.toLowerCase());
    if (filter === 'needs_attention') return matchesSearch;
    const matchesFilter = filter === 'all' ||
      (filter === 'incoming' && message.direction === 'incoming') ||
      (filter === 'outgoing' && message.direction === 'outgoing');
    return matchesSearch && matchesFilter;
  });

  const getFilterLabel = (f: FilterType) => {
    switch (f) {
      case 'all': return t('common.all' as TranslationKey);
      case 'incoming': return t('messages.incoming');
      case 'outgoing': return t('messages.outgoing');
      case 'needs_attention': return t('comments.needsAttention');
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

  // Group messages by sender
  const groupedMessages = filteredMessages.reduce((acc, msg) => {
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
    const msgDate = msg.createdAt ? new Date(msg.createdAt) : new Date(0);
    const lastMsgDate = acc[key].lastMessage.createdAt ? new Date(acc[key].lastMessage.createdAt) : new Date(0);
    if (msgDate > lastMsgDate) {
      acc[key].lastMessage = msg;
    }
    return acc;
  }, {} as Record<string, Conversation>);

  Object.values(groupedMessages).forEach(conv => {
    conv.needsHumanAttention = checkNeedsAttention(conv.messages);
  });

  let conversations = Object.values(groupedMessages).sort((a, b) => {
    const dateA = a.lastMessage.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const dateB = b.lastMessage.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return dateB - dateA;
  });

  if (filter === 'needs_attention') {
    conversations = conversations.filter(c => c.needsHumanAttention);
  }

  const needsAttentionCount = Object.values(groupedMessages).filter(c => c.needsHumanAttention).length;

  const exportToCSV = () => {
    setExporting(true);
    try {
      const headers = ['ID', 'Sender ID', 'Sender Name', 'Message', 'Direction', 'Replied', 'Reply Text', 'Reply Method', 'Created At'];
      const rows = messages.map(msg => [
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

  const getSortedMessages = (conv: Conversation) => {
    return [...conv.messages].sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateA - dateB;
    });
  };

  const StatCard = ({ title, value, icon, color }: { title: string; value: number; icon: React.ReactNode; color: string }) => (
    <Card className="border-none hover:shadow-lg transition-all duration-150 hover:-translate-y-0.5" padding="none" style={{ boxShadow: '0 10px 30px rgba(0,0,0,0.05)' }}>
      <div className="px-5 py-3.5">
        {/* Number-first hierarchy */}
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <p className="text-[28px] font-semibold text-surface-900 leading-none tracking-tight">
            {value.toLocaleString()}
          </p>
          {/* Icon: supporting role only (40% opacity, 16px) */}
          <div className={`opacity-40 transition-opacity hover:opacity-60 ${color === 'brand' ? 'text-brand-500' :
              color === 'emerald' ? 'text-emerald-500' :
                color === 'amber' ? 'text-amber-500' :
                  'text-red-500'
            }`}>
            {icon}
          </div>
        </div>
        {/* Label: secondary */}
        <p className="text-xs font-medium text-surface-500 truncate leading-tight">{title}</p>
      </div>
    </Card>
  );

  if (loading && messages.length === 0) {
    return (
      <DashboardLayout title={t('messages.title')}>
        <div className="flex items-center justify-center h-64">
          <PageSpinner />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t('messages.title')}>
      {/* Header */}
      <PageHeader
        title={t('messages.title')}
        description={t('messages.description')}
        action={
          <Button
            variant="secondary"
            size="sm"
            icon={<Download className="w-4 h-4" />}
            onClick={exportToCSV}
            loading={exporting}
          >
            {t('comments.exportCSV')}
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard title={t('messages.totalMessages')} value={stats.total} icon={<MessageCircle className="w-4 h-4" />} color="brand" />
        <StatCard title={t('comments.replied')} value={stats.replied} icon={<CheckCircle className="w-4 h-4" />} color="emerald" />
        <StatCard title={t('comments.pending')} value={stats.pending} icon={<Clock className="w-4 h-4" />} color="amber" />
        <StatCard title={t('comments.needsAttention')} value={needsAttentionCount} icon={<AlertTriangle className="w-4 h-4" />} color="red" />
      </div>

      {/* Filters & Search - Compact unified section */}
      <Card className="mb-8 border-none shadow-md shadow-surface-200/20">
        <div className="p-3.5 flex flex-col gap-3.5">
          <div className="relative group">
            <Search
              className="absolute top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400 group-focus-within:text-brand-500 transition-colors"
              style={{ insetInlineStart: '1rem' }}
            />
            <Input
              placeholder={t('common.search') + '...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="py-3 ps-12 rounded-xl bg-surface-50 border-none focus:ring-2 focus:ring-brand-500 transition-all"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
            {(['all', 'incoming', 'outgoing', 'needs_attention'] as FilterType[]).map((f) => (
              <Button
                key={f}
                variant={filter === f ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setFilter(f)}
                className={`rounded-full whitespace-nowrap px-6 transition-all duration-300 ${filter === f ? 'shadow-sm shadow-brand-100' : ''
                  } ${f === 'needs_attention' && needsAttentionCount > 0 ? 'ring-2 ring-red-200' : ''}`}
              >
                <div className="flex items-center gap-2">
                  {f === 'needs_attention' && <AlertTriangle className="w-3.5 h-3.5" />}
                  <span>{getFilterLabel(f)}</span>
                  {f === 'needs_attention' && needsAttentionCount > 0 && (
                    <span className="bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                      {needsAttentionCount}
                    </span>
                  )}
                </div>
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {/* Conversations List */}
      {conversations.length > 0 ? (
        <div className="space-y-4 pb-12">
          {conversations.map((conv, i) => (
            <Card
              key={conv.senderId}
              hover
              className={`animate-slide-up cursor-pointer border-none shadow-md hover:shadow-xl transition-all duration-300 rounded-2xl overflow-hidden ${conv.needsHumanAttention ? 'ring-2 ring-red-200 bg-red-50/10' : ''
                }`}
              style={{ animationDelay: `${i * 0.05}s` } as React.CSSProperties}
              onClick={() => setSelectedConversation(conv)}
            >
              <div className="p-6">
                <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                  {/* User Avatar */}
                  <div className="flex-shrink-0 relative">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-inner transition-colors ${conv.needsHumanAttention ? 'bg-red-100 text-red-600' : 'bg-brand-100 text-brand-600'
                      }`}>
                      <User className="w-7 h-7" />
                    </div>
                    {conv.needsHumanAttention && (
                      <div className="absolute -top-2 -end-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                        <AlertTriangle className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>

                  {/* Conversation Content */}
                  <div className="flex-1 min-w-0 text-start">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="font-bold text-surface-900 text-lg">
                        {conv.senderName || t('common.user' as TranslationKey)}
                      </span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-bold text-surface-400 uppercase tracking-widest text-start">
                          {t('messages.msgCount' as TranslationKey, { count: conv.messages.length })}
                        </span>
                        {conv.needsHumanAttention && (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 text-[10px] font-bold uppercase tracking-wider">
                            <AlertTriangle className="w-3 h-3" />
                            {t('messages.needsHuman')}
                          </div>
                        )}
                        <span className="text-surface-300">•</span>
                        <div className="flex items-center gap-1 text-xs font-medium text-surface-400">
                          <Clock className="w-3 h-3" />
                          {formatTime(conv.lastMessage.createdAt)}
                        </div>
                      </div>
                    </div>

                    {/* Last Message Preview */}
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-surface-50 group-hover:bg-white transition-colors border border-transparent group-hover:border-surface-100">
                      {conv.lastMessage.direction === 'incoming' ? (
                        <ArrowDownLeft className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                      )}
                      <p className="text-surface-700 text-sm line-clamp-1 italic italic-arabic">
                        "{conv.lastMessage.message}"
                      </p>
                    </div>
                  </div>

                  {/* Actions / Status */}
                  <div className="flex lg:flex-col items-center gap-3 lg:items-end flex-shrink-0">
                    {conv.lastMessage.replied || conv.lastMessage.direction === 'outgoing' ? (
                      <div className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">
                        <CheckCircle className="w-4 h-4" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">{t('comments.replied')}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-amber-600 bg-amber-50 px-3 py-1 rounded-full border border-amber-100">
                        <Clock className="w-4 h-4" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">{t('comments.pending')}</span>
                      </div>
                    )}
                    <ChevronRight className={`w-5 h-5 text-surface-300 group-hover:text-brand-500 transition-all ${language === 'ar' ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-none shadow-md shadow-surface-200/20 rounded-2xl" padding="lg">
          <div className="py-10 text-center">
            <div className="w-16 h-16 rounded-2xl bg-surface-100 flex items-center justify-center mx-auto mb-4">
              <MessageCircle className="w-8 h-8 text-surface-300 opacity-60" />
            </div>
            <p className="text-base font-semibold text-surface-600 mb-2">
              {searchQuery ? t('common.noData') : t('messages.noMessages' as TranslationKey)}
            </p>
            <p className="text-sm text-surface-500">
              {searchQuery ? '' : t('messages.noMessagesDesc' as TranslationKey)}
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

            {/* Modal Body - Conversation Thread */}
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
    </DashboardLayout>
  );
}
