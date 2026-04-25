import React, { useCallback, useState, useEffect } from 'react';
import { Hash } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { parseKeywords } from '@jawab24/shared';
import { Modal, Button, Textarea, KeywordChipInput, FormField } from '@/components/ui';
import { postsApi } from '@/lib/api';
import { useSaveHandler } from '@/hooks/useSaveHandler';

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

  // Sync when modal opens with fresh values
  useEffect(() => {
    if (isOpen) {
      setKeywords(parseKeywords(initialKeyword));
      setReply(initialReply ?? '');
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

  async function handleClear() {
    await runClear(() => postsApi.updateTrigger(postId, source, null, null));
  }

  const hasActiveTrigger = !!(initialKeyword && initialReply);

  const footer = (
    <div className="flex items-center justify-end">
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

        {/* Active trigger badge — Clear lives here, not in the footer, so destructive
            and primary actions don't sit side-by-side at equal prominence */}
        {hasActiveTrigger && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-brand-50 dark:bg-brand-900/20 text-sm">
            <div className="flex items-center gap-2 text-brand-600 dark:text-brand-400 font-medium">
              <Hash className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              {t('postTriggerActive')}
            </div>
            <button
              type="button"
              onClick={handleClear}
              disabled={saving}
              className="text-destructive hover:underline text-xs font-medium disabled:opacity-50"
            >
              {t('postTriggerClear')}
            </button>
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
          />
        </FormField>
      </div>
    </Modal>
  );
}
