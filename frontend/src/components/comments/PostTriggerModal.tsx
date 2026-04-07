import React, { useState, useEffect } from 'react';
import { Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Modal, Button, Input, Textarea } from '@/components/ui';
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

  const [keyword, setKeyword] = useState(initialKeyword ?? '');
  const [reply, setReply] = useState(initialReply ?? '');
  const [saving, setSaving] = useState(false);

  // Sync when modal opens with fresh values
  useEffect(() => {
    if (isOpen) {
      setKeyword(initialKeyword ?? '');
      setReply(initialReply ?? '');
    }
  }, [isOpen, initialKeyword, initialReply]);

  async function handleSave() {
    if (!keyword.trim()) {
      toast.error(t('postTriggerKeywordRequired'));
      return;
    }
    if (!reply.trim()) {
      toast.error(t('postTriggerReplyRequired'));
      return;
    }

    setSaving(true);
    try {
      await postsApi.updateTrigger(postId, source, keyword.trim(), reply.trim());
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
    <Modal isOpen={isOpen} onClose={onClose} title={t('postTrigger')} size="sm">
      <div className="flex flex-col gap-4">
        {/* Post preview */}
        {postMessage && (
          <p className="text-sm text-muted-foreground line-clamp-2 bg-surface-50 dark:bg-surface-800 rounded-lg px-3 py-2">
            {postMessage}
          </p>
        )}

        {/* Active trigger badge */}
        {hasActiveTrigger && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 text-sm font-medium">
            <Zap className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            {t('postTriggerActive')}
          </div>
        )}

        {/* Keyword input */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="trigger-keyword">
            {t('postTriggerKeyword')}
          </label>
          <Input
            id="trigger-keyword"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder={t('postTriggerKeywordPlaceholder')}
            dir="auto"
            maxLength={100}
          />
        </div>

        {/* Reply textarea */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="trigger-reply">
            {t('postTriggerReply')}
          </label>
          <Textarea
            id="trigger-reply"
            value={reply}
            onChange={e => setReply(e.target.value)}
            placeholder={t('postTriggerReplyPlaceholder')}
            dir="auto"
            rows={4}
            maxLength={1000}
          />
        </div>

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
