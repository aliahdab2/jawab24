import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations, useLocale } from 'next-intl';
import { getLocaleDirection } from '@/utils/locale';
import clsx from 'clsx';
import { Send, Loader2, Sparkles, Zap, Ban, Trash2, AlertTriangle, MessageSquare, MessageCircle, X, FileText, ChevronDown, Minimize2 } from 'lucide-react';
import { isKbFilled } from '@/utils/kb';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useModalBackHandler } from '@/hooks/useModalBackHandler';
import { pagesApi } from '@/lib/api';
import { iosOr } from '@/lib/iosCopy';
import { captureError } from '@/lib/sentryHelpers';
import { classifyTestReplyError } from '@/lib/testReplyErrors';
import type { Page } from '@jawab24/shared';

interface TestMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  replyMethod?: 'ai' | 'template' | 'skipped';
  latencyMs?: number;
  commentReplyMode?: 'public' | 'private' | 'dual' | null;
  nudgeText?: string | null;
  /** The reply exceeded the model output cap and was auto-shortened — teaching
   *  signal so the merchant sees the shortening while editing Business Info. */
  replyShortened?: boolean;
}

interface TestSmartReplyModalProps {
  page: Page;
  onClose: () => void;
  /** Pre-fill the message box (e.g. a sample question when opened from the
   *  onboarding checklist, so trying a reply is one click). The modal remounts
   *  per open, so this seeds initial state cleanly. Omit for a blank box. */
  initialQuestion?: string;
  /**
   * Generate with this reply mode instead of the one stored for the page.
   * Passed by the settings card when the merchant has picked a mode but not
   * saved it yet: without it the test would answer with the SAVED mode while
   * the new option sits selected on screen — the same "my choice had no effect"
   * defect the unsaved-persona gate exists to prevent. Omit to let the server
   * resolve page pin → workspace default, exactly as production does.
   */
  replyMode?: 'sales' | 'info';
}

