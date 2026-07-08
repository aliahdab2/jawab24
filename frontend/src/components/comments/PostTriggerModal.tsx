import React, { useCallback, useState, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { PostReplyIcon, postReplyIconClass } from '@/utils/postReply';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { parseKeywords } from '@jawab24/shared';
import { MessageCircle, Mail, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { Modal, Button, Textarea, KeywordChipInput, FormField, ConfirmationModal, InfoPopover, Badge } from '@/components/ui';
import { PostContextCard } from './PostContextCard';
import { postsApi } from '@/lib/api';
import { useSaveHandler } from '@/hooks/useSaveHandler';
import { useCommentReplyMode, useDualReplyNudge } from '@/hooks/useCommentReplyMode';

type TriggerMode = 'keyword' | 'all';

/** Max length of the reply message — mirrored by the textarea cap and the counter. */
const REPLY_MAX = 1000;

/** Single source for how each delivery channel renders in the outcome rows:
 *  icon (Mail = private DM, MessageCircle = public comment), label key, and pill
 *  colour (private = brand, public = sky). */
const CHANNEL_META = {
  private: {
    Icon: Mail,
    labelKey: 'postTriggerChannelPrivate',
    pill: 'text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700',
  },
  public: {
    Icon: MessageCircle,
    labelKey: 'postTriggerChannelPublic',
    pill: 'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800',
  },
} as const;

interface PostTriggerModalProps {
  postId: string;
  source: 'facebook' | 'instagram';
  postMessage?: string | null;
  triggerKeyword?: string | null;
  triggerReply?: string | null;
  triggerType?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function PostTriggerModal({
  postId,
  source,
  postMessage,
  triggerKeyword: initialKeyword,
  triggerReply: initialReply,
  triggerType: initialType,
  isOpen,
  onClose,
  onSaved,
}: PostTriggerModalProps) {
  const t = useTranslations('comments');
  const tc = useTranslations('common');
  const deliveryMode = useCommentReplyMode();
  const dualNudge = useDualReplyNudge();

  const [mode, setMode] = useState<TriggerMode>(() => (initialType === 'all' ? 'all' : 'keyword'));
  const [keywords, setKeywords] = useState<string[]>(() => parseKeywords(initialKeyword));
  const [reply, setReply] = useState(initialReply ?? '');
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Roving-tabindex focus targets for the mode radiogroup (arrow-key navigation).
  const modeRefs = useRef<Record<TriggerMode, HTMLButtonElement | null>>({ keyword: null, all: null });

  // Sync when modal opens with fresh values
  useEffect(() => {
    if (isOpen) {
      setMode(initialType === 'all' ? 'all' : 'keyword');
      setKeywords(parseKeywords(initialKeyword));
      setReply(initialReply ?? '');
    }
  }, [isOpen, initialKeyword, initialReply, initialType]);

  const onSaveSuccess = useCallback(() => { onSaved(); onClose(); }, [onSaved, onClose]);
  const { handle: runSave, saving: savingSave } = useSaveHandler({
    context: 'PostTriggerModal.handleSave',
    successMessage: t('postTriggerSaved'),
    onSuccess: onSaveSuccess,
  });
  const { handle: runClear, saving: savingClear } = useSaveHandler({
    context: 'PostTriggerModal.handleClear',
    successMessage: t('postTriggerCleared'),
    onSuccess: onSaveSuccess,
  });
  const saving = savingSave || savingClear;

  async function handleSave() {
    if (mode === 'keyword' && keywords.length === 0) {
      toast.error(t('postTriggerKeywordRequired'));
      return;
    }
    if (!reply.trim()) {
      toast.error(t('postTriggerReplyRequired'));
      return;
    }
    const keywordArg = mode === 'all' ? null : keywords.join(', ');
    await runSave(() => postsApi.updateTrigger(postId, source, keywordArg, reply.trim(), mode));
  }

  function requestClear() {
    setConfirmingClear(true);
  }

  async function handleConfirmClear() {
    setConfirmingClear(false);
    await runClear(() => postsApi.updateTrigger(postId, source, null, null));
  }

  // A rule is active whenever a reply is set — keyword mode carries keyword+reply,
  // any-comment mode carries a reply only.
  const hasActiveTrigger = !!initialReply;

  // Outcome rows — exactly what the commenter receives, per the workspace delivery
  // mode (from Settings; not overridable here). In dual mode the Post Reply is the
  // PRIVATE message and a SEPARATE static comment is posted publicly — see
  // reply/sender.ts. Empty reply shows a placeholder in its row. Rows are empty
  // while the mode is still loading (deliveryMode null) so nothing wrong is shown.
  const replyTrimmed = reply.trim();
  const replyRowText = replyTrimmed || t('postTriggerPreviewEmpty');
  const outcomeRows: { channel: 'private' | 'public'; text: string; fromSettings: boolean; emptyReply: boolean }[] =
    deliveryMode === 'public'
      ? [{ channel: 'public', text: replyRowText, fromSettings: false, emptyReply: !replyTrimmed }]
      : deliveryMode === 'private'
        ? [{ channel: 'private', text: replyRowText, fromSettings: false, emptyReply: !replyTrimmed }]
        : deliveryMode === 'dual'
          ? [
              { channel: 'private', text: replyRowText, fromSettings: false, emptyReply: !replyTrimmed },
              { channel: 'public', text: dualNudge.trim() || t('postTriggerDefaultNudge'), fromSettings: true, emptyReply: false },
            ]
          : [];

  const footer = (
    // Mobile: primary action goes full-width on top (col-reverse ⇒ Save above
    // Remove), a strong thumb target on the fullscreen sheet. Desktop: inline
    // row — Remove at the start edge, Save at the end.
    <div
      className={clsx(
        'flex flex-col-reverse gap-2 sm:flex-row sm:items-center',
        hasActiveTrigger ? 'sm:justify-between' : 'sm:justify-end',
      )}
    >
      {hasActiveTrigger && (
        <Button
          variant="ghost"
          size="sm"
          onClick={requestClear}
          disabled={saving}
          className="w-full sm:w-auto text-destructive hover:text-destructive"
        >
          {t('postTriggerClear')}
        </Button>
      )}
      <Button
        onClick={handleSave}
        disabled={saving}
        loading={savingSave}
        className="w-full sm:w-auto"
      >
        {t('postTriggerSave')}
      </Button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={hasActiveTrigger ? t('postTriggerEdit') : t('postTriggerCta')}
      titleIcon={<PostReplyIcon className={clsx('w-5 h-5', postReplyIconClass)} aria-hidden="true" />}
      // Header actions: a compact "active" pill in edit mode (replaces the old
      // full-width badge row — same info, no body space) + the "what it is" tooltip
      // (available on demand, never occupying the form flow).
      titleAction={
        <span className="flex items-center gap-1.5">
          {/* Bespoke (not the shared Badge): "Post Reply active" is sky app-wide —
              the comment-card active state + post-context header — and Badge has no
              sky variant. Single instance, so no duplication. */}
          {hasActiveTrigger && (
            <span
              title={t('postTriggerActive')}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 text-[11px] font-semibold whitespace-nowrap"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500 dark:bg-sky-400" aria-hidden="true" />
              {tc('active')}
            </span>
          )}
          <InfoPopover label={t('postTriggerAboutLabel')}>
            {t('postTriggerDescription')}
          </InfoPopover>
        </span>
      }
      size="sm"
      mobilePresentation="fullscreen"
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        {/* Post preview — the post this reply is configured for. Clamped to 3 lines
            (keeps the keyword + reply fields above the fold on mobile) with a show-more
            toggle for long posts. */}
        {postMessage && <PostContextCard postMessage={postMessage} clampLines={3} />}

        {/* Trigger mode: match keywords vs reply to any comment.
            Not wrapped in FormField — its <label htmlFor> needs a labelable control,
            and a radiogroup div isn't one; aria-labelledby is the correct association.
            WAI-ARIA radio semantics: roving tabindex + arrow keys move the selection. */}
        <div className="flex flex-col gap-1.5">
          <span id="trigger-mode-label" className="text-sm font-medium text-foreground">
            {t('postTriggerMode')}
          </span>
          <div role="radiogroup" aria-labelledby="trigger-mode-label" className="grid grid-cols-2 gap-2">
            {(['keyword', 'all'] as const).map((m) => (
              <button
                key={m}
                ref={(el) => { modeRefs.current[m] = el; }}
                type="button"
                role="radio"
                aria-checked={mode === m}
                tabIndex={mode === m ? 0 : -1}
                onClick={() => setMode(m)}
                onKeyDown={(e) => {
                  // Two options — any arrow key moves selection (and focus) to the other.
                  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                    e.preventDefault();
                    const other: TriggerMode = m === 'keyword' ? 'all' : 'keyword';
                    setMode(other);
                    modeRefs.current[other]?.focus();
                  }
                }}
                className={clsx(
                  'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                  mode === m
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300'
                    : 'border-surface-200 dark:border-surface-700 text-muted-foreground hover:bg-surface-50 dark:hover:bg-surface-800',
                )}
              >
                {m === 'keyword' ? t('postTriggerModeKeyword') : t('postTriggerModeAll')}
              </button>
            ))}
          </div>
        </div>

        {/* Keyword chip input — only in keyword mode */}
        {mode === 'keyword' && (
          <FormField
            label={t('postTriggerKeyword')}
            htmlFor="trigger-keyword"
            helper={t('postTriggerKeywordHelp')}
          >
            <KeywordChipInput
              id="trigger-keyword"
              value={keywords}
              onChange={setKeywords}
              placeholder={t('postTriggerKeywordPlaceholder')}
              maxKeywords={10}
              maxLength={100}
            />
          </FormField>
        )}

        {/* Any-comment caution */}
        {mode === 'all' && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg alert-warning text-sm leading-relaxed" role="note">
            <span>{t('postTriggerAllCaution')}</span>
          </div>
        )}

        {/* Reply textarea — label row carries a live character counter (the field
            is capped at REPLY_MAX; the count turns amber as it approaches the limit
            so the wall is never hit blind). */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="trigger-reply" className="text-sm font-medium text-foreground">
              {t('postTriggerReply')}
            </label>
            <span
              className={clsx(
                'text-xs tabular-nums',
                reply.length >= REPLY_MAX ? 'text-destructive'
                  : reply.length > REPLY_MAX * 0.9 ? 'text-amber-600 dark:text-amber-400'
                  : 'text-muted-foreground',
              )}
              aria-live="polite"
            >
              {reply.length} / {REPLY_MAX}
            </span>
          </div>
          <Textarea
            id="trigger-reply"
            value={reply}
            onChange={e => setReply(e.target.value)}
            placeholder={mode === 'all' ? t('postTriggerAllReplyPlaceholder') : t('postTriggerReplyPlaceholder')}
            dir="auto"
            rows={4}
            maxLength={REPLY_MAX}
            className="leading-relaxed"
            // resize:none is set inline, not via a class: the base Textarea hardcodes
            // `resize-y`, which wins over a `resize-none` class in Tailwind's cascade and
            // leaves a resize grip in the corner (a stray "dot" in the RTL bottom corner).
            // The field auto-sizes via fieldSizing, so manual resize is never wanted here.
            style={{ fieldSizing: 'content', resize: 'none', minHeight: '120px', maxHeight: '280px' } as React.CSSProperties}
          />
        </div>

        {/* Outcome card — what the commenter actually receives, one row per channel.
            Hidden until the delivery mode resolves (deliveryMode !== null) so a wrong
            delivery claim is never shown. The "how it's delivered" sentence sits in an
            info tooltip; in dual mode the static public comment links to the exact
            Settings field that owns it. */}
        {deliveryMode !== null && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-foreground">{t('postTriggerOutcomeTitle')}</span>
              <InfoPopover label={t('postTriggerDeliveryLabel')}>
                {deliveryMode === 'public' && t('postTriggerDeliveryPublic')}
                {deliveryMode === 'private' && t('postTriggerDeliveryPrivate')}
                {deliveryMode === 'dual' && t('postTriggerDeliveryDual')}
              </InfoPopover>
              <Badge variant="info" size="sm" className="ms-auto">{t('postTriggerOutcomeLive')}</Badge>
            </div>
            <div className="rounded-xl border border-theme-border overflow-hidden">
              {outcomeRows.map((row, i) => {
                const { Icon, labelKey, pill } = CHANNEL_META[row.channel];
                return (
                  <div
                    key={row.channel}
                    className={clsx('grid grid-cols-[auto_1fr] gap-2.5 px-3 py-2.5 items-start', i > 0 && 'border-t border-dashed border-theme-border')}
                  >
                    <span className={clsx('inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap', pill)}>
                      <Icon className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                      {t(labelKey)}
                    </span>
                    <span
                      className={clsx('text-sm leading-relaxed whitespace-pre-wrap break-words', row.emptyReply ? 'italic text-muted-foreground' : 'text-foreground')}
                      dir="auto"
                    >
                      {row.text}
                      {row.fromSettings && (
                        <Link
                          href="/settings#comment-reply-mode-label"
                          className="ms-1.5 align-[1px] inline-flex items-center gap-0.5 text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline whitespace-nowrap"
                        >
                          {t('postTriggerOutcomeSettingsLink')}
                          <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                        </Link>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <ConfirmationModal
        isOpen={confirmingClear}
        onClose={() => setConfirmingClear(false)}
        onConfirm={handleConfirmClear}
        title={t('postTriggerClearConfirmTitle')}
        message={t('postTriggerClearConfirmMessage')}
        confirmText={t('postTriggerClear')}
        variant="danger"
        loading={savingClear}
      />
    </Modal>
  );
}
