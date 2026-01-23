import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Button, Badge } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { commentsApi, aiApi, subscriptionApi } from '@/lib/api';
import type { Comment } from '@jawab24/shared';
import {
  MessageSquare,
  Bot,
  Reply,
  AlertTriangle,
  X,
  ExternalLink,
  CheckCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

interface CommentDetailModalProps {
  comment: Comment;
  onClose: () => void;
  onReplySuccess: () => void;
}

export const CommentDetailModal: React.FC<CommentDetailModalProps> = ({
  comment,
  onClose,
  onReplySuccess,
}) => {
  const { t, language } = useTranslation();
  const [replyText, setReplyText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string>('');
  
  // Limit State
  const [aiLimit, setAiLimit] = useState<{ allowed: boolean; reason?: string }>({ allowed: true });
  const [isReplyGenerated, setIsReplyGenerated] = useState(false);

  // Check limits on mount
  const fetchLimits = useCallback(async () => {
    try {
      const { data } = await subscriptionApi.checkAiLimit();
      setAiLimit(data);
    } catch (error) {
      console.error('Failed to fetch AI limits', error);
    }
  }, []);

  useEffect(() => {
    fetchLimits();
  }, [fetchLimits]);

  // Check if comment needs human attention
  const checkNeedsAttention = (c: Comment): boolean => {
    if (c.replied) return false;
    const helpKeywords = ['human', 'agent', 'help', 'support', 'complaint', 'problem', 'issue',
      'مساعدة', 'بشري', 'شخص', 'موظف', 'مشكلة', 'شكوى'];
    const messageText = c.message.toLowerCase();
    return helpKeywords.some(kw => messageText.includes(kw));
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
    if (!aiLimit.allowed || isReplyGenerated) return;
    
    setIsGenerating(true);
    setGenerationStatus(t('common.loading'));

    try {
      // 1. Start Async Job
      const { data: job } = await aiApi.generateAsync({
        comment: comment.message,
        language: comment.detectedLanguage || 'en',
        context: {}
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
            setIsReplyGenerated(true); // Lock the button! One-shot only.
            
            // Refresh limits after successful generation
            fetchLimits();
          } else if (status.status === 'failed') {
            clearInterval(interval);
            setIsGenerating(false);
            setGenerationStatus('Failed');
            toast.error('AI Generation failed');
          } else {
            setGenerationStatus('Generating...');
          }
        } catch {
          clearInterval(interval);
          setIsGenerating(false);
        }
      }, 1000);

    } catch (error: any) {
      console.error('AI Generation caught error', error);
      setIsGenerating(false);
      
      // Fallback: If 403 happens (e.g. race condition), show toast and refresh limits
      if (error.response?.status === 403) {
        setGenerationStatus('');
        fetchLimits(); // Update UI state
        toast.error(error.response?.data?.error || 'Limit reached', {
          duration: 5000,
          action: {
            label: t('pricing.upgrade'),
            onClick: () => window.location.href = '/settings'
          }
        });
      }
    }
  };

  const handleSendReply = async () => {
    if (!replyText.trim()) return;
    setIsSending(true);
    try {
      await commentsApi.reply(comment.id, replyText);
      toast.success(t('common.success'));
      onReplySuccess();
      onClose();
    } catch (error) {
      console.error('Failed to send reply', error);
      toast.error(t('common.error'));
    } finally {
      setIsSending(false);
    }
  };

  const needsAttention = checkNeedsAttention(comment);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 landscape:p-6 landscape:items-center animate-in fade-in duration-200">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col pb-safe landscape:pb-2 landscape:px-safe animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-surface-100">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${needsAttention ? 'bg-red-100' : 'bg-brand-100'}`}>
              <MessageSquare className={`w-5 h-5 ${needsAttention ? 'text-red-600' : 'text-brand-600'}`} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-surface-900">
                {t('comments.commentDetails')}
              </h2>
              <p className="text-sm text-surface-500">
                {comment.fromName || t('common.unknownUser')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {needsAttention && (
              <Badge variant="warning">
                <AlertTriangle className="w-3 h-3 mr-1" />
                {t('comments.needsAttention')}
              </Badge>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-surface-100 text-surface-500 transition-colors"
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
              <p className="text-surface-900 whitespace-pre-wrap">{comment.message}</p>
              <div className="flex items-center gap-3 mt-3 text-xs text-surface-400">
                <span>{formatFullTime(comment.createdAt)}</span>
                {comment.detectedLanguage && (
                  <Badge size="sm" variant="default">
                    {comment.detectedLanguage === 'ar' ? t('templates.arabic') :
                      comment.detectedLanguage === 'en' ? t('templates.english') : comment.detectedLanguage}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Reply */}
          {comment.replied && comment.replyText && (
            <div>
              <h3 className="text-sm font-medium text-surface-500 mb-2">
                {t('comments.reply')}
              </h3>
              <div className="bg-brand-50 rounded-xl p-4 border-s-4 border-brand-500">
                <p className="text-surface-900 whitespace-pre-wrap">{comment.replyText}</p>
                <div className="flex items-center gap-3 mt-3 text-xs text-surface-500">
                  <span>{formatFullTime(comment.repliedAt)}</span>
                  <Badge size="sm" variant={comment.replyMethod === 'ai' ? 'info' : 'success'}>
                    {comment.replyMethod === 'ai' ? (
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

          {/* Reply Input Section */}
          {!comment.replied && (
            <div className="bg-surface-50 rounded-xl p-4 border border-surface-200">
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-medium text-surface-700">{t('comments.reply')}</label>
                
                <div className="relative group/tooltip inline-block">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleGenerateAi}
                    disabled={isGenerating || !aiLimit.allowed || isReplyGenerated}
                    className={clsx(
                      isGenerating ? 'animate-pulse text-brand-600' : 'text-brand-600 hover:bg-brand-50',
                      (!aiLimit.allowed || isReplyGenerated) && 'opacity-50 cursor-not-allowed'
                    )}
                    icon={isReplyGenerated ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Bot className="w-4 h-4" />}
                  >
                    {isGenerating 
                      ? generationStatus || t('common.loading') 
                      : isReplyGenerated 
                        ? 'Generated' 
                        : !aiLimit.allowed 
                          ? 'Limit Reached' 
                          : t('dashboard.aiReply')}
                  </Button>
                  
                  {/* Tooltip for disabled state */}
                  {(!aiLimit.allowed || isReplyGenerated) && (
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-nowrap opacity-0 group-hover/tooltip:opacity-100 pointer-events-none transition-opacity z-10">
                      {!aiLimit.allowed 
                        ? aiLimit.reason || 'Monthly AI limit reached' 
                        : 'Already generated for this comment'}
                    </div>
                  )}
                </div>
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
                <p className="text-surface-700 font-mono text-xs truncate">{comment.id}</p>
              </div>
              <div>
                <p className="text-surface-400">{t('comments.postId')}</p>
                <p className="text-surface-700 font-mono text-xs truncate">{comment.postId}</p>
              </div>
              <div>
                <p className="text-surface-400">{t('comments.commenterId')}</p>
                <p className="text-surface-700 font-mono text-xs truncate">{comment.fromId || '-'}</p>
              </div>
              <div>
                <p className="text-surface-400">{t('comments.status')}</p>
                <Badge variant={comment.replied ? 'success' : 'warning'}>
                  {comment.replied ? t('comments.replied') : t('comments.pending')}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 md:p-6 border-t border-surface-100 bg-white">
          <div className="flex items-center justify-between">
            {comment.facebookCommentId && (
              <a
                href={`https://facebook.com/${comment.facebookCommentId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1"
              >
                <ExternalLink className="w-4 h-4" />
                {t('comments.viewOnFacebook')}
              </a>
            )}
            <Button variant="secondary" onClick={onClose}>
              {t('comments.close')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
