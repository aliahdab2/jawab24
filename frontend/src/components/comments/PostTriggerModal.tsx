import React, { useCallback, useState, useEffect } from 'react';
import clsx from 'clsx';
import { FileText } from 'lucide-react';
import { PostReplyIcon, postReplyIconClass } from '@/utils/postReply';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { parseKeywords } from '@jawab24/shared';
import { Modal, Button, Textarea, KeywordChipInput, FormField, ConfirmationModal } from '@/components/ui';
import { postsApi } from '@/lib/api';
import { useSaveHandler } from '@/hooks/useSaveHandler';
import { useClampOverflow } from '@/hooks';

interface PostTriggerModalProps {
  postId: string;
  source: 'facebook' | 'instagram';
  postMessage?: string | null;
  triggerKeyword?: string | null;
  triggerReply?: string | null;
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
  isOpen,
  onClose,
  onSaved,
}: PostTriggerModalProps) {
  const t = useTranslations('comments');

  const [keywords, setKeywords] = useState<string[]>(() => parseKeywords(initialKeyword));
  const [reply, setReply] = useState(initialReply ?? '');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [postExpanded, setPostExpanded] = useState(false);

  // Show "Show more" only when the clamped post actually overflows 3 lines.
  const { ref: postRef, isOverflowing: postOverflows } = useClampOverflow<HTMLParagraphElement>(
    postMessage,
    postExpanded,
  );

  // Sync when modal opens with fresh values
  useEffect(() => {
    if (isOpen) {
      setKeywords(parseKeywords(initialKeyword));
      setReply(initialReply ?? '');
      setPostExpanded(false);
    }
  }, [isOpen, initialKeyword, initialReply]);

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
    if (keywords.length === 0) {
      toast.error(t('postTriggerKeywordRequired'));
      return;
    }
    if (!reply.trim()) {
      toast.error(t('postTriggerReplyRequired'));
      return;
    }
    await runSave(() => postsApi.updateTrigger(postId, source, keywords.join(', '), reply.trim()));
  }

  function requestClear() {
    setConfirmingClear(true);
  }

  async function handleConfirmClear() {
    setConfirmingClear(false);
    await runClear(() => postsApi.updateTrigger(postId, source, null, null));
  }

  const hasActiveTrigger = !!(initialKeyword && initialReply);

  const footer = (
    <div className={clsx('flex items-center gap-3', hasActiveTrigger ? 'justify-between' : 'justify-end')}>
      {hasActiveTrigger && (
        <Button
          variant="ghost"
          size="sm"
          onClick={requestClear}
          disabled={saving}
          className="text-destructive hover:text-destructive"
        >
          {t('postTriggerClear')}
        </Button>
      )}
      <Button onClick={handleSave} disabled={saving} size="sm">
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
      size="sm"
      mobilePresentation="fullscreen"
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        {/* What a Post Reply is — fixed, self-written message (channel-neutral copy).
            The Post Reply icon already appears in the modal title (the feature's identity). */}
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t('postTriggerDescription')}
        </p>

        {/* Post preview — a labeled "POST" card matching CommentDetailModal, so it
            reads as the post this reply is configured for and themes correctly in dark
            mode (bg-surface-800 is near-white in the dark scale — see globals.css).
            Collapsed to 3 lines by default (keeps the keyword + reply fields above the
            fold on mobile) with a show-more toggle for long posts. */}
        {postMessage && (
          <div className="rounded-xl border border-theme-border bg-card overflow-hidden shadow-sm">
            {/* Emerald header band — Post Reply's identity colour (matches the KeyRound
                title icon / keyword chips), so the card reads as part of this feature.
                Body stays neutral so the post text is maximally readable. */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 border-b border-emerald-100 dark:border-emerald-800/50">
              <FileText className="w-3.5 h-3.5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                {t('postContext')}
              </span>
            </div>
            {/* Collapsed to 3 lines so a long post keeps the keyword + reply fields
                above the fold on mobile; expandable in place when it overflows. */}
            <p
              ref={postRef}
              className={clsx(
                'px-3 pt-2.5 pb-2 text-sm text-muted-foreground whitespace-pre-wrap break-words leading-relaxed',
                !postExpanded && 'line-clamp-3',
              )}
              dir="auto"
            >
              {postMessage}
            </p>
            {(postOverflows || postExpanded) && (
              <button
                type="button"
                onClick={() => setPostExpanded(v => !v)}
                aria-expanded={postExpanded}
                className="block w-full px-3 pb-2.5 text-start text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
              >
                {postExpanded ? t('postShowLess') : t('postShowMore')}
              </button>
            )}
          </div>
        )}

        {/* Active trigger badge */}
        {hasActiveTrigger && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 text-sm font-medium">
            <PostReplyIcon className={clsx('w-4 h-4 flex-shrink-0', postReplyIconClass)} aria-hidden="true" />
            {t('postTriggerActive')}
          </div>
        )}

        {/* Keyword chip input */}
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

        {/* Reply textarea */}
        <FormField label={t('postTriggerReply')} htmlFor="trigger-reply">
          <Textarea
            id="trigger-reply"
            value={reply}
            onChange={e => setReply(e.target.value)}
            placeholder={t('postTriggerReplyPlaceholder')}
            dir="auto"
            rows={4}
            maxLength={1000}
            className="leading-relaxed"
            // resize:none is set inline, not via a class: the base Textarea hardcodes
            // `resize-y`, which wins over a `resize-none` class in Tailwind's cascade and
            // leaves a resize grip in the corner (a stray "dot" in the RTL bottom corner).
            // The field auto-sizes via fieldSizing, so manual resize is never wanted here.
            style={{ fieldSizing: 'content', resize: 'none', minHeight: '120px', maxHeight: '280px' } as React.CSSProperties}
          />
        </FormField>
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
