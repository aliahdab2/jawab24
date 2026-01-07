import React, { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Badge, Input, PageHeader, PageSkeleton } from '@/components/ui';
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
  ExternalLink,
  Globe
} from 'lucide-react';
import { useTranslation } from '@/i18n';
import { formatDistanceToNow, format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import type { Comment } from '@jawab24/shared';

import { commentsApi, aiApi } from '@/lib/api';

type FilterType = 'all' | 'replied' | 'pending' | 'needs_attention';

export default function CommentsPage() {
  const { t, language } = useTranslation();
  const { token } = useAuthStore();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedComment, setSelectedComment] = useState<Comment | null>(null);
  const [exporting, setExporting] = useState(false);

  // Reply State
  const [replyText, setReplyText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string>('');

  // Helper component for stats - BEST PRACTICE LAYOUT
  const StatCard = ({ title, value, icon, color }: { title: string; value: number; icon: React.ReactNode; color: string; description?: string }) => (
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
              color === 'violet' ? 'bg-violet-500' :
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
          "w-10 h-10 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center shadow-lg transition-all duration-500 group-hover:scale-110 group-hover:rotate-6",
          color === 'brand' ? 'bg-brand-50 text-brand-600 shadow-brand-500/10' :
            color === 'emerald' ? 'bg-emerald-50 text-emerald-600 shadow-emerald-500/10' :
              color === 'amber' ? 'bg-amber-50 text-amber-600 shadow-amber-500/10' :
                color === 'violet' ? 'bg-violet-50 text-violet-600 shadow-violet-500/10' :
                  'bg-red-50 text-red-600 shadow-red-500/10'
        )}>
          {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<{ className?: string }>, {
            className: 'w-5 h-5 sm:w-6 sm:h-6'
          }) : icon}
        </div>
      </div>
    </Card>
  );

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

  const fetchComments = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const response = await axios.get(`${apiUrl}/comments`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = Array.isArray(response.data)
        ? response.data
        : (Array.isArray(response.data?.data) ? response.data.data : []);
      setComments(data);
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

  const handleGenerateAi = async () => {
    if (!selectedComment) return;
    setIsGenerating(true);
    setGenerationStatus(t('common.loading'));

    try {
      // 1. Start Async Job
      const { data: job } = await aiApi.generateAsync({
        comment: selectedComment.message,
        language: selectedComment.detectedLanguage || 'en',
        context: {
          // context is optional, omitting strictly typed missing fields for now
        }
      });

      // 2. Poll for Status
      const interval = setInterval(async () => {
        try {
          const { data: status } = await aiApi.getJobStatus(job.jobId);

          if (status.status === 'completed' && status.result) {
            clearInterval(interval);
            setReplyText(status.result.reply);
            setIsGenerating(false);
            setGenerationStatus('');
          } else if (status.status === 'failed') {
            clearInterval(interval);
            setIsGenerating(false);
            setGenerationStatus('Failed');
            // toast.error('AI Generation failed');
          } else {
            setGenerationStatus('Generating...');
          }
        } catch {
          clearInterval(interval);
          setIsGenerating(false);
        }
      }, 1000);

    } catch (error) {
      console.error('AI Generation caught error', error);
      setIsGenerating(false);
    }
  };

  const handleSendReply = async () => {
    if (!selectedComment || !replyText.trim()) return;
    setIsSending(true);
    try {
      await commentsApi.reply(selectedComment.id, replyText);
      // Refresh list
      await fetchComments();
      setSelectedComment(null);
      setReplyText('');
    } catch (error) {
      console.error('Failed to send reply', error);
    } finally {
      setIsSending(false);
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
        <PageSkeleton type="list" />
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
            icon={<Download className="w-[18px] h-[18px] sm:w-5 sm:h-5" />}
            onClick={exportToCSV}
            loading={exporting}
          >
            {t('comments.exportCSV')}
          </Button>
        }
      />

      {/* Stats - Horizontal scroll on mobile if they don't fit, otherwise 2-col then 5-col */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4 mb-8">
        <StatCard title={t('comments.totalComments')} value={stats.total} icon={<MessageSquare />} color="brand" />
        <StatCard title={t('comments.replied')} value={stats.replied} icon={<CheckCircle />} color="emerald" />
        <StatCard title={t('comments.pending')} value={stats.pending} icon={<Clock />} color="amber" />
        <StatCard title={t('comments.aiReplies')} value={stats.aiReplies} icon={<Bot />} color="violet" />
        <div className="col-span-2 md:col-span-1">
          <StatCard title={t('comments.needsAttention')} value={stats.needsAttention} icon={<AlertTriangle />} color="red" />
        </div>
      </div>

      {/* Filters & Search - Compact unified section */}
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
          <div className="flex gap-2 overflow-x-auto pb-2 pt-1 scrollbar-hide">
            {(['all', 'replied', 'pending', 'needs_attention'] as FilterType[]).map((f) => (
              <Button
                key={f}
                variant={filter === f ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 sm:px-6 transition-all duration-300 flex-shrink-0 ${filter === f ? 'shadow-md shadow-brand-100' : ''
                  } ${f === 'needs_attention' && needsAttentionCount > 0 ? 'ring-2 ring-red-200' : ''}`}
              >
                <div className="flex items-center gap-1.5 sm:gap-2">
                  {f === 'needs_attention' && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
                  <span className="text-xs sm:text-sm whitespace-nowrap">{getFilterLabel(f)}</span>
                  {f === 'needs_attention' && needsAttentionCount > 0 && (
                    <span className="bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                      {needsAttentionCount}
                    </span>
                  )}
                </div>
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {/* Comments List */}
      {filteredComments.length > 0 ? (
        <div className="space-y-6 pb-12">
          {filteredComments.map((comment, i) => {
            const needsAttention = checkNeedsAttention(comment);
            return (
              <Card
                key={comment.id}
                hover
                className={`animate-slide-up cursor-pointer border-none shadow-md hover:shadow-xl transition-all duration-300 rounded-2xl overflow-hidden ${needsAttention ? 'ring-2 ring-red-200 bg-red-50/10' : ''
                  }`}
                style={{ animationDelay: `${i * 0.05}s` } as React.CSSProperties}
                onClick={() => setSelectedComment(comment)}
              >
                <div className="p-4 sm:p-6">
                  <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                    {/* User Avatar Placeholder */}
                    <div className="hidden sm:flex w-12 h-12 rounded-full bg-surface-100 items-center justify-center text-surface-400 flex-shrink-0">
                      <span className="text-lg font-bold">{(comment.fromName || 'U').charAt(0).toUpperCase()}</span>
                    </div>

                    {/* Comment Content */}
                    <div className="flex-1 min-w-0 text-start">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="font-bold text-surface-900 text-lg">{comment.fromName || t('common.unknownUser')}</span>
                        {needsAttention && (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-[10px] font-bold uppercase tracking-wider">
                            <AlertTriangle className="w-3 h-3" />
                            {t('comments.needsAttention')}
                          </div>
                        )}
                        <span className="text-surface-300">•</span>
                        <div className="flex items-center gap-1 text-xs font-medium text-surface-400">
                          <Clock className="w-3 h-3" />
                          {formatTime(comment.createdAt)}
                        </div>
                      </div>

                      <p className="text-surface-700 text-base leading-relaxed mb-4 italic italic-arabic">"{comment.message}"</p>

                      <div className="flex items-center gap-4 text-xs font-semibold text-surface-400 uppercase tracking-widest">
                        <div className="flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5" />
                          <span>POST: {comment.postId?.slice(0, 8)}</span>
                        </div>
                        {comment.detectedLanguage && (
                          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-surface-100 text-surface-600">
                            <Globe className="w-3 h-3" />
                            <span>{comment.detectedLanguage === 'ar' ? t('templates.arabic') :
                              comment.detectedLanguage === 'en' ? t('templates.english') : comment.detectedLanguage}</span>
                          </div>
                        )}
                      </div>

                      {/* Reply Preview */}
                      {comment.replied && comment.replyText && (
                        <div
                          className="mt-6 p-4 bg-brand-50/30 rounded-2xl border border-brand-100 relative group/reply"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg bg-brand-100 flex items-center justify-center text-brand-600">
                                <Reply className="w-4 h-4" />
                              </div>
                              <span className="text-sm font-bold text-brand-900">{t('comments.reply')}</span>
                            </div>
                            <Badge variant={comment.replyMethod === 'ai' ? 'info' : 'success'} className="shadow-sm">
                              {comment.replyMethod === 'ai' ? (
                                <span className="flex items-center gap-1">
                                  <Bot className="w-3 h-3" /> {t('dashboard.aiReply')}
                                </span>
                              ) : (
                                <>{t('dashboard.templateReply')}</>
                              )}
                            </Badge>
                          </div>
                          <p className="text-sm text-surface-600 line-clamp-2 italic italic-arabic">"{comment.replyText}"</p>
                        </div>
                      )}
                    </div>

                    {/* Status Badge */}
                    <div className="flex lg:flex-col items-center gap-2 lg:items-end flex-shrink-0">
                      {comment.replied ? (
                        <div className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">
                          <CheckCircle className="w-4 h-4" />
                          <span className="text-xs font-bold uppercase tracking-wider">{t('comments.replied')}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-amber-600 bg-amber-50 px-3 py-1 rounded-full border border-amber-100">
                          <Clock className="w-4 h-4" />
                          <span className="text-xs font-bold uppercase tracking-wider">{t('comments.pending')}</span>
                        </div>
                      )}
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
              {searchQuery ? t('comments.tryDifferentSearch') : t('comments.noCommentsDesc')}
            </p>
            {!searchQuery && (
              <Link href="/pages">
                <Button variant="primary" size="sm" className="py-2" style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }} icon={<ExternalLink className="w-[18px] h-[18px] sm:w-5 sm:h-5" />}>
                  {t('comments.connectPage')}
                </Button>
              </Link>
            )}
          </div>
        </Card>
      )}

      {/* Comment Detail Modal */}
      {selectedComment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 md:p-6 border-b border-surface-100">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${checkNeedsAttention(selectedComment) ? 'bg-red-100' : 'bg-brand-100'
                  }`}>
                  <MessageSquare className={`w-5 h-5 ${checkNeedsAttention(selectedComment) ? 'text-red-600' : 'text-brand-600'}`} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-surface-900">
                    {t('comments.commentDetails')}
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
                    {t('comments.needsAttention')}
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
                  {t('comments.originalComment')}
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
                    {t('comments.reply')}
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
                          <>{t('dashboard.templateReply')}</>
                        )}
                      </Badge>
                    </div>
                  </div>
                </div>
              )}

              {/* Reply Section */}
              {!selectedComment.replied && (
                <div className="bg-surface-50 rounded-xl p-4 border border-surface-200">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm font-medium text-surface-700">{t('comments.reply')}</label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleGenerateAi}
                      disabled={isGenerating}
                      className={isGenerating ? 'animate-pulse text-brand-600' : 'text-brand-600 hover:bg-brand-50'}
                      icon={<Bot className="w-4 h-4" />}
                    >
                      {isGenerating ? generationStatus || t('common.loading') : t('dashboard.aiReply')}
                    </Button>
                  </div>
                  <textarea
                    className="w-full p-3 rounded-lg border border-surface-300 focus:ring-2 focus:ring-brand-500 focus:border-transparent min-h-[100px] text-surface-900 placeholder:text-surface-400 resize-y"
                    placeholder={t('comments.typeReply')}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    disabled={isGenerating || isSending}
                    dir="auto"
                  />
                  <div className="flex justify-end mt-3">
                    <Button
                      variant="primary"
                      onClick={handleSendReply}
                      loading={isSending}
                      disabled={!replyText.trim() || isGenerating}
                      icon={<Reply className="w-4 h-4" />}
                    >
                      {t('comments.sendReply')}
                    </Button>
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className="bg-surface-50 rounded-xl p-4">
                <h3 className="text-sm font-medium text-surface-700 mb-3">
                  {t('comments.additionalInfo')}
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-surface-400">{t('comments.commentId')}</p>
                    <p className="text-surface-700 font-mono text-xs truncate">{selectedComment.id}</p>
                  </div>
                  <div>
                    <p className="text-surface-400">{t('comments.postId')}</p>
                    <p className="text-surface-700 font-mono text-xs truncate">{selectedComment.postId}</p>
                  </div>
                  <div>
                    <p className="text-surface-400">{t('comments.commenterId')}</p>
                    <p className="text-surface-700 font-mono text-xs truncate">{selectedComment.fromId || '-'}</p>
                  </div>
                  <div>
                    <p className="text-surface-400">{t('comments.status')}</p>
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
                    {t('comments.viewOnFacebook')}
                  </a>
                )}
                <Button variant="secondary" onClick={() => setSelectedComment(null)}>
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
