import React, { useState, useEffect, useCallback, type ReactElement, useMemo } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSearchParams } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Badge, Input, PageHeader, PageSkeleton } from '@/components/ui';
import { StatCard } from '@/components/dashboard/StatCard';
import { CommentDetailModal } from '@/components/comments/CommentDetailModal';
import { useAuthStore } from '@/lib/store';
import { commentsApi, pagesApi } from '@/lib/api';
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
  ExternalLink,
  Globe,
  X,
  Sparkles,
  Zap
} from 'lucide-react';
import { useTranslation } from '@/i18n';
import { formatDistanceToNow, format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import type { Comment, Page } from '@jawab24/shared';
import type { NextPageWithLayout } from './_app';
import { useEscapeKey } from '@/hooks/useEscapeKey';

type FilterType = 'all' | 'template' | 'ai' | 'pending' | 'needs_attention';

const CommentsPage: NextPageWithLayout = () => {
  const { t, language } = useTranslation();
  const { isAuthenticated } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  
  const initialFilter = (searchParams.get('filter') as FilterType) || 'all';
  const [filter, setFilter] = useState<FilterType>(initialFilter);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedComment, setSelectedComment] = useState<Comment | null>(null);
  const [exporting, setExporting] = useState(false);
  const [pages, setPages] = useState<Page[]>([]);

  //  Fetch pages on mount
  useEffect(() => {
    const fetchPages = async () => {
      try {
        const { data } = await pagesApi.getAll();
        setPages(data);
        if (data.length === 0) {
           setLoading(false);
        }
      } catch (error) {
        console.error('Failed to fetch pages', error);
      }
    };
    if (isAuthenticated) {
        fetchPages();
    }
  }, [isAuthenticated]);

  // Sync Filter to URL
  const updateFilter = (newFilter: FilterType) => {
    if (newFilter === filter) return;
    
    // Smart Transition: Instant crossfade
    setIsTransitioning(true);
    setTimeout(() => {
      setFilter(newFilter);
      setIsTransitioning(false);
    }, 120);

    const params = new URLSearchParams(window.location.search);
    if (newFilter === 'all') {
      params.delete('filter');
    } else {
      params.set('filter', newFilter);
    }
    router.push({ pathname: router.pathname, query: params.toString() }, undefined, { shallow: true });
  };

  // Check if comment needs human attention
  const checkNeedsAttention = useCallback((comment: Comment): boolean => {
    if (comment.replied) return false;
    const helpKeywords = ['human', 'agent', 'help', 'support', 'complaint', 'problem', 'issue',
      'مساعدة', 'بشري', 'شخص', 'موظف', 'مشكلة', 'شكوى'];
    const messageText = comment.message.toLowerCase();
    return helpKeywords.some(kw => messageText.includes(kw));
  }, []);

  const filteredComments = useMemo(() => {
    return comments.filter(comment => {
      const matchesSearch = comment.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (comment.fromName || '').toLowerCase().includes(searchQuery.toLowerCase());

      if (filter === 'needs_attention') {
        return matchesSearch && checkNeedsAttention(comment);
      }

      let matchesFilter = false;
      switch (filter) {
        case 'all':
          matchesFilter = true;
          break;
        case 'template':
          // Replied by human/template (NOT AI)
          matchesFilter = !!comment.replied && comment.replyMethod !== 'ai';
          break;
        case 'ai':
          // Replied by AI
          matchesFilter = comment.replyMethod === 'ai';
          break;
        case 'pending':
          matchesFilter = !comment.replied;
          break;
      }
      
      return matchesSearch && matchesFilter;
    });
  }, [comments, filter, searchQuery, checkNeedsAttention]);

  const stats = useMemo(() => ({
    total: comments.length,
    // "Replied" card now represents "Template/Manual" only
    templateReplies: comments.filter(c => !!c.replied && c.replyMethod !== 'ai').length,
    pending: comments.filter(c => !c.replied).length,
    aiReplies: comments.filter(c => c.replyMethod === 'ai').length,
    needsAttention: comments.filter(c => checkNeedsAttention(c)).length,
  }), [comments, checkNeedsAttention]);

  // Update Page Title
  useEffect(() => {
    const filterLabel = filter === 'all' ? '' : ` — ${t(`comments.${filter}` as any)}`;
    const countLabel = filteredComments.length > 0 ? ` (${filteredComments.length})` : '';
    document.title = `${t('comments.title')}${filterLabel}${countLabel}`;
  }, [filter, filteredComments.length, t]);

  // Auto-scroll active card into view on mobile
  useEffect(() => {
    if (filter !== 'all') {
      const activeEl = document.getElementById('active-stat');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [filter]);

  // ESC key to close modal
  useEscapeKey(() => setSelectedComment(null), !!selectedComment);

  const fetchComments = useCallback(async () => {
    try {
      setLoading(true);
      const [commentsRes, pagesRes] = await Promise.all([
        commentsApi.getAll(),
        pagesApi.getAll()
      ]);
      
      const commentsData = Array.isArray(commentsRes.data)
        ? commentsRes.data
        : (Array.isArray(commentsRes.data?.data) ? commentsRes.data.data : []);
      setComments(commentsData);
      
      const pagesData = Array.isArray(pagesRes.data)
        ? pagesRes.data
        : (Array.isArray(pagesRes.data?.data) ? pagesRes.data.data : []);
      setPages(pagesData);
    } catch (error) {
      console.error('Failed to fetch comments:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchComments();
    }
  }, [isAuthenticated, fetchComments]);

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

  const getFilterChipLabel = (filterType: FilterType) => {
    switch (filterType) {
      case 'template': return t('comments.replied'); // Using generic 'Replied' label or add specific key if exists
      case 'ai': return t('dashboard.aiReply');
      case 'pending': return t('comments.pending');
      case 'needs_attention': return t('comments.needsAttention');
      default: return '';
    }
  };

  const exportToCSV = () => {
    setExporting(true);
    try {
      const headers = ['ID', 'Post ID', 'From ID', 'From Name', 'Message', 'Replied', 'Reply Text', 'Reply Method', 'Detected Language', 'Created At', 'Replied At'];
      const rows = comments.map(c => [
        c.id, c.postId, c.fromId || '', c.fromName || '', `"${(c.message || '').replace(/"/g, '""')}"`,
        c.replied ? 'Yes' : 'No', `"${(c.replyText || '').replace(/"/g, '""')}"`, c.replyMethod || '',
        c.detectedLanguage || '', c.createdAt ? new Date(c.createdAt).toISOString() : '', c.repliedAt ? new Date(c.repliedAt).toISOString() : ''
      ]);
      const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
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
    return <PageSkeleton type="list" />;
  }

  return (
    <>
      <PageHeader
        title={t('comments.title')}
        description={t('comments.description')}
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

      {/* Stats - Premium Physical Feedback */}
      <div className="flex overflow-x-auto pb-4 -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-5 gap-3 sm:gap-4 mb-4 md:mb-8 snap-x no-scrollbar">
        <div className="min-w-[140px] flex-1 snap-center" id={filter === 'all' ? 'active-stat' : undefined}>
          <StatCard 
            nameKey="comments.allComments"
            value={stats.total.toLocaleString()} 
            icon={MessageSquare} 
            color="brand" 
            index={0}
            isActive={filter === 'all'}
            onClick={() => updateFilter('all')}
          />
        </div>
        <div className="min-w-[140px] flex-1 snap-center" id={filter === 'template' ? 'active-stat' : undefined}>
          <StatCard 
            nameKey="comments.replied" 
            value={stats.templateReplies.toLocaleString()} 
            icon={CheckCircle} 
            color="emerald" 
            index={1}
            isActive={filter === 'template'}
            onClick={() => updateFilter('template')}
          />
        </div>
        <div className="min-w-[140px] flex-1 snap-center" id={filter === 'pending' ? 'active-stat' : undefined}>
          <StatCard 
            nameKey="comments.pending" 
            value={stats.pending.toLocaleString()} 
            icon={Clock} 
            color="amber" 
            index={2}
            isActive={filter === 'pending'}
            onClick={() => updateFilter('pending')}
          />
        </div>
        <div className="min-w-[140px] flex-1 snap-center" id={filter === 'ai' ? 'active-stat' : undefined}>
          <StatCard 
            nameKey="comments.aiReplies" 
            value={stats.aiReplies.toLocaleString()} 
            icon={Bot} 
            color="violet" 
            index={3}
            isActive={filter === 'ai'}
            onClick={() => updateFilter('ai')}
          />
        </div>
        <div className="min-w-[140px] flex-1 snap-center md:col-span-1" id={filter === 'needs_attention' ? 'active-stat' : undefined}>
          <StatCard 
            nameKey="comments.needsAttention" 
            value={stats.needsAttention.toLocaleString()} 
            icon={AlertTriangle} 
            color="red" 
            index={4}
            isActive={filter === 'needs_attention'}
            onClick={() => updateFilter('needs_attention')}
          />
        </div>
      </div>

      {/* Filters & Search - Integrated Chip Row */}
      <Card className="mb-8 border-none shadow-md shadow-surface-200/20 overflow-visible" padding="none">
        <div className="p-4 sm:p-5 flex flex-col md:flex-row items-center gap-4">
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
          
          {filter !== 'all' && (
            <div className="flex shrink-0 animate-in fade-in slide-in-from-right-4 duration-300">
               <Badge 
                variant={filter === 'pending' ? 'warning' : filter === 'ai' ? 'info' : filter === 'needs_attention' ? 'error' : 'success'}
                className="py-2.5 px-4 rounded-xl flex items-center gap-2 border bg-white shadow-sm group cursor-pointer hover:bg-surface-50 transition-colors"
                onClick={() => updateFilter('all')}
               >
                 <span className="font-bold text-surface-900">{getFilterChipLabel(filter)}</span>
                 <X className="w-4 h-4 text-surface-400 group-hover:text-red-500 transition-colors" />
               </Badge>
            </div>
          )}

          {filteredComments.length > 0 && (
            <div className="hidden md:block text-[10px] font-bold text-surface-400 uppercase tracking-widest whitespace-nowrap">
              {filteredComments.length} {t('dashboard.comments')}
            </div>
          )}
        </div>
      </Card>

      {/* Comments List - Smart Transitions + XL Grid */}
      {filteredComments.length > 0 ? (
        <div 
          className={clsx(
            "grid grid-cols-1 lg:grid-cols-2 gap-6 pb-12 transition-all duration-300 ease-out",
            isTransitioning ? "opacity-40 translate-y-2 scale-[0.99]" : "opacity-100 translate-y-0 scale-100"
          )}
        >
          {filteredComments.map((comment, i) => {
            const needsAttention = checkNeedsAttention(comment);
            return (
              <Card
                key={comment.id}
                hover
                className={clsx(
                  "animate-slide-up group/card cursor-pointer border-none shadow-sm hover:shadow-lg transition-all duration-300 rounded-2xl overflow-hidden relative",
                  needsAttention && 'ring-1 ring-red-100'
                )}
                style={{ 
                    animationDelay: `${(i % 10) * 0.05}s`,
                } as React.CSSProperties}
                onClick={() => setSelectedComment(comment)}
              >
                {/* Left Accent Bar */}
                <div className={clsx(
                    "absolute inset-y-0 start-0 w-1 transition-all duration-300",
                    comment.replied ? "bg-emerald-500" : "bg-amber-500",
                    needsAttention && "bg-red-500 w-1.5"
                )} />

                <div className="p-5 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6">
                    {/* User Info */}
                    <div className="flex-1 min-w-0 text-start">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="font-bold text-surface-900 text-lg">{comment.fromName || t('common.unknownUser')}</span>
                        {needsAttention && (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-[10px] font-bold uppercase tracking-wider">
                            <AlertTriangle className="w-3 h-3" />
                            {t('comments.needsAttention')}
                          </div>
                        )}
                        <span className="text-surface-300 hidden sm:inline">•</span>
                        <div className="flex items-center gap-1 text-xs font-medium text-surface-400">
                          <Clock className="w-3 h-3" />
                          {formatTime(comment.createdAt)}
                        </div>
                      </div>

                      <p className="text-surface-700 text-base leading-relaxed mb-4 italic italic-arabic">"{comment.message}"</p>

                      {/* Post Info */}
                      <div className="flex items-center gap-3 text-[10px] font-bold text-surface-400 uppercase tracking-widest">
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-surface-50 rounded-lg">
                          <FileText className="w-3 h-3" />
                          <span>POST: {comment.postId?.slice(0, 8)}</span>
                        </div>
                        {comment.detectedLanguage && (
                          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-50 text-surface-500">
                            <Globe className="w-3 h-3" />
                            <span>{comment.detectedLanguage === 'ar' ? t('templates.arabic') : t('templates.english')}</span>
                          </div>
                        )}
                        {/* Page Source Indicator (Multi-Page Only) */}
                        {pages.length > 1 && (
                            (() => {
                                const pageId = comment.pageId;
                                const page = pages.find(p => p.id === pageId);
                                if (!page) return null;
                                return (
                                    <div className="flex items-center gap-1.5 px-2 py-1 bg-brand-50 text-brand-700 rounded-lg">
                                        <div className="font-bold max-w-[100px] truncate">{page.name}</div>
                                    </div>
                                );
                            })()
                        )}
                      </div>

                      {/* Reply Preview */}
                      {comment.replied && comment.replyText && (
                        <div className="mt-4 p-4 bg-brand-50/20 rounded-2xl border border-brand-100 relative group/reply overflow-hidden">
                           <div className="absolute top-0 end-0 p-2 opacity-10">
                             <Zap className="w-8 h-8 text-brand-500" />
                           </div>
                           <div className="flex items-center justify-between mb-2">
                             <span className="text-xs font-bold text-brand-900 flex items-center gap-1.5">
                               <Reply className="w-3.5 h-3.5" />
                               {t('comments.reply')}
                             </span>
                             <Badge variant={comment.replyMethod === 'ai' ? 'info' : 'success'} size="sm" className="shadow-none">
                               {comment.replyMethod === 'ai' ? (
                                 <span className="flex items-center gap-1 text-[9px]">
                                   <Sparkles className="w-2.5 h-2.5" /> {t('dashboard.aiReply')}
                                 </span>
                               ) : (
                                 <span className="text-[9px]">{t('dashboard.templateReply')}</span>
                               )}
                             </Badge>
                           </div>
                           <p className="text-sm text-surface-600 line-clamp-2 italic italic-arabic">"{comment.replyText}"</p>
                        </div>
                      )}
                    </div>

                    {/* Quick Actions & Status - Hierarchy Polish */}
                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-4 flex-shrink-0">
                       {/* Primary Action (Solid) */}
                       <Button 
                         variant={comment.replied ? "secondary" : "primary"} 
                         size="sm" 
                         className="rounded-xl px-4 py-2 transition-all shadow-sm hover:shadow-md group-hover/card:shadow-brand-500/20"
                         onClick={(e) => {
                           e.stopPropagation();
                           setSelectedComment(comment);
                         }}
                       >
                         {comment.replied ? t('comments.replied') : t('comments.reply')}
                       </Button>

                       {/* Status Badge (Fallback for small height) */}
                       <div className="sm:hidden">
                         {comment.replied ? <CheckCircle className="w-5 h-5 text-emerald-500" /> : <Clock className="w-5 h-5 text-amber-500" />}
                       </div>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="border-none shadow-md shadow-surface-200/20 rounded-2xl" padding="lg">
          <div className="py-10 text-center">
            <div className="w-16 h-16 rounded-2xl bg-surface-100 flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="w-8 h-8 text-surface-300 opacity-60" />
            </div>
            <p className="text-base font-semibold text-surface-600 mb-2">
              {searchQuery ? t('common.noData') : t('comments.noComments')}
            </p>
            <p className="text-sm text-surface-500 mb-5">
              {searchQuery ? t('comments.tryDifferentSearch') : (pages.length > 0) ? t('comments.noCommentsForFilter') : t('comments.noCommentsDesc')}
            </p>
            {!searchQuery && pages.length === 0 && (
              <Link href="/pages">
                <Button variant="primary" size="sm" icon={<ExternalLink className="w-[18px] h-[18px]" />}>
                  {t('comments.connectPage')}
                </Button>
              </Link>
            )}
          </div>
        </Card>
      )}

      {selectedComment && (
        <CommentDetailModal
          comment={selectedComment}
          onClose={() => setSelectedComment(null)}
          onReplySuccess={fetchComments}
        />
      )}
    </>
  );
};

CommentsPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Comments">{page}</DashboardLayout>
);

export default CommentsPage;
