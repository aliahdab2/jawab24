import React, { useState, useEffect } from 'react';
import { Hash } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { parseKeywords } from '@jawab24/shared';
import { Modal, Button, Textarea, KeywordChipInput, FormField } from '@/components/ui';
import { postsApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';

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
  const tc = useTranslations('common');

  const [keywords, setKeywords] = useState<string[]>(() => parseKeywords(initialKeyword));
  const [reply, setReply] = useState(initialReply ?? '');
  const [saving, setSaving] = useState(false);

  // Sync when modal opens with fresh values
  useEffect(() => {
    if (isOpen) {
      setKeywords(parseKeywords(initialKeyword));
      setReply(initialReply ?? '');
    }
  }, [isOpen, initialKeyword, initialReply]);

  async function handleSave() {
    if (keywords.length === 0) {
      toast.error(t('postTriggerKeywordRequired'));
      return;
    }
    if (!reply.trim()) {
      toast.error(t('postTriggerReplyRequired'));
      return;
    }

    setSaving(true);
    try {
      await postsApi.updateTrigger(postId, source, keywords.join(', '), reply.trim());
      toast.success(t('postTriggerSaved'));
      onSaved();
      onClose();
    } catch (err) {
      captureError(err, 'PostTriggerModal.handleSave');
      toast.error(tc('error'));
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    try {
      await postsApi.updateTrigger(postId, source, null, null);
      toast.success(t('postTriggerCleared'));
      onSaved();
      onClose();
    } catch (err) {
      captureError(err, 'PostTriggerModal.handleClear');
      toast.error(tc('error'));
    } finally {
      setSaving(false);
    }
  }

  const hasActiveTrigger = !!(initialKeyword && initialReply);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('postTrigger')} size="sm" mobilePresentation="fullscreen">
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

        {/* Actions */}
        <div className="flex items-center justify-between gap-3 pt-1">
          {hasActiveTrigger ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              disabled={saving}
              className="text-destructive hover:text-destructive"
            >
              {t('postTriggerClear')}
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={handleSave} disabled={saving} size="sm">
            {t('postTriggerSave')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
