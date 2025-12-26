import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Badge, Input, EmptyState, PageHeader, PageSpinner } from '@/components/ui';
import { useAuthStore } from '@/lib/store';
import axios from 'axios';
import { 
  MessageCircle, 
  Search,
  Reply,
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
  ChevronRight
} from 'lucide-react';
import { useTranslation } from '@/i18n';
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
    // Needs attention if:
    // 1. Last message is incoming and not replied
    // 2. Contains keywords like "human", "agent", "help", "مساعدة", "بشري"
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
    if (filter === 'needs_attention') return matchesSearch; // Will filter later at conversation level
    const matchesFilter = filter === 'all' || 
                         (filter === 'incoming' && message.direction === 'incoming') ||
                         (filter === 'outgoing' && message.direction === 'outgoing');
    return matchesSearch && matchesFilter;
  });

  const getFilterLabel = (f: FilterType) => {
    switch (f) {
      case 'all': return language === 'ar' ? 'الكل' : 'All';
      case 'incoming': return language === 'ar' ? 'الواردة' : 'Incoming';
      case 'outgoing': return language === 'ar' ? 'الصادرة' : 'Outgoing';
      case 'needs_attention': return language === 'ar' ? 'تحتاج اهتمام' : 'Needs Attention';
    }
  };

  const formatTime = (dateValue: string | Date | null | undefined) => {
    if (!dateValue) return language === 'ar' ? 'غير معروف' : 'Unknown';
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

  // Group messages by sender for conversation view
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

  // Calculate needs attention for each conversation
  Object.values(groupedMessages).forEach(conv => {
    conv.needsHumanAttention = checkNeedsAttention(conv.messages);
  });

  let conversations = Object.values(groupedMessages).sort((a, b) => {
    const dateA = a.lastMessage.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const dateB = b.lastMessage.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return dateB - dateA;
  });

  // Filter by needs attention if selected
  if (filter === 'needs_attention') {
    conversations = conversations.filter(c => c.needsHumanAttention);
  }

  // Count conversations needing attention
  const needsAttentionCount = Object.values(groupedMessages).filter(c => c.needsHumanAttention).length;

  // Export to CSV function
  const exportToCSV = () => {
    setExporting(true);
    try {
      const headers = [
        'ID',
        'Sender ID',
        'Sender Name',
        'Message',
        'Direction',
        'Replied',
        'Reply Text',
        'Reply Method',
        'Created At',
        'Replied At'
      ];
      
      const rows = messages.map(msg => [
        msg.id,
        msg.senderId,
        msg.senderName || '',
        `"${(msg.message || '').replace(/"/g, '""')}"`,
        msg.direction,
        msg.replied ? 'Yes' : 'No',
        `"${(msg.replyText || '').replace(/"/g, '""')}"`,
        msg.replyMethod || '',
        msg.createdAt ? new Date(msg.createdAt).toISOString() : '',
        msg.repliedAt ? new Date(msg.repliedAt).toISOString() : ''
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.join(','))
      ].join('\n');

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

  // Sort conversation messages chronologically for display
  const getSortedMessages = (conv: Conversation) => {
    return [...conv.messages].sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateA - dateB;
    });
  };

  if (loading && messages.length === 0) {
    return (
      <DashboardLayout title={language === 'ar' ? 'الرسائل' : 'Messages'}>
        <div className="flex items-center justify-center h-64">
          <PageSpinner />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={language === 'ar' ? 'الرسائل' : 'Messages'}>
      {/* Header */}
      <PageHeader 
        title={language === 'ar' ? 'الرسائل' : 'Messages'} 
        description={language === 'ar' ? 'عرض وإدارة الرسائل الخاصة' : 'View and manage private messages'} 
        action={
          <Button 
            variant="secondary" 
            size="sm" 
            icon={<Download className="w-4 h-4" />}
            onClick={exportToCSV}
            loading={exporting}
          >
            {language === 'ar' ? 'تصدير CSV' : 'Export CSV'}
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="text-center">
          <p className="text-2xl font-bold text-surface-900">{stats.total}</p>
          <p className="text-sm text-surface-500">{language === 'ar' ? 'إجمالي الرسائل' : 'Total Messages'}</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-emerald-600">{stats.replied}</p>
          <p className="text-sm text-surface-500">{language === 'ar' ? 'تم الرد' : 'Replied'}</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
          <p className="text-sm text-surface-500">{language === 'ar' ? 'قيد الانتظار' : 'Pending'}</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-red-600">{needsAttentionCount}</p>
          <p className="text-sm text-surface-500">{language === 'ar' ? 'تحتاج اهتمام' : 'Needs Attention'}</p>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search 
              className="absolute top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400"
              style={{ insetInlineStart: '0.75rem' }}
            />
            <Input
              placeholder={t('common.search') + '...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingInlineStart: '2.5rem' }}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {(['all', 'incoming', 'outgoing', 'needs_attention'] as FilterType[]).map((f) => (
              <Button
                key={f}
                variant={filter === f ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setFilter(f)}
                className={f === 'needs_attention' && needsAttentionCount > 0 ? 'ring-2 ring-red-300' : ''}
              >
                {f === 'needs_attention' && <AlertTriangle className="w-3 h-3 mr-1" />}
                {getFilterLabel(f)}
                {f === 'needs_attention' && needsAttentionCount > 0 && (
                  <span className="ml-1 bg-red-500 text-white text-xs rounded-full px-1.5">
                    {needsAttentionCount}
                  </span>
                )}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {/* Conversations List */}
      {conversations.length > 0 ? (
        <div className="space-y-4">
          {conversations.map((conv, i) => (
            <Card 
              key={conv.senderId} 
              hover
              className={`animate-slide-up cursor-pointer transition-all ${
                conv.needsHumanAttention ? 'ring-2 ring-red-200 bg-red-50/50' : ''
              }`}
              style={{ animationDelay: `${i * 0.05}s` } as React.CSSProperties}
              onClick={() => setSelectedConversation(conv)}
            >
              <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                {/* Avatar */}
                <div className="flex-shrink-0 relative">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    conv.needsHumanAttention ? 'bg-red-100' : 'bg-brand-100'
                  }`}>
                    <User className={`w-6 h-6 ${conv.needsHumanAttention ? 'text-red-600' : 'text-brand-600'}`} />
                  </div>
                  {conv.needsHumanAttention && (
                    <div className="absolute -top-1 -end-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
                      <AlertTriangle className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>

                {/* Conversation Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="font-semibold text-surface-900">
                      {conv.senderName || (language === 'ar' ? 'مستخدم' : 'User')}
                    </span>
                    <Badge size="sm" variant="default">
                      {conv.messages.length} {language === 'ar' ? 'رسالة' : 'messages'}
                    </Badge>
                    {conv.needsHumanAttention && (
                      <Badge size="sm" variant="warning">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        {language === 'ar' ? 'يحتاج تدخل بشري' : 'Needs Human'}
                      </Badge>
                    )}
                    <span className="text-surface-300">•</span>
                    <span className="text-xs text-surface-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatTime(conv.lastMessage.createdAt)}
                    </span>
                  </div>
                  
                  {/* Last Message Preview */}
                  <div className="flex items-start gap-2">
                    {conv.lastMessage.direction === 'incoming' ? (
                      <ArrowDownLeft className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                    ) : (
                      <ArrowUpRight className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    )}
                    <p className="text-surface-700 text-sm line-clamp-2 text-start">
                      {conv.lastMessage.message}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex lg:flex-col items-center gap-2 lg:items-end">
                  {conv.lastMessage.replied || conv.lastMessage.direction === 'outgoing' ? (
                    <div className="flex items-center gap-1 text-emerald-600">
                      <CheckCircle className="w-5 h-5" />
                      <span className="text-sm font-medium">{language === 'ar' ? 'تم الرد' : 'Replied'}</span>
                    </div>
                  ) : (
                    <Badge variant="warning" size="sm">
                      {language === 'ar' ? 'قيد الانتظار' : 'Pending'}
                    </Badge>
                  )}
                  <ChevronRight className="w-5 h-5 text-surface-400" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={MessageCircle}
            title={language === 'ar' ? 'لا توجد رسائل' : 'No messages'}
            description={searchQuery 
              ? t('common.noData') 
              : (language === 'ar' ? 'ستظهر الرسائل هنا عند ورودها' : 'Messages will appear here when they arrive')
            }
          />
        </Card>
      )}

      {/* Conversation Detail Modal */}
      {selectedConversation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 md:p-6 border-b border-surface-100">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  selectedConversation.needsHumanAttention ? 'bg-red-100' : 'bg-brand-100'
                }`}>
                  <User className={`w-5 h-5 ${selectedConversation.needsHumanAttention ? 'text-red-600' : 'text-brand-600'}`} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-surface-900">
                    {selectedConversation.senderName || (language === 'ar' ? 'مستخدم' : 'User')}
                  </h2>
                  <p className="text-sm text-surface-500">
                    {selectedConversation.messages.length} {language === 'ar' ? 'رسالة' : 'messages'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selectedConversation.needsHumanAttention && (
                  <Badge variant="warning">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    {language === 'ar' ? 'يحتاج تدخل بشري' : 'Needs Human'}
                  </Badge>
                )}
                <button 
                  onClick={() => setSelectedConversation(null)}
                  className="p-2 rounded-lg hover:bg-surface-100 text-surface-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body - Conversation Thread */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 bg-surface-50">
              {getSortedMessages(selectedConversation).map((msg) => (
                <div 
                  key={msg.id}
                  className={`flex ${msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[80%] rounded-2xl p-4 ${
                    msg.direction === 'outgoing' 
                      ? 'bg-brand-600 text-white rounded-br-md' 
                      : 'bg-white text-surface-900 shadow-sm rounded-bl-md'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                    <div className={`flex items-center gap-2 mt-2 text-xs ${
                      msg.direction === 'outgoing' ? 'text-brand-200' : 'text-surface-400'
                    }`}>
                      <span>{formatFullTime(msg.createdAt)}</span>
                      {msg.direction === 'outgoing' && msg.replyMethod && (
                        <Badge 
                          size="sm" 
                          variant={msg.replyMethod === 'ai' ? 'info' : 'success'}
                          className="!bg-white/20 !text-white"
                        >
                          {msg.replyMethod === 'ai' ? (
                            <>
                              <Bot className="w-3 h-3 mr-1" />
                              AI
                            </>
                          ) : msg.replyMethod === 'template' ? (
                            <>
                              <CheckCircle className="w-3 h-3 mr-1" />
                              {language === 'ar' ? 'قالب' : 'Template'}
                            </>
                          ) : (
                            <>
                              <UserCheck className="w-3 h-3 mr-1" />
                              {language === 'ar' ? 'يدوي' : 'Manual'}
                            </>
                          )}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Modal Footer */}
            <div className="p-4 md:p-6 border-t border-surface-100 bg-white">
              <div className="flex items-center justify-between">
                <p className="text-sm text-surface-500">
                  {language === 'ar' 
                    ? 'الردود تتم تلقائياً' 
                    : 'Replies are handled automatically by AI'}
                </p>
                <Button variant="secondary" onClick={() => setSelectedConversation(null)}>
                  {language === 'ar' ? 'إغلاق' : 'Close'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
