import React, { useCallback, useState, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { PostReplyIcon, postReplyIconClass } from '@/utils/postReply';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  parseKeywords,
  POST_REPLY_MAX_KEYWORDS,
  POST_REPLY_MAX_KEYWORD_LEN,
  POST_REPLY_MAX_REPLY_LEN as REPLY_MAX,
  POST_REPLY_IMAGE_MAX_BYTES,
  POST_REPLY_IMAGE_MIME_TYPES,
  POST_REPLY_CARD_CAPTION_MAX,
} from '@jawab24/shared';
import { MessageSquare, MessageCircle, ArrowUpRight, ImagePlus, Lock, X } from 'lucide-react';
import Link from 'next/link';
import { Modal, Button, Textarea, KeywordChipInput, FormField, ConfirmationModal, InfoPopover } from '@/components/ui';
import { PostContextCard } from './PostContextCard';
import { postsApi } from '@/lib/api';
import { useSaveHandler } from '@/hooks/useSaveHandler';
import { captureError } from '@/lib/sentryHelpers';
import { useCommentReplyMode, useDualReplyNudge, useTriggerImagesEnabled } from '@/hooks/useCommentReplyMode';
import { fileToBase64 } from '@/utils/fileToBase64';

type TriggerMode = 'keyword' | 'all';

// Reply/keyword/image limits are the SINGLE source of truth in @jawab24/shared —
// the backend validator enforces the same values (no frontend/backend drift).

/** Single source for how each delivery channel renders in the outcome rows:
 *  icon matching the app-wide channel glyphs (MessageCircle = DM, exactly as the
 *  nav's الرسائل الخاصة; MessageSquare = public comment, as the nav's التعليقات),
 *  label key, and pill colour (private = brand, public = sky). */
