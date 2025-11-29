import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Badge, Input, EmptyState, PageHeader } from '@/components/ui';
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

// Demo data
const demoComments = [
  {
    id: '1',
    author: 'Ahmed Ali',
    authorId: 'user_1',
    message: 'كم سعر هذا المنتج؟ وهل يوجد توصيل للرياض؟',
    page: 'Tech Store',
    post: 'New iPhone 15 Pro Max Available!',
    time: '2 min ago',
    replied: true,
    replyText: 'مرحباً أحمد! السعر 4999 ريال ونعم نوصل للرياض مجاناً 🚚',
    replyMethod: 'template',
    detectedLanguage: 'ar',
  },
  {
    id: '2',
    author: 'Sarah Johnson',
    authorId: 'user_2',
    message: 'Is this available in blue color? I love the design!',
    page: 'Fashion Hub',
    post: 'Summer Collection 2024',
    time: '5 min ago',
    replied: true,
    replyText: 'Hi Sarah! Yes, we have it in blue, navy, and sky blue. Would you like me to send you photos?',
    replyMethod: 'ai',
    detectedLanguage: 'en',
  },
  {
    id: '3',
    author: 'محمد خالد',
    authorId: 'user_3',
    message: 'هل يوجد ضمان على المنتج؟',
    page: 'Tech Store',
    post: 'New iPhone 15 Pro Max Available!',
    time: '8 min ago',
    replied: true,
    replyText: 'نعم محمد، جميع منتجاتنا تأتي مع ضمان سنة كاملة ✅',
    replyMethod: 'template',
    detectedLanguage: 'ar',
  },
  {
    id: '4',
    author: 'Emma Wilson',
    authorId: 'user_4',
    message: 'Great product! Love it! 😍',
    page: 'Fashion Hub',
    post: 'Summer Collection 2024',
    time: '12 min ago',
    replied: false,
    replyText: null,
    replyMethod: null,
    detectedLanguage: 'en',
  },
  {
    id: '5',
    author: 'عبدالله سعيد',
    authorId: 'user_5',
    message: 'متى يكون التخفيض؟',
    page: 'Tech Store',
    post: 'New iPhone 15 Pro Max Available!',
    time: '15 min ago',
    replied: true,
    replyText: 'أهلاً عبدالله! التخفيضات تبدأ نهاية الشهر، تابعنا للمزيد 🔥',
    replyMethod: 'ai',
    detectedLanguage: 'ar',
  },
];

type FilterType = 'all' | 'replied' | 'pending';

export default function CommentsPage() {
  const { t } = useTranslation();
  const [comments] = useState(demoComments);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');

  const filteredComments = comments.filter(comment => {
    const matchesSearch = comment.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         comment.author.toLowerCase().includes(searchQuery.toLowerCase());
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

  return (
    <DashboardLayout title={t('comments.title')}>
      {/* Header */}
      <PageHeader 
        title={t('comments.title')} 
        description={t('comments.description')} 
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="text-center">
          <p className="text-2xl font-bold text-surface-900">{stats.total}</p>
          <p className="text-sm text-surface-500">{t('dashboard.totalComments')}</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-emerald-600">{stats.replied}</p>
          <p className="text-sm text-surface-500">{t('comments.replied')}</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
          <p className="text-sm text-surface-500">{t('comments.pending')}</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-brand-600">{stats.aiReplies}</p>
          <p className="text-sm text-surface-500">{t('dashboard.aiReplies')}</p>
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
            {(['all', 'replied', 'pending'] as FilterType[]).map((f) => (
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
                    <span className="font-semibold text-surface-900">{comment.author}</span>
                    <span className="text-surface-300">•</span>
                    <span className="text-sm text-surface-500">{comment.page}</span>
                    <span className="text-surface-300">•</span>
                    <span className="text-xs text-surface-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {comment.time}
                    </span>
                  </div>
                  
                  <p className="text-surface-700 mb-2 text-start">{comment.message}</p>
                  
                  <div className="flex items-center gap-2 text-xs text-surface-400">
                    <FileText className="w-3 h-3" />
                    <span className="truncate">{comment.post}</span>
                    <Badge size="sm" variant="default">
                      {comment.detectedLanguage === 'ar' ? t('templates.arabic') : t('templates.english')}
                    </Badge>
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
