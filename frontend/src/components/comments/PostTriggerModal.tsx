import React, { useCallback, useState, useEffect } from 'react';
import clsx from 'clsx';
import { PostReplyIcon, postReplyIconClass } from '@/utils/postReply';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { parseKeywords } from '@jawab24/shared';
import { Modal, Button, Textarea, KeywordChipInput, FormField, ConfirmationModal } from '@/components/ui';
import { postsApi } from '@/lib/api';
import { useSaveHandler } from '@/hooks/useSaveHandler';

type TriggerMode = 'keyword' | 'all';

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

  const [mode, setMode] = useState<TriggerMode>(() => (initialType === 'all' ? 'all' : 'keyword'));
  const [keywords, setKeywords] = useState<string[]>(() => parseKeywords(initialKeyword));
  const [reply, setReply] = useState(initialReply ?? '');
  const [confirmingClear, setConfirmingClear] = useState(false);

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

        {/* Post preview */}
        {postMessage && (
          <div className="bg-surface-50 dark:bg-surface-800 rounded-lg px-3 py-2.5">
            <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words leading-relaxed" dir="auto">
              {postMessage}
            </p>
          </div>
        )}

        {/* Active trigger badge */}
        {hasActiveTrigger && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 text-sm font-medium">
            <PostReplyIcon className={clsx('w-4 h-4 flex-shrink-0', postReplyIconClass)} aria-hidden="true" />
            {t('postTriggerActive')}
          </div>
        )}

        {/* Trigger mode: match keywords vs reply to any comment */}
        <FormField label={t('postTriggerMode')} htmlFor="trigger-mode">
          <div id="trigger-mode" role="radiogroup" aria-label={t('postTriggerMode')} className="grid grid-cols-2 gap-2">
            {(['keyword', 'all'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
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
        </FormField>

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

        {/* Reply textarea */}
        <FormField label={t('postTriggerReply')} htmlFor="trigger-reply">
          <Textarea
            id="trigger-reply"
            value={reply}
            onChange={e => setReply(e.target.value)}
            placeholder={mode === 'all' ? t('postTriggerAllReplyPlaceholder') : t('postTriggerReplyPlaceholder')}
            dir="auto"
            rows={4}
            maxLength={1000}
            className="resize-none leading-relaxed"
            style={{ fieldSizing: 'content', minHeight: '120px', maxHeight: '280px' } as React.CSSProperties}
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