const CHANNEL_META = {
  private: {
    Icon: MessageCircle,
    labelKey: 'postTriggerChannelPrivate',
    pill: 'text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700',
  },
  public: {
    Icon: MessageSquare,
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
  triggerImageUrl?: string | null;
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
  triggerImageUrl: initialImageUrl,
  isOpen,
  onClose,
  onSaved,
}: PostTriggerModalProps) {
  const t = useTranslations('comments');
  const tc = useTranslations('common');
  const deliveryMode = useCommentReplyMode();
  const dualNudge = useDualReplyNudge();
  const imagesEnabled = useTriggerImagesEnabled();

  const [mode, setMode] = useState<TriggerMode>(() => (initialType === 'all' ? 'all' : 'keyword'));
  const [keywords, setKeywords] = useState<string[]>(() => parseKeywords(initialKeyword));
  const [reply, setReply] = useState(initialReply ?? '');
  const [confirmingClear, setConfirmingClear] = useState(false);

  // Image state. Two sources of truth, resolved into the picker:
  //  - `imageFile`: a newly picked file pending upload (base64 sent on save)
  //  - `initialImageUrl` + `imageRemoved`: the already-saved image and whether the
  //    merchant removed it this session.
  // The affordance is a small text button (image is optional, low-emphasis) that opens
  // the native file dialog directly — no space-consuming dropzone.
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageObjectUrl, setImageObjectUrl] = useState<string | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Roving-tabindex focus targets for the mode radiogroup (arrow-key navigation).
  const modeRefs = useRef<Record<TriggerMode, HTMLButtonElement | null>>({ keyword: null, all: null });

  const isDmMode = deliveryMode === 'private' || deliveryMode === 'dual';
  // The stored image is still attached unless removed this session.
  const hasStoredImage = !!initialImageUrl && !imageRemoved;
  // Image that will actually be DELIVERED: only in DM modes, and only if one is set.
  const hasImage = imagesEnabled && isDmMode && (imageFile !== null || hasStoredImage);
  // The editor cap is a flat 1000. When an image is attached, delivery depends on caption
  // length: ≤ card limit → the card shows the full caption; longer → a teaser + «Read more»,
  // and the tap delivers the full image + full text (drives the outcome preview below).
  const replyMax = REPLY_MAX;
  const replyOverLimit = reply.length > replyMax;
  const trimmedReply = reply.trim();
  const captionIsLong = trimmedReply.length > POST_REPLY_CARD_CAPTION_MAX;
  // Preview source: the freshly picked file (object URL) or the stored image.
  const imagePreviewSrc = imageObjectUrl ?? (hasStoredImage ? initialImageUrl! : null);

  // Sync when modal opens with fresh values (also reset image session state).
  useEffect(() => {
    if (isOpen) {
      setMode(initialType === 'all' ? 'all' : 'keyword');
      setKeywords(parseKeywords(initialKeyword));
      setReply(initialReply ?? '');
      setImageFile(null);
      setImageObjectUrl(null);
      setImageRemoved(false);
    }
  }, [isOpen, initialKeyword, initialReply, initialType]);

  // Revoke the object URL when it changes / unmounts to avoid leaking blob memory.
  useEffect(() => {
    return () => { if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl); };
  }, [imageObjectUrl]);

  const onSaveSuccess = useCallback(() => { onSaved(); onClose(); }, [onSaved, onClose]);
  // Save is handled manually (not via useSaveHandler) so the quota error can show its
  // OWN message instead of the generic one — the hook always toasts tc('error').
  const [savingSave, setSavingSave] = useState(false);
  const { handle: runClear, saving: savingClear } = useSaveHandler({
    context: 'PostTriggerModal.handleClear',
    successMessage: t('postTriggerCleared'),
    onSuccess: onSaveSuccess,
  });
  const saving = savingSave || savingClear;

  function pickFile(file: File) {
    if (!POST_REPLY_IMAGE_MIME_TYPES.includes(file.type as typeof POST_REPLY_IMAGE_MIME_TYPES[number])) {
      toast.error(t('postTriggerImageBadType'));
      return;
    }
    if (file.size > POST_REPLY_IMAGE_MAX_BYTES) {
      toast.error(t('postTriggerImageTooLarge'));
      return;
    }
    if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
    setImageFile(file);
    setImageObjectUrl(URL.createObjectURL(file));
    setImageRemoved(false);
  }

  function removeImage() {
    if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
    setImageFile(null);
    setImageObjectUrl(null);
    // Mark the stored image (if any) for removal on save.
    setImageRemoved(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

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

    // Resolve the image intent for the backend: a new file → set; an existing image
    // removed → null; otherwise undefined (leave as-is). Never send an image when the
    // feature is off — the send path can't deliver it.
    let imageArg: { base64: string; mimeType: string } | null | undefined;
    if (imagesEnabled) {
      if (imageFile) {
        imageArg = { base64: await fileToBase64(imageFile), mimeType: imageFile.type };
      } else if (imageRemoved && initialImageUrl) {
        imageArg = null;
      }
    }

    setSavingSave(true);
    try {
      await postsApi.updateTrigger(postId, source, keywordArg, reply.trim(), mode, imageArg);
      toast.success(t('postTriggerSaved'));
      onSaveSuccess();
    } catch (err) {
      // Quota is the one save error worth a specific message (mirrors KB limit UX);
      // everything else falls back to the generic error toast.
      const status = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
      if (status?.status === 413 && status?.data?.error === 'image_quota_exceeded') {
        toast.error(t('postTriggerImageQuota'));
      } else {
        captureError(err, 'PostTriggerModal.handleSave');
        toast.error(tc('error'));
      }
    } finally {
      setSavingSave(false);
    }
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
  // reply/sender.ts.
  const outcomeRows: { channel: 'private' | 'public'; verbatim: boolean; text?: string; fromSettings?: boolean }[] =
    deliveryMode === 'public'
      ? [{ channel: 'public', verbatim: true }]
      : deliveryMode === 'private'
        ? [{ channel: 'private', verbatim: true }]
        : deliveryMode === 'dual'
          ? [
              { channel: 'private', verbatim: true },
              { channel: 'public', verbatim: false, text: dualNudge.trim() || t('postTriggerDefaultNudge'), fromSettings: true },
            ]
          : [];

  const footer = (
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
        disabled={saving || replyOverLimit}
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
      titleAction={
        <span className="flex items-center gap-1.5">
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
        {postMessage && <PostContextCard postMessage={postMessage} clampLines={3} />}

        {/* Trigger mode: match keywords vs reply to any comment. */}
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
              maxKeywords={POST_REPLY_MAX_KEYWORDS}
              maxLength={POST_REPLY_MAX_KEYWORD_LEN}
            />
          </FormField>
        )}

        {/* Any-comment caution */}
        {mode === 'all' && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg alert-warning text-sm leading-relaxed" role="note">
            <span>{t('postTriggerAllCaution')}</span>
          </div>
        )}

        {/* Reply textarea — the counter cap flips to 160 while an image is attached. */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="trigger-reply" className="text-sm font-medium text-foreground">
              {t('postTriggerReply')}
            </label>
            <span
              className={clsx(
                'text-xs tabular-nums',
                replyOverLimit ? 'text-destructive font-semibold'
                  : reply.length > replyMax * 0.9 ? 'text-amber-600 dark:text-amber-400'
                  : 'text-muted-foreground',
              )}
              aria-live="polite"
              // Force LTR so the count reads "8 / 160" and never bidi-flips to "160 / 8"
              // when the modal sits inside <html dir="rtl">.
              dir="ltr"
            >
              {reply.length} / {replyMax}
            </span>
          </div>
          <Textarea
            id="trigger-reply"
            value={reply}
            onChange={e => setReply(e.target.value)}
            placeholder={mode === 'all' ? t('postTriggerAllReplyPlaceholder') : t('postTriggerReplyPlaceholder')}
            dir="auto"
            rows={4}
            // Flat 1000-char ceiling whether or not an image is attached — the image is
            // sent as its own message, so it never shortens the text budget.
            maxLength={REPLY_MAX}
            className="leading-relaxed"
            style={{ fieldSizing: 'content', resize: 'none', minHeight: '120px', maxHeight: '280px' } as React.CSSProperties}
          />
        </div>

        {/* Image affordance — only when the feature is configured server-side. */}
        {imagesEnabled && (
          <ImageAffordance
            isDmMode={isDmMode}
            previewSrc={imagePreviewSrc}
            fileInputRef={fileInputRef}
            onPick={pickFile}
            onRemove={removeImage}
            t={t}
          />
        )}

        {/* Outcome card — what the commenter actually receives, one row per channel. */}
        {deliveryMode !== null && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-foreground">{t('postTriggerOutcomeTitle')}</span>
              <InfoPopover label={t('postTriggerDeliveryLabel')}>
                {deliveryMode === 'public' && t('postTriggerDeliveryPublic')}
                {deliveryMode === 'private' && t('postTriggerDeliveryPrivate')}
                {deliveryMode === 'dual' && t('postTriggerDeliveryDual')}
              </InfoPopover>
            </div>
            <div className="rounded-xl border border-theme-border overflow-hidden">
              {outcomeRows.map((row, i) => {
                const { Icon, labelKey, pill } = CHANNEL_META[row.channel];
                // On the private (DM) row with an image, preview the image + reply text as ONE
                // message — Meta allows only one message on a comment→DM, so it's delivered
                // together: an inline image card for short replies, or the full text plus a
                // "view image" button for long ones (see the note below the preview).
                const showImage = row.channel === 'private' && hasImage && imagePreviewSrc;
                return (
                  <div
                    key={row.channel}
                    className={clsx('grid grid-cols-[auto_1fr] gap-2.5 px-3 py-2.5 items-start', i > 0 && 'border-t border-dashed border-theme-border')}
                  >
                    <span className={clsx('inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap', pill)}>
                      <Icon className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                      {t(labelKey)}
                    </span>
                    {showImage ? (
                      // What the customer actually receives (Meta allows one message on a cold
                      // comment→DM). SHORT caption: an image card showing the FULL caption, image
                      // tap opens it full-size. LONG caption: an image card with a teaser + a
                      // «Read more» button; the tap delivers the full text in-chat (the image stays
                      // in the card — tap it for full size — and is never re-sent).
                      <div className="flex flex-col gap-2">
                        {/* The card the customer sees first */}
                        <div className="rounded-lg border border-theme-border overflow-hidden max-w-[200px] bg-surface-50 dark:bg-surface-800">
                          <img src={imagePreviewSrc!} alt="" className="w-full max-h-28 object-cover" />
                          <div className="px-2.5 py-2">
                            <span className="block text-[13px] font-semibold text-foreground" dir="auto">
                              {captionIsLong
                                ? `${trimmedReply.slice(0, POST_REPLY_CARD_CAPTION_MAX)}…`
                                : (trimmedReply || t('postTriggerOutcomeAsWritten'))}
                            </span>
                          </div>
                          {captionIsLong && (
                            <div className="border-t border-theme-border py-2 text-center text-[12px] font-bold text-brand-600">
                              {t('postTriggerReadMore')}
                            </div>
                          )}
                        </div>
                        {captionIsLong ? (
                          // After «Read more», the full text arrives in-chat (the image is already
                          // in the card above — tap it for full size). A short note, not the whole text.
                          <span className="text-[11px] leading-snug text-subtle" dir="auto">{t('postTriggerReadMoreNote')}</span>
                        ) : (
                          <span className="text-[11px] leading-snug text-subtle" dir="auto">{t('postTriggerImageTapHint')}</span>
                        )}
                      </div>
                    ) : row.verbatim ? (
                      <span className="text-sm leading-relaxed text-muted-foreground" dir="auto">
                        {t('postTriggerOutcomeAsWritten')}
                      </span>
                    ) : (
                      <span className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground" dir="auto">
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
                    )}
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

/**
 * Low-emphasis, SPACE-EFFICIENT image affordance. The image is optional and most
 * merchants skip it, so it never takes a big dropzone: it's a small text button that
 * opens the native file dialog directly, becoming a compact thumbnail chip once a file
 * is chosen. In public mode it is a locked hint (images are DM-only) with a DELIBERATE
 * link to Settings — NOT a one-click toggle, because `commentReplyMode` is a
 * workspace-wide setting that also governs Smart AI reply delivery.
 */
function ImageAffordance(props: {
  isDmMode: boolean;
  previewSrc: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File) => void;
  onRemove: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const { isDmMode, previewSrc, fileInputRef, onPick, onRemove, t } = props;

  // Public mode → small locked hint. The image needs DM delivery; changing that mode is
  // a workspace-wide decision (affects Smart AI too), so we LINK to Settings rather than
  // flip it silently from here.
  if (!isDmMode) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" aria-hidden="true" />
          {t('postTriggerImageLockedHint')}
        </span>
        <Link
          href="/settings#comment-reply-mode-label"
          className="inline-flex items-center gap-0.5 font-semibold text-brand-600 hover:text-brand-700 hover:underline"
        >
          {t('postTriggerOutcomeSettingsLink')}
          <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept={POST_REPLY_IMAGE_MIME_TYPES.join(',')}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }}
      />
      {previewSrc ? (
        // Compact attached-image chip: small thumbnail + remove.
        <div className="inline-flex items-center gap-2.5 rounded-lg border border-surface-200 dark:border-surface-700 p-1.5 pe-2.5">
          <img src={previewSrc} alt="" className="w-9 h-9 rounded-md object-cover flex-shrink-0" />
          <span className="text-xs text-muted-foreground">{t('postTriggerImageDmOnly')}</span>
          <button
            type="button"
            onClick={onRemove}
            aria-label={t('postTriggerImageRemove')}
            className="inline-flex items-center rounded-md p-1 text-destructive hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        // Small, low-emphasis trigger → opens the native file dialog directly.
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-brand-700 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors"
        >
          <ImagePlus className="w-4 h-4" aria-hidden="true" />
          {t('postTriggerImageAdd')}
          <span className="font-normal text-subtle">{t('postTriggerImageOptional')}</span>
        </button>
      )}
    </div>
  );
}