export function TestSmartReplyModal({ page, onClose, initialQuestion, replyMode }: TestSmartReplyModalProps) {
  const t = useTranslations('testSmartReply');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const dir = getLocaleDirection(locale);
  const [mounted, setMounted] = useState(false);

  const [channel, setChannelRaw] = useState<'comment' | 'dm'>('dm');
  const setChannel = (ch: 'comment' | 'dm') => {
    if (ch === channel) return;
    setChannelRaw(ch);
    setMessages([]);
    setError(null);
    setShowPostContext(false);
    setPostContext('');
  };
  const [postContext, setPostContext] = useState('');
  const [showPostContext, setShowPostContext] = useState(false);
  const [question, setQuestion] = useState(initialQuestion ?? '');
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

  // Gates an advisory "add business info" hint only. Uses the shared helper
  // because this modal is opened from the settings screen with a LIST page,
  // which no longer carries the KB text (see serializeListPage) — reading
  // `knowledgeBase` here would be silently undefined and show the hint always.
  // Note this is a deliberate tightening: `isKbFilled` also treats a KB that is
  // still just the untouched Facebook auto-sync snapshot as not-filled, which is
  // exactly when the hint SHOULD appear, and matches the setup checklist.
  const hasKb = isKbFilled(page) || !!page.ecommerceStoreId;
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

    // Multi-turn context: send prior turns so vague follow-ups like "كم سعرها؟"
    // resolve against the actual topic. DM only — comments are single-turn in production.
    const conversationHistory = channel === 'dm'
      ? messages.slice(-20).map(m => ({ role: m.role, content: m.content }))
      : undefined;

    try {
      const { data } = await pagesApi.testReply(page.id, {
        question: trimmed,
        channel,
        ...(channel === 'comment' && postContext.trim() ? { postMessage: postContext.trim() } : {}),
        ...(conversationHistory && conversationHistory.length > 0 ? { conversationHistory } : {}),
        ...(replyMode ? { replyMode } : {}),
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
        replyShortened: result.replyShortened,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const kind = classifyTestReplyError(err);
      if (kind === 'rateLimit') {
        setError(t('rateLimit'));
      } else if (kind === 'quota') {
        setError(t(iosOr('quotaExceededIOS', 'quotaExceeded')));
      } else {
        setError(t('error'));
        captureError(err, 'Test smart reply failed', { tags: { page: 'pages', action: 'testReply' } });
      }
    } finally {
      setLoading(false);
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
            {t('methodSmart')}
          </span>
        );
      case 'template':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
            <Zap className="w-3 h-3" />
            {t('methodPreset')}
          </span>
        );
      case 'skipped':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Ban className="w-3 h-3" />
            {t('methodSkipped')}
          </span>
        );
      default:
        return null;
    }
  };

  if (!mounted) return null;

  const modalContent = (
    <div
      className="modal-overlay fixed top-0 start-0 end-0 bottom-[var(--keyboard-height,0px)] bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 landscape:p-6 landscape:items-center animate-in fade-in duration-200 touch-none"
      onTouchMove={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
      onWheel={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        dir={dir}
        className="bg-card rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-3xl h-[calc(100vh-var(--keyboard-height,0px))] sm:h-[70vh] sm:max-h-[90vh] overflow-hidden flex flex-col pt-safe sm:pt-0 landscape:pb-2 landscape:px-safe animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200 touch-pan-y"
        onTouchMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Compact header with channel toggle */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 md:px-6 py-2.5 md:py-3 border-b border-theme-border flex-shrink-0">
          <div className="flex items-center justify-between gap-3 min-w-0">
            <h3 className="text-base font-semibold text-foreground truncate">{t('title')}</h3>
            <button
              onClick={onClose}
              className="sm:hidden p-2 -me-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors flex-shrink-0"
              aria-label={tCommon('close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-1 p-0.5 bg-muted rounded-lg flex-shrink-0">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setChannel('dm')}
                className={clsx(
                  'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all',
                  channel === 'dm'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <MessageCircle className="w-3 h-3" />
                {t('dm')}
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setChannel('comment')}
                className={clsx(
                  'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all',
                  channel === 'comment'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <MessageSquare className="w-3 h-3" />
                {t('comment')}
              </button>
            </div>
            <button
              onClick={onClose}
              className="hidden sm:block p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors flex-shrink-0 ms-auto"
              aria-label={tCommon('close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Chat area — takes all remaining space */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain p-4 md:p-6 bg-muted/50 min-h-0">
          {/* Empty state — centered in the full chat area */}
          {!hasMessages && (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
                <Sparkles className="w-7 h-7 text-brand-500" />
              </div>
              <p className="text-sm text-muted-foreground text-center max-w-[250px] leading-relaxed">
                {t('description')}
              </p>
              {!hasKb && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">{t('addKbHint')}</p>
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
                  {/* Dual mode: show nudge (public comment).
                      Skipped replies get neither a nudge nor a reply in production —
                      the commentProcessor short-circuits on SPAM_OR_IRRELEVANT, so
                      don't render a phantom nudge that would never actually be posted. */}
                  {msg.role === 'assistant' && msg.commentReplyMode === 'dual' && msg.replyMethod !== 'skipped' && msg.nudgeText && (
                    <div className="flex flex-col gap-1 max-w-[90%] sm:max-w-[85%]">
                      <span className="text-xs font-medium text-muted-foreground">{t('nudge')}</span>
                      <div className="px-4 py-2.5 rounded-2xl rounded-bs-none bg-card text-sm text-foreground border border-theme-border shadow-sm" dir="auto">
                        {msg.nudgeText}
                      </div>
                      <span className="text-xs font-medium text-muted-foreground mt-1">{t('private')}</span>
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
                      ? <span className="italic text-muted-foreground">{t('noReply')}</span>
                      : msg.content}
                  </div>

                  {/* Method badge + latency */}
                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-2 mt-1 text-[10px] font-bold uppercase tracking-tighter">
                      {getMethodBadge(msg.replyMethod)}
                      {msg.latencyMs != null && (
                        <span className="text-muted-foreground">
                          {t('responseTime', { ms: msg.latencyMs })}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Teaching hint — the reply was auto-shortened to fit the sending
                      limit. Informational only, mirrors the addKbHint styling but
                      with the neutral info tint (this is not a problem to fix NOW,
                      it's how to get better replies). */}
                  {msg.role === 'assistant' && msg.replyShortened && (
                    <div className="flex items-start gap-1.5 mt-1.5 px-2.5 py-1.5 rounded-lg border status-info text-[11px] leading-relaxed max-w-[90%] sm:max-w-[85%]">
                      <Minimize2 className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{t('replyShortenedHint')}</span>
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex items-center gap-2 max-w-[90%] sm:max-w-[85%] px-4 py-2.5 rounded-2xl rounded-bs-none bg-card text-sm text-muted-foreground border border-theme-border shadow-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('testing')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Fixed footer */}
        <div className="px-4 pt-3 pb-4 md:px-6 md:pt-4 md:pb-5 border-t border-theme-border bg-card flex-shrink-0">
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
                  {t('addPostContext')}
                  <ChevronDown className="w-3 h-3" />
                </button>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">{t('postContext')}</label>
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
                    placeholder={t('postContextPlaceholder')}
                    maxLength={1000}
                    rows={2}
                    className="w-full px-3 py-2 text-sm bg-background border border-theme-border rounded-xl resize-none overscroll-contain placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
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
              placeholder={t('placeholder')}
              maxLength={500}
              rows={1}
              className="flex-1 min-w-0 resize-none overscroll-contain rounded-2xl border border-theme-border bg-background px-4 py-2.5 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:bg-card transition-colors outline-none h-[42px]"
            />
            <button
              onMouseDown={(e) => e.preventDefault()}
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

          {/* Clear button — always rendered to prevent layout shift */}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleClear}
            className={clsx(
              'flex items-center gap-1.5 text-xs font-medium text-muted-foreground',
              'hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20',
              'rounded-full px-3 py-1 mx-auto mt-1.5 transition-colors',
              messages.length === 0 && 'invisible'
            )}
          >
            <Trash2 className="w-3 h-3" />
            {t('clear')}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
