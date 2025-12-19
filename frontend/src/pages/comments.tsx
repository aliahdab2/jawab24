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
  CheckCircle,
  Download,
  AlertTriangle,
  X,
  ExternalLink
} from 'lucide-react';
import { useTranslation } from '@/i18n';
import { formatDistanceToNow, format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import type { Comment } from '@jawab24/shared';

type FilterType = 'all' | 'replied' | 'pending' | 'needs_attention';

export default function CommentsPage() {
  const { t, language } = useTranslation();
  const { token } = useAuthStore();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [exporting, setExporting] = useState(false);
  const [selectedComment, setSelectedComment] = useState<Comment | null>(null);

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

  // Check if comment needs human attention
  const checkNeedsAttention = (comment: Comment): boolean => {
    if (comment.replied) return false;
    const helpKeywords = ['human', 'agent', 'help', 'support', 'complaint', 'problem', 'issue', 
                          'مساعدة', 'بشري', 'شخص', 'موظف', 'مشكلة', 'شكوى'];
    const messageText = comment.message.toLowerCase();
    return helpKeywords.some(kw => messageText.includes(kw));
  };

  const filteredComments = comments.filter(comment => {
    const matchesSearch = comment.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (comment.fromName || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    if (filter === 'needs_attention') {
      return matchesSearch && checkNeedsAttention(comment);
    }
    
    const matchesFilter = filter === 'all' || 
                         (filter === 'replied' && comment.replied) ||
                         (filter === 'pending' && !comment.replied);
    return matchesSearch && matchesFilter;
  });

  const needsAttentionCount = comments.filter(c => checkNeedsAttention(c)).length;

  const stats = {
    total: comments.length,
    replied: comments.filter(c => c.replied).length,
    pending: comments.filter(c => !c.replied).length,
    aiReplies: comments.filter(c => c.replyMethod === 'ai').length,
    needsAttention: needsAttentionCount,
  };

  const getFilterLabel = (f: FilterType) => {
    switch (f) {
      case 'all': return t('comments.allComments');
      case 'replied': return t('comments.replied');
      case 'pending': return t('comments.pending');
      case 'needs_attention': return language === 'ar' ? 'تحتاج اهتمام' : 'Needs Attention';
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

  // Export to CSV function
  const exportToCSV = () => {
    setExporting(true);
    try {
      const headers = [
        'ID',
        'Post ID',
        'From ID',
        'From Name',
        'Message',
        'Replied',
        'Reply Text',
        'Reply Method',
        'Detected Language',
        'Created At',
        'Replied At'
      ];
      
      const rows = comments.map(c => [
        c.id,
        c.postId,
        c.fromId || '',
        c.fromName || '',
        `"${(c.message || '').replace(/"/g, '""')}"`,
        c.replied ? 'Yes' : 'No',
        `"${(c.replyText || '').replace(/"/g, '""')}"`,
        c.replyMethod || '',
        c.detectedLanguage || '',
        c.createdAt ? new Date(c.createdAt).toISOString() : '',
        c.repliedAt ? new Date(c.repliedAt).toISOString() : ''
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.join(','))
      ].join('\n');

      const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `comments_${format(new Date(), 'yyyy-MM-dd')}.csv`;
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4 mb-6">
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
        <Card className="text-center p-4 md:p-6">
          <p className="text-xl md:text-2xl font-bold text-red-600">{stats.needsAttention}</p>
          <p className="text-xs md:text-sm text-surface-500 truncate">{language === 'ar' ? 'تحتاج اهتمام' : 'Needs Attention'}</p>
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
            {(['all', 'replied', 'pending', 'needs_attention'] as FilterType[]).map((f) => (
              <Button
                key={f}
                variant={filter === f ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setFilter(f)}
                className={`whitespace-nowrap flex-shrink-0 ${f === 'needs_attention' && needsAttentionCount > 0 ? 'ring-2 ring-red-300' : ''}`}
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

      {/* Comments List */}
      {filteredComments.length > 0 ? (
        <div className="space-y-4">
          {filteredComments.map((comment, i) => {
            const needsAttention = checkNeedsAttention(comment);
            return (
              <Card 
                key={comment.id} 
                hover
                className={`animate-slide-up cursor-pointer ${needsAttention ? 'ring-2 ring-red-200 bg-red-50/50' : ''}`}
                style={{ animationDelay: `${i * 0.05}s` } as React.CSSProperties}
                onClick={() => setSelectedComment(comment)}
              >
                <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                  {/* Comment Content */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="font-semibold text-surface-900">{comment.fromName || t('common.unknownUser')}</span>
                      {needsAttention && (
                        <Badge size="sm" variant="warning">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          {language === 'ar' ? 'يحتاج تدخل' : 'Needs Attention'}
                        </Badge>
                      )}
                      <span className="text-surface-300">•</span>
                      <span className="text-xs text-surface-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(comment.createdAt)}
                      </span>
                    </div>
                    
                    <p className="text-surface-700 mb-2 text-start line-clamp-2">{comment.message}</p>
                    
                    <div className="flex items-center gap-2 text-xs text-surface-400 flex-wrap">
                      <FileText className="w-3 h-3" />
                      <span className="truncate max-w-[150px]">Post: {comment.postId?.slice(0, 8)}...</span>
                      {comment.detectedLanguage && (
                          <Badge size="sm" variant="default">
                          {comment.detectedLanguage === 'ar' ? t('templates.arabic') : 
                           comment.detectedLanguage === 'en' ? t('templates.english') : comment.detectedLanguage}
                          </Badge>
                      )}
                    </div>

                    {/* Reply Preview */}
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
                        <p className="text-sm text-surface-600 text-start line-clamp-2">{comment.replyText}</p>
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
                      <Badge variant="warning" size="sm">
                        {t('comments.pending')}
                      </Badge>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
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

      {/* Comment Detail Modal */}
      {selectedComment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 md:p-6 border-b border-surface-100">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  checkNeedsAttention(selectedComment) ? 'bg-red-100' : 'bg-brand-100'
                }`}>
                  <MessageSquare className={`w-5 h-5 ${checkNeedsAttention(selectedComment) ? 'text-red-600' : 'text-brand-600'}`} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-surface-900">
                    {language === 'ar' ? 'تفاصيل التعليق' : 'Comment Details'}
                  </h2>
                  <p className="text-sm text-surface-500">
                    {selectedComment.fromName || t('common.unknownUser')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {checkNeedsAttention(selectedComment) && (
                  <Badge variant="warning">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    {language === 'ar' ? 'يحتاج تدخل' : 'Needs Attention'}
                  </Badge>
                )}
                <button 
                  onClick={() => setSelectedComment(null)}
                  className="p-2 rounded-lg hover:bg-surface-100 text-surface-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
              {/* Original Comment */}
              <div>
                <h3 className="text-sm font-medium text-surface-500 mb-2">
                  {language === 'ar' ? 'التعليق الأصلي' : 'Original Comment'}
                </h3>
                <div className="bg-surface-50 rounded-xl p-4">
                  <p className="text-surface-900 whitespace-pre-wrap">{selectedComment.message}</p>
                  <div className="flex items-center gap-3 mt-3 text-xs text-surface-400">
                    <span>{formatFullTime(selectedComment.createdAt)}</span>
                    {selectedComment.detectedLanguage && (
                      <Badge size="sm" variant="default">
                        {selectedComment.detectedLanguage === 'ar' ? t('templates.arabic') : 
                         selectedComment.detectedLanguage === 'en' ? t('templates.english') : selectedComment.detectedLanguage}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Reply */}
              {selectedComment.replied && selectedComment.replyText && (
                <div>
                  <h3 className="text-sm font-medium text-surface-500 mb-2">
                    {language === 'ar' ? 'الرد' : 'Reply'}
                  </h3>
                  <div className="bg-brand-50 rounded-xl p-4 border-s-4 border-brand-500">
                    <p className="text-surface-900 whitespace-pre-wrap">{selectedComment.replyText}</p>
                    <div className="flex items-center gap-3 mt-3 text-xs text-surface-500">
                      <span>{formatFullTime(selectedComment.repliedAt)}</span>
                      <Badge size="sm" variant={selectedComment.replyMethod === 'ai' ? 'info' : 'success'}>
                        {selectedComment.replyMethod === 'ai' ? (
                          <span className="flex items-center gap-1">
                            <Bot className="w-3 h-3" /> AI
                          </span>
                        ) : (
                          <>{language === 'ar' ? 'قالب' : 'Template'}</>
                        )}
                      </Badge>
                    </div>
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className="bg-surface-50 rounded-xl p-4">
                <h3 className="text-sm font-medium text-surface-700 mb-3">
                  {language === 'ar' ? 'معلومات إضافية' : 'Additional Info'}
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-surface-400">{language === 'ar' ? 'معرف التعليق' : 'Comment ID'}</p>
                    <p className="text-surface-700 font-mono text-xs truncate">{selectedComment.id}</p>
                  </div>
                  <div>
                    <p className="text-surface-400">{language === 'ar' ? 'معرف المنشور' : 'Post ID'}</p>
                    <p className="text-surface-700 font-mono text-xs truncate">{selectedComment.postId}</p>
                  </div>
                  <div>
                    <p className="text-surface-400">{language === 'ar' ? 'معرف المعلق' : 'Commenter ID'}</p>
                    <p className="text-surface-700 font-mono text-xs truncate">{selectedComment.fromId || '-'}</p>
                  </div>
                  <div>
                    <p className="text-surface-400">{language === 'ar' ? 'الحالة' : 'Status'}</p>
                    <Badge variant={selectedComment.replied ? 'success' : 'warning'}>
                      {selectedComment.replied ? t('comments.replied') : t('comments.pending')}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 md:p-6 border-t border-surface-100 bg-white">
              <div className="flex items-center justify-between">
                {selectedComment.facebookCommentId && (
                  <a 
                    href={`https://facebook.com/${selectedComment.facebookCommentId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1"
                  >
                    <ExternalLink className="w-4 h-4" />
                    {language === 'ar' ? 'عرض على فيسبوك' : 'View on Facebook'}
                  </a>
                )}
                <Button variant="secondary" onClick={() => setSelectedComment(null)}>
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
