import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Badge, Input, EmptyState, PageHeader, PageSpinner } from '@/components/ui';
import { useAuthStore } from '@/lib/store';
import axios from 'axios';
import { 
  MessageSquare, 
  Search,
  Reply,
  Bot,
  FileText,
  Clock,
  CheckCircle
} from 'lucide-react';
import { useTranslation } from '@/i18n';
import { formatDistanceToNow } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

interface Comment {
  id: string;
  message: string;
  fromName: string | null;
  replied: boolean;
  replyText: string | null;
  replyMethod: 'template' | 'ai' | 'manual' | null;
  detectedLanguage: string | null;
  createdAt: string;
  postId: string;
}

type FilterType = 'all' | 'replied' | 'pending';

export default function CommentsPage() {
  const { t, language } = useTranslation();
  const { token } = useAuthStore();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

  const fetchComments = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const response = await axios.get(`${apiUrl}/comments`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setComments(response.data);
    } catch (error) {
      console.error('Failed to fetch comments:', error);
    } finally {
      setLoading(false);
    }
  }, [token, apiUrl]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const filteredComments = comments.filter(comment => {
    const matchesSearch = comment.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (comment.fromName || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filter === 'all' || 
                         (filter === 'replied' && comment.replied) ||
                         (filter === 'pending' && !comment.replied);
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: comments.length,
    replied: comments.filter(c => c.replied).length,
    pending: comments.filter(c => !c.replied).length,
    aiReplies: comments.filter(c => c.replyMethod === 'ai').length,
  };

  const getFilterLabel = (f: FilterType) => {
    switch (f) {
      case 'all': return t('comments.allComments');
      case 'replied': return t('comments.replied');
      case 'pending': return t('comments.pending');
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

  if (loading && comments.length === 0) {
     return (
       <DashboardLayout title={t('comments.title')}>
         <div className="flex items-center justify-center h-64">
           <PageSpinner />
         </div>
       </DashboardLayout>
     );
   }

  return (
    <DashboardLayout title={t('comments.title')}>
      {/* Header */}
      <PageHeader 
        title={t('comments.title')} 
        description={t('comments.description')} 
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <Card className="text-center p-4 md:p-6">
          <p className="text-xl md:text-2xl font-bold text-surface-900">{stats.total}</p>
          <p className="text-xs md:text-sm text-surface-500 truncate">{t('dashboard.totalComments')}</p>
        </Card>
        <Card className="text-center p-4 md:p-6">
          <p className="text-xl md:text-2xl font-bold text-emerald-600">{stats.replied}</p>
          <p className="text-xs md:text-sm text-surface-500 truncate">{t('comments.replied')}</p>
        </Card>
        <Card className="text-center p-4 md:p-6">
          <p className="text-xl md:text-2xl font-bold text-amber-600">{stats.pending}</p>
          <p className="text-xs md:text-sm text-surface-500 truncate">{t('comments.pending')}</p>
        </Card>
        <Card className="text-center p-4 md:p-6">
          <p className="text-xl md:text-2xl font-bold text-brand-600">{stats.aiReplies}</p>
          <p className="text-xs md:text-sm text-surface-500 truncate">{t('dashboard.aiReplies')}</p>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6 p-4 md:p-6">
        <div className="flex flex-col gap-3 md:gap-4">
          <div className="relative">
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
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {(['all', 'replied', 'pending'] as FilterType[]).map((f) => (
              <Button
                key={f}
                variant={filter === f ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setFilter(f)}
                className="whitespace-nowrap flex-shrink-0"
              >
                {getFilterLabel(f)}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {/* Comments List */}
      {filteredComments.length > 0 ? (
        <div className="space-y-4">
          {filteredComments.map((comment, i) => (
            <Card 
              key={comment.id} 
              hover
              className="animate-slide-up"
              style={{ animationDelay: `${i * 0.05}s` } as React.CSSProperties}
            >
              <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                {/* Comment Content */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="font-semibold text-surface-900">{comment.fromName || t('common.unknownUser')}</span>
                    <span className="text-surface-300">•</span>
                    <span className="text-xs text-surface-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatTime(comment.createdAt)}
                    </span>
                  </div>
                  
                  <p className="text-surface-700 mb-2 text-start">{comment.message}</p>
                  
                  <div className="flex items-center gap-2 text-xs text-surface-400">
                    <FileText className="w-3 h-3" />
                    <span className="truncate">Post ID: {comment.postId}</span>
                    {comment.detectedLanguage && (
                        <Badge size="sm" variant="default">
                        {comment.detectedLanguage === 'ar' ? t('templates.arabic') : 
                         comment.detectedLanguage === 'en' ? t('templates.english') : comment.detectedLanguage}
                        </Badge>
                    )}
                  </div>

                  {/* Reply */}
                  {comment.replied && comment.replyText && (
                    <div 
                      className="mt-4 p-3 bg-brand-50/50 rounded-lg border-s-2 border-brand-200"
                      style={{ paddingInlineStart: '1rem' }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Reply className="w-4 h-4 text-brand-600" />
                        <span className="text-sm font-medium text-brand-700">{t('comments.reply')}</span>
                        <Badge size="sm" variant={comment.replyMethod === 'ai' ? 'info' : 'success'}>
                          {comment.replyMethod === 'ai' ? (
                            <span className="flex items-center gap-1">
                              <Bot className="w-3 h-3" /> {t('dashboard.aiReply')}
                            </span>
                          ) : (
                            <>{t('dashboard.templateReply')}</>
                          )}
                        </Badge>
                      </div>
                      <p className="text-sm text-surface-600 text-start">{comment.replyText}</p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex lg:flex-col items-center gap-2 lg:items-end">
                  {comment.replied ? (
                    <div className="flex items-center gap-1 text-emerald-600">
                      <CheckCircle className="w-5 h-5" />
                      <span className="text-sm font-medium">{t('comments.replied')}</span>
                    </div>
                  ) : (
                    <Button size="sm" icon={<Reply className="w-4 h-4" />}>
                      {t('comments.reply')}
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
            icon={MessageSquare}
            title={t('comments.noComments')}
            description={searchQuery ? t('common.noData') : t('comments.noCommentsDesc')}
          />
        </Card>
      )}
    </DashboardLayout>
  );
}
