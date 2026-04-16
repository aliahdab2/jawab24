import React, { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { Send, Loader2, Sparkles, Zap, Ban, Trash2, AlertTriangle, MessageSquare, MessageCircle } from 'lucide-react';
import { Modal } from '@/components/ui';
import { pagesApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import type { Page } from '@jawab24/shared';

interface TestMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  replyMethod?: 'ai' | 'template' | 'skipped';
  latencyMs?: number;
  commentReplyMode?: 'public' | 'private' | 'dual' | null;
  nudgeText?: string | null;
}

interface TestSmartReplyModalProps {
  page: Page;
  onClose: () => void;
}

export function TestSmartReplyModal({ page, onClose }: TestSmartReplyModalProps) {
  const t = useTranslations('pages');

  const [channel, setChannel] = useState<'comment' | 'dm'>('comment');
  const [postContext, setPostContext] = useState('');
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const hasKb = !!(page.knowledgeBase || page.ecommerceStoreId);

  const handleSend = async () => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    const userMsg: TestMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };
    setMessages(prev => [...prev, userMsg]);
    setQuestion('');
    setError(null);
    setLoading(true);

    try {
      const { data } = await pagesApi.testReply(page.id, {
        question: trimmed,
        channel,
        ...(channel === 'comment' && postContext.trim() ? { postMessage: postContext.trim() } : {}),
      });

      const result = data.data;
      const assistantMsg: TestMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result.reply || '',
        replyMethod: result.replyMethod,
        latencyMs: result.latencyMs,
        commentReplyMode: result.commentReplyMode,
        nudgeText: result.nudgeText,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const axiosErr = err as { response?: { status?: number; data?: { code?: string } } };
      if (axiosErr.response?.status === 429) {
        setError(t('testSmartReplyRateLimit'));
      } else if (axiosErr.response?.status === 403 && axiosErr.response?.data?.code === 'AI_QUOTA_EXCEEDED') {
        setError(t('testSmartReplyQuotaExceeded'));
      } else {
        setError(t('testSmartReplyError'));
        captureError(err, 'Test smart reply failed', { tags: { page: 'pages', action: 'testReply' } });
      }
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([]);
    setError(null);
  };

  const getMethodBadge = (method?: string) => {
    switch (method) {
      case 'ai':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400">
            <Sparkles className="w-3 h-3" />
            {t('testSmartReplyMethodSmart')}
          </span>
        );
      case 'template':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
            <Zap className="w-3 h-3" />
            {t('testSmartReplyMethodPreset')}
          </span>
        );
      case 'skipped':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Ban className="w-3 h-3" />
            {t('testSmartReplyMethodSkipped')}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={t('testSmartReply')} size="lg">
      <div className="flex flex-col gap-4">
        {/* KB hint */}
        {!hasKb && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <p className="text-sm text-amber-700 dark:text-amber-300">{t('testSmartReplyAddKbHint')}</p>
          </div>
        )}

        {/* Channel toggle */}
        <div className="flex items-center gap-2 p-1 bg-muted rounded-xl w-fit">
          <button
            onClick={() => setChannel('comment')}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
              channel === 'comment'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            {t('testSmartReplyComment')}
          </button>
          <button
            onClick={() => setChannel('dm')}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
              channel === 'dm'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            {t('testSmartReplyDm')}
          </button>
        </div>

        {/* Post context (comment mode only) */}
        {channel === 'comment' && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t('testSmartReplyPostContext')}
            </label>
            <textarea
              dir="auto"
              value={postContext}
              onChange={e => setPostContext(e.target.value)}
              placeholder={t('testSmartReplyPostContextPlaceholder')}
              maxLength={1000}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-background border border-theme-border rounded-xl resize-none placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>
        )}

        {/* Messages area */}
        <div className="flex flex-col gap-3 min-h-[120px] max-h-[300px] overflow-y-auto">
          {messages.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground text-center py-8">{t('testSmartReplyDescription')}</p>
          )}

          {messages.map(msg => (
            <div
              key={msg.id}
              className={clsx(
                'flex flex-col gap-1 max-w-[85%]',
                msg.role === 'user' ? 'self-end items-end' : 'self-start items-start'
              )}
            >
              {/* Dual mode: show nudge (public comment) */}
              {msg.role === 'assistant' && msg.commentReplyMode === 'dual' && msg.nudgeText && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">{t('testSmartReplyNudge')}</span>
                  <div className="px-4 py-2.5 rounded-2xl rounded-ss-sm bg-muted text-sm text-foreground" dir="auto">
                    {msg.nudgeText}
                  </div>
                  <span className="text-xs font-medium text-muted-foreground mt-1">{t('testSmartReplyPrivate')}</span>
                </div>
              )}

              <div
                className={clsx(
                  'px-4 py-2.5 rounded-2xl text-sm',
                  msg.role === 'user'
                    ? 'bg-brand-500 text-white rounded-ee-sm'
                    : 'bg-muted text-foreground rounded-ss-sm'
                )}
                dir="auto"
              >
                {msg.role === 'assistant' && msg.replyMethod === 'skipped'
                  ? <span className="italic text-muted-foreground">{t('testSmartReplyNoReply')}</span>
                  : msg.content}
              </div>

              {/* Method badge + latency */}
              {msg.role === 'assistant' && (
                <div className="flex items-center gap-2 px-1">
                  {getMethodBadge(msg.replyMethod)}
                  {msg.latencyMs != null && (
                    <span className="text-xs text-muted-foreground">
                      {t('testSmartReplyResponseTime', { ms: msg.latencyMs })}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="self-start flex items-center gap-2 px-4 py-2.5 rounded-2xl rounded-ss-sm bg-muted text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('testSmartReplyTesting')}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {/* Input area */}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            dir="auto"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('testSmartReplyPlaceholder')}
            maxLength={500}
            rows={1}
            className="flex-1 px-4 py-2.5 text-sm bg-background border border-theme-border rounded-xl resize-none placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          />
          <button
            onClick={handleSend}
            disabled={!question.trim() || loading}
            className={clsx(
              'p-2.5 rounded-xl transition-all flex-shrink-0',
              question.trim() && !loading
                ? 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            )}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>

        {/* Clear button */}
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors self-center"
          >
            <Trash2 className="w-3 h-3" />
            {t('testSmartReplyClear')}
          </button>
        )}
      </div>
    </Modal>
  );
}
