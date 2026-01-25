import React, { useState, useEffect, useCallback, type ReactElement, useMemo } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSearchParams } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Input, PageHeader, PageSkeleton } from '@/components/ui';
import { StatCard } from '@/components/dashboard/StatCard';
import { CommentDetailModal, CommentCard, checkNeedsAttention } from '@/components/comments';
import { useAuthStore } from '@/lib/store';
import { commentsApi, pagesApi } from '@/lib/api';
import {
  MessageSquare,
  Search,
  Bot,
  Clock,
  CheckCircle,
  Download,
  AlertTriangle,
  ExternalLink,
  X,
  Zap
} from 'lucide-react';
import { useTranslation } from '@/i18n';
import { format } from 'date-fns';
import type { Comment, Page } from '@jawab24/shared';
import type { NextPageWithLayout } from './_app';
import { useEscapeKey } from '@/hooks/useEscapeKey';

  /* 
    Updated FilterType to include 'replied_today'.
    Note: 'flagged' is handled as an alias for 'needs_attention' in existing logic or explicit new type. 
  */
  type FilterType = 'all' | 'template' | 'ai' | 'pending' | 'needs_attention' | 'replied_today' | 'flagged';

  const CommentsPage: NextPageWithLayout = () => {
    const { t } = useTranslation();
    const { isAuthenticated } = useAuthStore();
    const router = useRouter();
    const searchParams = useSearchParams();
    
    const [comments, setComments] = useState<Comment[]>([]);
    const [loading, setLoading] = useState(true);
    const [isTransitioning, setIsTransitioning] = useState(false);
    
    // Map URL 'flagged' -> 'needs_attention' internally if preferred, or handle 'flagged' explicitly
    const rawFilter = (searchParams.get('filter') as string) || 'all';
    const initialFilter = rawFilter === 'flagged' ? 'needs_attention' : (rawFilter as FilterType);
    
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
      
      // Alias internal 'needs_attention' to 'flagged' in URL if desired, or keep as is.
      // Requirements asked for 'flagged', so let's use that in URL.
      let urlFilter = newFilter;
      if (newFilter === 'needs_attention') urlFilter = 'flagged';

      if (newFilter === 'all') {
        params.delete('filter');
      } else {
        params.set('filter', urlFilter);
      }
      router.push({ pathname: router.pathname, query: params.toString() }, undefined, { shallow: true });
    };

    // Update internal filter when URL changes (e.g. back button)
    useEffect(() => {
      const currentParam = searchParams.get('filter');
      if (currentParam === 'flagged') {
        setFilter('needs_attention');
      } else if (currentParam) {
        setFilter(currentParam as FilterType);
      } else {
        setFilter('all');
      }
    }, [searchParams]);
  
    const filteredComments = useMemo(() => {
      return comments.filter(comment => {
        const matchesSearch = comment.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (comment.fromName || '').toLowerCase().includes(searchQuery.toLowerCase());
  
        if (filter === 'needs_attention' || filter === 'flagged') {
          return matchesSearch && checkNeedsAttention(comment);
        }
  
        let matchesFilter = false;
        switch (filter) {
          case 'all':
            matchesFilter = true;
            break;
          case 'template':
            // Replied by human/template (EXCLUDING AI)
            matchesFilter = !!comment.replied && comment.replyMethod !== 'ai';
            break;
          case 'ai':
            matchesFilter = comment.replyMethod === 'ai';
            break;
          case 'pending':
            matchesFilter = !comment.replied;
            break;
          case 'replied_today':
            if (!comment.replied || !comment.repliedAt) {
              matchesFilter = false;
            } else {
              const replyDate = new Date(comment.repliedAt);
              const today = new Date();
              matchesFilter = replyDate.getDate() === today.getDate() &&
                              replyDate.getMonth() === today.getMonth() &&
                              replyDate.getFullYear() === today.getFullYear();
            }
            break;
        }
        
        return matchesSearch && matchesFilter;
      });
    }, [comments, filter, searchQuery]);

    const stats = useMemo(() => {
      const today = new Date();
      return {
        total: comments.length,
        // "Replied" card now represents ONLY Template/Manual replies (Mutually exclusive from AI)
        templateReplies: comments.filter(c => !!c.replied && c.replyMethod !== 'ai').length,
        pending: comments.filter(c => !c.replied).length,
        aiReplies: comments.filter(c => c.replyMethod === 'ai').length,
        needsAttention: comments.filter(c => checkNeedsAttention(c)).length,
        repliedToday: comments.filter(c => {
          if (!c.replied || !c.repliedAt) return false;
          const replyDate = new Date(c.repliedAt);
          return replyDate.getDate() === today.getDate() &&
                 replyDate.getMonth() === today.getMonth() &&
                 replyDate.getFullYear() === today.getFullYear();
        }).length,
      };
    }, [comments]);
  
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
      {/* Stats - Grid Layout */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-12">
        <div onClick={() => updateFilter('all')}>
          <StatCard
            nameKey="comments.allComments"
            value={stats.total.toLocaleString()}
            icon={MessageSquare}
            color="brand"
            index={0}
            isActive={filter === 'all'}
          />
        </div>
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
        <div onClick={() => updateFilter('replied_today')}>
          <StatCard
            nameKey="comments.repliedToday"
            value={stats.repliedToday.toLocaleString()}
            icon={CheckCircle}
            color="emerald"
            index={2}
            isActive={filter === 'replied_today'}
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

      {/* Filters & Search - Integrated Chip Row */}
      <Card className="mb-12 border-none shadow-md shadow-surface-200/20 overflow-visible" padding="none">
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
               <button 
                onClick={() => updateFilter('all')}
                className={clsx(
                  "group relative flex items-center gap-2.5 py-2.5 px-5 rounded-full shadow-sm hover:shadow-md transition-all duration-300 ring-1 ring-inset",
                  filter === 'pending' && "bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100",
                  filter === 'ai' && "bg-violet-50 text-violet-700 ring-violet-200 hover:bg-violet-100",
                  filter === 'needs_attention' && "bg-red-50 text-red-700 ring-red-200 hover:bg-red-100",
                  filter === 'template' && "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100"
                )}
               >
                 {/* Icon */}
                 {filter === 'pending' && <Clock className="w-4 h-4" />}
                 {filter === 'ai' && <Bot className="w-4 h-4" />}
                 {filter === 'needs_attention' && <AlertTriangle className="w-4 h-4" />}
                 {filter === 'template' && <CheckCircle className="w-4 h-4" />}
                 
                 <span className="font-bold text-sm tracking-wide">{getFilterChipLabel(filter)}</span>
                 
                 {/* Divider */}
                 <div className={clsx(
                   "w-px h-4 mx-1 opacity-20 bg-current"
                 )} />

                 {/* Close Icon (Animated) */}
                 <div className="bg-white/50 rounded-full p-0.5 group-hover:bg-white transition-colors">
                    <X className="w-3.5 h-3.5" />
                 </div>
               </button>
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
        (() => {
           // Calculate platform visibility logic (same as Dashboard)
           const showPageName = pages.length > 1;
           const hasFacebook = pages.some(p => !!p.facebookPageId);
           const hasInstagram = pages.some(p => !!p.instagramAccountId);
           const showPlatformIcon = hasFacebook && hasInstagram;

           return (
            <div 
              className={clsx(
                "grid grid-cols-1 lg:grid-cols-2 gap-8 pb-12 transition-all duration-300 ease-out",
                isTransitioning ? "opacity-40 translate-y-2 scale-[0.99]" : "opacity-100 translate-y-0 scale-100"
              )}
            >
              {filteredComments.map((comment, i) => {
                const pageId = comment.pageId;
                const page = pages.find(p => p.id === pageId);
                return (
                  <CommentCard
                    key={comment.id}
                    comment={comment}
                    variant="full"
                    pageName={page?.name}
                    showPageName={showPageName}
                    showPlatformIcon={showPlatformIcon}
                    showPostInfo={true}
                    animationDelay={(i % 10) * 0.05}
                    onClick={() => setSelectedComment(comment)}
                    onQuickReply={() => setSelectedComment(comment)}
                  />
                );
              })}
            </div>
          );
        })()
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
