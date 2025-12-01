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
  ArrowDownLeft
} from 'lucide-react';
import { useTranslation } from '@/i18n';
import { formatDistanceToNow } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { Message } from '@jawab24/shared';

type FilterType = 'all' | 'incoming' | 'outgoing';

export default function MessagesPage() {
  const { t, language } = useTranslation();
  const { token } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [stats, setStats] = useState({ total: 0, replied: 0, pending: 0 });

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

  const filteredMessages = messages.filter(message => {
    const matchesSearch = message.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (message.senderName || '').toLowerCase().includes(searchQuery.toLowerCase());
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
    }
  };

  const formatTime = (dateString: string) => {
    try {
      return formatDistanceToNow(new Date(dateString), { 
        addSuffix: true,
        locale: language === 'ar' ? ar : enUS 
      });
    } catch (e) {
      return dateString;
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
      };
    }
    acc[key].messages.push(msg);
    if (new Date(msg.createdAt) > new Date(acc[key].lastMessage.createdAt)) {
      acc[key].lastMessage = msg;
    }
    return acc;
  }, {} as Record<string, { senderId: string; senderName: string | null; messages: Message[]; lastMessage: Message }>);

  const conversations = Object.values(groupedMessages).sort(
    (a, b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime()
  );

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
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
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
          <div className="flex gap-2">
            {(['all', 'incoming', 'outgoing'] as FilterType[]).map((f) => (
              <Button
                key={f}
                variant={filter === f ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setFilter(f)}
              >
                {getFilterLabel(f)}
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
              className="animate-slide-up"
              style={{ animationDelay: `${i * 0.05}s` } as React.CSSProperties}
            >
              <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                {/* Avatar */}
                <div className="flex-shrink-0">
                  <div className="w-12 h-12 rounded-full bg-brand-100 flex items-center justify-center">
                    <User className="w-6 h-6 text-brand-600" />
                  </div>
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

                  {/* Recent Messages */}
                  {conv.messages.length > 1 && (
                    <div className="mt-3 space-y-2 border-t border-surface-100 pt-3">
                      {conv.messages.slice(0, 3).map((msg) => (
                        <div 
                          key={msg.id}
                          className={`flex items-start gap-2 text-sm ${
                            msg.direction === 'outgoing' ? 'opacity-70' : ''
                          }`}
                        >
                          {msg.direction === 'incoming' ? (
                            <ArrowDownLeft className="w-3 h-3 text-blue-400 flex-shrink-0 mt-1" />
                          ) : (
                            <ArrowUpRight className="w-3 h-3 text-emerald-400 flex-shrink-0 mt-1" />
                          )}
                          <span className="text-surface-600 line-clamp-1 text-start">{msg.message}</span>
                          {msg.replyMethod && (
                            <Badge size="sm" variant={msg.replyMethod === 'ai' ? 'info' : 'success'}>
                              {msg.replyMethod === 'ai' ? (
                                <Bot className="w-3 h-3" />
                              ) : (
                                <CheckCircle className="w-3 h-3" />
                              )}
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex lg:flex-col items-center gap-2 lg:items-end">
                  {conv.lastMessage.replied || conv.lastMessage.direction === 'outgoing' ? (
                    <div className="flex items-center gap-1 text-emerald-600">
                      <CheckCircle className="w-5 h-5" />
                      <span className="text-sm font-medium">{language === 'ar' ? 'تم الرد' : 'Replied'}</span>
                    </div>
                  ) : (
                    <Button size="sm" icon={<Reply className="w-4 h-4" />}>
                      {language === 'ar' ? 'رد' : 'Reply'}
                    </Button>
                  )}
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
    </DashboardLayout>
  );
}


