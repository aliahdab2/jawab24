import React, { useCallback, useState, useEffect } from 'react';
import clsx from 'clsx';
import { Hash, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { parseKeywords } from '@jawab24/shared';
import { Modal, Button, Textarea, KeywordChipInput, FormField, ConfirmationModal } from '@/components/ui';
import { postsApi } from '@/lib/api';
import { useSaveHandler } from '@/hooks/useSaveHandler';

type ReplyMode = 'all' | 'keyword';

interface PostTriggerModalProps {
  postId: string;
  source: 'facebook' | 'instagram';
  postMessage?: string | null;
  triggerKeyword?: string | null;
  triggerReply?: string | null;
  replyToAll?: boolean;
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
  replyToAll: initialReplyToAll = false,
  isOpen,
  onClose,
  onSaved,
}: PostTriggerModalProps) {
  const t = useTranslations('comments');

  // Default mode: 'keyword' for new posts. The "all" mode disables Smart Replies
  // for the post, which is the more destructive choice — merchants must opt into
  // it consciously. Existing rows load with whichever mode their data implies.
  const initialMode: ReplyMode = initialReplyToAll
    ? 'all'
    : 'keyword';

  const [mode, setMode] = useState<ReplyMode>(initialMode);
  const [keywords, setKeywords] = useState<string[]>(() => parseKeywords(initialKeyword));
  const [reply, setReply] = useState(initialReply ?? '');
  const [confirmingClear, setConfirmingClear] = useState(false);

  // Sync when modal opens with fresh values
  useEffect(() => {
    if (isOpen) {
      setMode(initialReplyToAll ? 'all' : 'keyword');
      setKeywords(parseKeywords(initialKeyword));
      setReply(initialReply ?? '');
    }
  }, [isOpen, initialKeyword, initialReply, initialReplyToAll]);

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
    if (!reply.trim()) {
      toast.error(t('postTriggerReplyRequired'));
      return;
    }
    if (mode === 'keyword' && keywords.length === 0) {
      toast.error(t('postTriggerKeywordRequired'));
      return;
    }
    const replyToAll = mode === 'all';
    const keywordPayload = mode === 'keyword' ? keywords.join(', ') : null;
    await runSave(() => postsApi.updateTrigger(postId, source, keywordPayload, reply.trim(), replyToAll));
  }

  function requestClear() {
    setConfirmingClear(true);
  }

  async function handleConfirmClear() {
    setConfirmingClear(false);
    await runClear(() => postsApi.updateTrigger(postId, source, null, null, false));
  }

  const hasActiveTrigger = !!(initialReply && (initialKeyword || initialReplyToAll));

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
      title={t('postTrigger')}
      size="sm"
      mobilePresentation="fullscreen"
      footer={footer}
    >
      <div className="flex flex-col gap-4">
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
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 text-sm font-medium">
            <Hash className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            {t('postTriggerActive')}
          </div>
        )}

        {/* Reply textarea (always shown — the message itself, regardless of scope) */}
        <FormField label={t('postTriggerReply')} htmlFor="trigger-reply">
          <Textarea
            id="trigger-reply"
            value={reply}
            onChange={e => setReply(e.target.value)}
            placeholder={t('postTriggerReplyPlaceholder')}
            dir="auto"
            rows={4}
            maxLength={1000}
          />
        </FormField>

        {/* Mode selector — when to send the reply */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium mb-2">{t('postTriggerModeLegend')}</legend>

          <label className="flex items-start gap-3 p-3 rounded-lg border border-surface-200 dark:border-surface-700 cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800/50">
            <input
              type="radio"
              name="reply-mode"
              value="all"
              checked={mode === 'all'}
              onChange={() => setMode('all')}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">{t('postTriggerModeAll')}</div>
              {mode === 'all' && (
                <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
                  <span>{t('postTriggerModeAllWarning')}</span>
                </div>
              )}
            </div>
          </label>

          <label className="flex items-start gap-3 p-3 rounded-lg border border-surface-200 dark:border-surface-700 cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800/50">
            <input
              type="radio"
              name="reply-mode"
              value="keyword"
              checked={mode === 'keyword'}
              onChange={() => setMode('keyword')}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">{t('postTriggerModeKeyword')}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{t('postTriggerModeKeywordHelp')}</div>
              {mode === 'keyword' && (
                <div className="mt-3">
                  <KeywordChipInput
                    id="trigger-keyword"
                    value={keywords}
                    onChange={setKeywords}
                    placeholder={t('postTriggerKeywordPlaceholder')}
                    maxKeywords={10}
                    maxLength={100}
                  />
                </div>
              )}
            </div>
          </label>
        </fieldset>
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
