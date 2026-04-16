import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { Send, Loader2, Sparkles, Zap, Ban, Trash2, AlertTriangle, MessageSquare, MessageCircle, X, FileText, ChevronDown } from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useModalBackHandler } from '@/hooks/useModalBackHandler';
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
  const [mounted, setMounted] = useState(false);

  const [channel, setChannelRaw] = useState<'comment' | 'dm'>('dm');
  const setChannel = (ch: 'comment' | 'dm') => {
    if (ch === channel) return;
    setChannelRaw(ch);
    setMessages([]);
    setError(null);
    setShowPostContext(false);
    setPostContext('');
    // Re-focus input after channel switch to keep keyboard open
    setTimeout(() => inputRef.current?.focus(), 50);
  };
  const [postContext, setPostContext] = useState('');
  const [showPostContext, setShowPostContext] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setMounted(true); }, []);
  useBodyScrollLock(true);
  useEscapeKey(onClose, true);
  useModalBackHandler(true, onClose);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Auto-focus input on open
  useEffect(() => {
    const timer = setTimeout(() => { inputRef.current?.focus(); }, 100);
    return () => clearTimeout(timer);
  }, []);

  const hasKb = !!(page.knowledgeBase || page.ecommerceStoreId);
  const hasMessages = messages.length > 0 || loading;

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

  if (!mounted) return null;

  const modalContent = (
    <div
      className="modal-overlay fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 landscape:p-6 landscape:items-center animate-in fade-in duration-200"
      style={{ paddingBottom: 'var(--keyboard-height, 0px)' }}
      onTouchMove={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
      onWheel={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-card rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-2xl sm:min-h-0 max-h-full sm:max-h-[90vh] overflow-hidden flex flex-col pt-safe sm:pt-0 landscape:pb-2 landscape:px-safe animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200"
        onTouchMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Compact header with channel toggle */}
        <div className="flex items-center justify-between px-4 md:px-6 py-2.5 md:py-3 border-b border-theme-border flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="text-base font-semibold text-foreground flex-shrink-0">{t('testSmartReply')}</h3>
            <div className="flex items-center gap-1 p-0.5 bg-muted rounded-lg flex-shrink-0">
              <button
                onClick={() => setChannel('dm')}
                className={clsx(
                  'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all',
                  channel === 'dm'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <MessageCircle className="w-3 h-3" />
                {t('testSmartReplyDm')}
              </button>
              <button
                onClick={() => setChannel('comment')}
                className={clsx(
                  'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all',
                  channel === 'comment'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <MessageSquare className="w-3 h-3" />
                {t('testSmartReplyComment')}
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Chat area — takes all remaining space */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 bg-muted/50 min-h-0">
          {/* Empty state — centered in the full chat area */}
          {!hasMessages && (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
                <Sparkles className="w-7 h-7 text-brand-500" />
              </div>
              <p className="text-sm text-muted-foreground text-center max-w-[250px] leading-relaxed">
                {t('testSmartReplyDescription')}
              </p>
              {!hasKb && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">{t('testSmartReplyAddKbHint')}</p>
                </div>
              )}
            </div>
          )}

          {/* Messages — stack from top, auto-scroll keeps latest visible */}
          {hasMessages && (
            <div className="flex flex-col gap-3">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={clsx(
                    'flex flex-col gap-1',
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  )}
                >
                  {/* Dual mode: show nudge (public comment) */}
                  {msg.role === 'assistant' && msg.commentReplyMode === 'dual' && msg.nudgeText && (
                    <div className="flex flex-col gap-1 max-w-[90%] sm:max-w-[85%]">
                      <span className="text-xs font-medium text-muted-foreground">{t('testSmartReplyNudge')}</span>
                      <div className="px-4 py-2.5 rounded-2xl rounded-bs-none bg-card text-sm text-foreground border border-theme-border shadow-sm" dir="auto">
                        {msg.nudgeText}
                      </div>
                      <span className="text-xs font-medium text-muted-foreground mt-1">{t('testSmartReplyPrivate')}</span>
                    </div>
                  )}

                  <div
                    className={clsx(
                      'max-w-[90%] sm:max-w-[85%] px-4 py-2.5 rounded-2xl text-sm shadow-sm',
                      msg.role === 'user'
                        ? 'bg-brand-600 text-white rounded-be-none'
                        : 'bg-card text-foreground border border-theme-border rounded-bs-none'
                    )}
                    dir="auto"
                  >
                    {msg.role === 'assistant' && msg.replyMethod === 'skipped'
                      ? <span className="italic text-muted-foreground">{t('testSmartReplyNoReply')}</span>
                      : msg.content}
                  </div>

                  {/* Method badge + latency */}
                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-2 mt-1 text-[10px] font-bold uppercase tracking-tighter">
                      {getMethodBadge(msg.replyMethod)}
                      {msg.latencyMs != null && (
                        <span className="text-muted-foreground">
                          {t('testSmartReplyResponseTime', { ms: msg.latencyMs })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex items-center gap-2 max-w-[90%] sm:max-w-[85%] px-4 py-2.5 rounded-2xl rounded-bs-none bg-card text-sm text-muted-foreground border border-theme-border shadow-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('testSmartReplyTesting')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Fixed footer */}
        <div className="px-4 pt-3 pb-6 md:px-6 md:pt-4 md:pb-6 pb-safe-modal border-t border-theme-border bg-card flex-shrink-0">
          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 mb-2">{error}</p>
          )}

          {/* Collapsible post context (comment mode only) */}
          {channel === 'comment' && (
            <div className="mb-2">
              {!showPostContext ? (
                <button
                  onClick={() => setShowPostContext(true)}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <FileText className="w-3 h-3" />
                  {t('testSmartReplyAddPostContext')}
                  <ChevronDown className="w-3 h-3" />
                </button>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">{t('testSmartReplyPostContext')}</label>
                    <button
                      onClick={() => { setShowPostContext(false); setPostContext(''); }}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <textarea
                    dir="auto"
                    value={postContext}
                    onChange={e => setPostContext(e.target.value)}
                    placeholder={t('testSmartReplyPostContextPlaceholder')}
                    maxLength={1000}
                    rows={2}
                    className="w-full px-3 py-2 text-sm bg-background border border-theme-border rounded-xl resize-none placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                    autoFocus
                  />
                </div>
              )}
            </div>
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
              className="flex-1 min-w-0 resize-none rounded-2xl border border-theme-border bg-background px-4 py-2.5 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:bg-card transition-colors outline-none h-[42px]"
            />
            <button
              onClick={handleSend}
              disabled={!question.trim() || loading}
              className="flex-shrink-0 w-[42px] h-[42px] rounded-full btn-primary flex items-center justify-center disabled:opacity-40 transition-all"
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />
              }
            </button>
          </div>

          {/* Clear button */}
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto mt-2"
            >
              <Trash2 className="w-3 h-3" />
              {t('testSmartReplyClear')}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
