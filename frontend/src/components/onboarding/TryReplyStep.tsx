import { useState } from 'react';
import { Sparkles, Loader2, AlertCircle, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui';
import { pagesApi } from '@/lib/api';
import { iosOr } from '@/lib/iosCopy';
import { captureError } from '@/lib/sentryHelpers';
import { classifyTestReplyError, type TestReplyErrorKind } from '@/lib/testReplyErrors';
import type { TFunction } from './onboardingTypes';

interface TryReplyStepProps {
  /** Page whose stored Business Info the test reply is generated from. */
  pageId: string | null;
  /** Whether the page has any Business Info — drives the "add info for better replies" hint. */
  hasKnowledgeBase: boolean;
  isLandscape: boolean;
  t: TFunction;
  /** Fired once a reply is successfully shown, so the wizard can switch the finish CTA. */
  onReplyShown: () => void;
}

/**
 * Final onboarding step: a chat-style box that generates a real AI reply via
 * the same pipeline production uses (POST /pages/:id/test-reply). This is local
 * generation only — nothing is sent to Facebook. The wizard persists the page's
 * Business Info *before* mounting this step, because test-reply reads the STORED
 * knowledge base (the request body carries no KB field).
 */
export function TryReplyStep({ pageId, hasKnowledgeBase, isLandscape, t, onReplyShown }: TryReplyStepProps) {
  const [question, setQuestion] = useState(() => t('onboarding.trySampleQuestion'));
  const [askedQuestion, setAskedQuestion] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorKind, setErrorKind] = useState<TestReplyErrorKind | null>(null);

  const handleTry = async () => {
    const trimmed = question.trim();
    if (!trimmed || !pageId || loading) return;

    setLoading(true);
    setErrorKind(null);
    setReply(null);
    setAskedQuestion(trimmed);

    try {
      // DM channel: a plain customer question, no post context needed.
      const res = await pagesApi.testReply(pageId, { question: trimmed, channel: 'dm' });
      const replyText: string = res.data?.data?.reply ?? '';
      if (replyText.trim()) {
        setReply(replyText);
        onReplyShown();
      } else {
        // Skipped reply / empty body — treat as a retryable error, not a blank bubble.
        setErrorKind('generic');
      }
    } catch (err) {
      const kind = classifyTestReplyError(err);
      setErrorKind(kind);
      // Rate-limit / quota are expected responses, not failures — only report the rest.
      if (kind === 'generic') {
        captureError(err, 'Onboarding: test reply failed', { tags: { component: 'onboarding' } });
      }
    } finally {
      setLoading(false);
    }
  };

  // App Store compliance: the iOS quota copy must not steer users to upgrade.
  const errorMessage =
    errorKind === 'rateLimit'
      ? t('onboarding.tryRateLimit')
      : errorKind === 'quota'
        ? t(iosOr('onboarding.tryQuotaExceededIOS', 'onboarding.tryQuotaExceeded'))
        : t('onboarding.tryError');

  const isIdle = !askedQuestion && !loading && !reply && !errorKind;

  return (
    <div>
      {/* Header */}
      <div className="text-center mb-3">
        <div className={`${isLandscape ? 'w-12 h-12' : 'w-14 h-14'} mx-auto icon-bg-brand rounded-2xl flex items-center justify-center mb-2`}>
          <Sparkles className={isLandscape ? 'w-6 h-6' : 'w-7 h-7'} aria-hidden="true" />
        </div>
        <h2 className={`font-bold text-foreground ${isLandscape ? 'text-lg mb-1' : 'text-xl mb-1'}`}>
          {t('onboarding.tryTitle')}
        </h2>
        <p className={`text-muted-foreground ${isLandscape ? 'text-xs' : 'text-sm'}`}>
          {t('onboarding.tryDesc')}
        </p>
      </div>

      {/* Empty-KB hint — still allow trying, just nudge toward better accuracy */}
      {!hasKnowledgeBase && (
        <div className="flex items-start gap-2 p-3 alert-warning border rounded-xl mb-3 text-start">
          <Lightbulb className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs">{t('onboarding.tryEmptyKbHint')}</p>
        </div>
      )}

      {/* Chat area */}
      <div
        className={`bg-muted/50 rounded-2xl border border-theme-border p-3 mb-3 flex flex-col gap-2 ${
          isLandscape ? 'min-h-[100px]' : 'min-h-[140px]'
        }`}
        dir="auto"
      >
        {/* Customer question bubble (end-aligned) */}
        {askedQuestion && (
          <div className="flex justify-end">
            <div className="max-w-[80%] bg-card text-foreground border border-theme-border rounded-2xl rounded-ee-sm px-3 py-2 text-sm break-words">
              {askedQuestion}
            </div>
          </div>
        )}

        {/* Loading bubble (start-aligned, neutral — matches the reply bubble shape) */}
        {loading && (
          <div className="flex justify-start">
            <div
              className="flex items-center gap-2 bg-card text-muted-foreground border border-theme-border rounded-2xl rounded-se-sm px-3 py-2"
              aria-live="polite"
              aria-busy="true"
            >
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              <span className="text-sm">{t('onboarding.tryThinking')}</span>
            </div>
          </div>
        )}

        {/* AI reply bubble — `.reply-bubble` is the app's purpose-built, AA-contrast
            AI-reply style (teal-tinted emerald with foreground text), same as CommentCard. */}
        {!loading && reply && (
          <div className="flex flex-col items-start gap-1 animate-fade-in" aria-live="polite">
            <div className="max-w-[85%] reply-bubble border rounded-2xl rounded-se-sm px-3 py-2 text-sm whitespace-pre-wrap break-words">
              {reply}
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground ms-1">
              <Sparkles className="w-3 h-3" aria-hidden="true" />
              {t('onboarding.tryReplyBadge')}
            </span>
          </div>
        )}

        {/* Error / retry */}
        {!loading && errorKind && (
          <div className="flex items-start gap-2 p-2.5 alert-error border rounded-xl text-start" role="alert">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs">{errorMessage}</p>
          </div>
        )}

        {/* Idle placeholder */}
        {isIdle && (
          <div className="flex-1 flex items-center justify-center text-center">
            <p className="text-xs text-muted-foreground">{t('onboarding.tryPlaceholderHint')}</p>
          </div>
        )}
      </div>

      {/* Input row */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleTry();
            }
          }}
          maxLength={500}
          className="flex-1 min-w-0 p-3 border-2 border-theme-border rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-foreground bg-background text-sm placeholder:text-muted-foreground"
          placeholder={t('onboarding.trySampleQuestion')}
          aria-label={t('onboarding.tryQuestionLabel')}
          dir="auto"
        />
        <Button
          onClick={handleTry}
          disabled={!question.trim() || !pageId}
          loading={loading}
          className="flex-shrink-0"
        >
          {t('onboarding.tryButton')}
        </Button>
      </div>
    </div>
  );
}
