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
  POST_REPLY_BUTTON_LABEL_MAX,
  POST_REPLY_BUTTON_TEXT_MAX,
  normalizeHttpUrl,
} from '@jawab24/shared';
import { MessageSquare, MessageCircle, ArrowUpRight, CalendarClock, ChevronDown, ImagePlus, Lock, X } from 'lucide-react';
import Link from 'next/link';
import { Modal, Button, Textarea, KeywordChipInput, FormField, ConfirmationModal, InfoPopover, Toggle, Input, WhatsAppIcon } from '@/components/ui';
import { PostContextCard } from './PostContextCard';
import { postsApi } from '@/lib/api';
import { useSaveHandler } from '@/hooks/useSaveHandler';
import { captureError } from '@/lib/sentryHelpers';
import { useCommentReplyMode, useDualReplyNudge, useTriggerImagesEnabled } from '@/hooks/useCommentReplyMode';
import { fileToBase64 } from '@/utils/fileToBase64';
import { buildWhatsAppUrl, extractWhatsAppNumber } from '@/lib/whatsapp';
import { normalizeInternationalPhone } from '@/utils/phone';
import { useLanguage } from '@/i18n/hooks';
import { formatScheduledTime } from '@/utils/dateUtils';

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
    pill: 'text-brand-700 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700',
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
  triggerExcludeKeyword?: string | null;
  triggerButtonLabel?: string | null;
  triggerButtonUrl?: string | null;
  triggerImageUrl?: string | null;
  likeComment?: boolean;
  tagCommenter?: boolean;
  /** True when the post is still scheduled on Facebook: the trigger saves normally and
   *  simply waits for the post to go live. Drives the notice so "saved" doesn't read as
   *  "already replying" — independent of whether Graph gave us a publish time. */
  isScheduled?: boolean;
  /** The pending post's publish time, when Graph reported one. Copy only. */
  scheduledPublishTime?: string | null;
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
  triggerExcludeKeyword: initialExcludeKeyword,
  triggerButtonLabel: initialButtonLabel,
  triggerButtonUrl: initialButtonUrl,
  triggerImageUrl: initialImageUrl,
  likeComment: initialLikeComment,
  tagCommenter: initialTagCommenter,
  isScheduled,
  scheduledPublishTime,
  isOpen,
  onClose,
  onSaved,
}: PostTriggerModalProps) {
  const t = useTranslations('comments');
  const tc = useTranslations('common');
  const { dateLocale } = useLanguage();
  const deliveryMode = useCommentReplyMode();
  const dualNudge = useDualReplyNudge();
  const imagesEnabled = useTriggerImagesEnabled();

  const [mode, setMode] = useState<TriggerMode>(() => (initialType === 'all' ? 'all' : 'keyword'));
  const [keywords, setKeywords] = useState<string[]>(() => parseKeywords(initialKeyword));
  // Veto keywords (ManyChat parity): a comment containing any of these never fires the
  // rule and falls through to the AI pipeline. Optional, both trigger modes.
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>(() => parseKeywords(initialExcludeKeyword));
  // CTA button (ManyChat "auto-DM a link" parity). DM-modes only + Facebook only.
  // Label + URL are set/cleared together; an empty pair means no button.
  // Two KINDS share the same stored pair: a plain link, or a WhatsApp contact button
  // whose URL is a wa.me deep link built from a phone number. Messenger has no native
  // WhatsApp button — a wa.me web_url IS the industry mechanism (ManyChat/Chatfuel),
  // so the backend/delivery path is untouched; the kind is inferred from the URL.
  const initialWaDigits = initialButtonUrl ? extractWhatsAppNumber(initialButtonUrl) : null;
  const [buttonKind, setButtonKind] = useState<'link' | 'whatsapp'>(initialWaDigits ? 'whatsapp' : 'link');
  const [buttonLabel, setButtonLabel] = useState(initialButtonLabel ?? '');
  const [buttonUrl, setButtonUrl] = useState(initialWaDigits ? '' : (initialButtonUrl ?? ''));
  const [whatsappPhone, setWhatsappPhone] = useState(initialWaDigits ? `+${initialWaDigits}` : '');
  const [reply, setReply] = useState(initialReply ?? '');
  // Like-the-comment option (ManyChat parity). Facebook only — the Instagram API
  // has no like-comment endpoint, so the row is hidden entirely for IG posts.
  const [likeEnabled, setLikeEnabled] = useState(initialLikeComment ?? false);
  // Mention-the-commenter option. Facebook only: Instagram mentions are `@username`, a
  // different mechanism we don't implement, so the row is hidden for IG posts exactly as
  // the like row is.
  const [tagEnabled, setTagEnabled] = useState(initialTagCommenter ?? false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  // «خيارات إضافية» disclosure — holds the POWER features only (exclude keywords +
  // CTA button: both need typing/validation). The image and like options stay at the
  // top level: the image is part of composing the message, the like is a zero-cost
  // one-tap toggle — burying either kills discovery for no gain. Collapsed for a new
  // trigger; auto-expanded when the stored trigger already uses an advanced field —
  // collapsing would hide live configuration.
  const advancedUsed = !!(initialExcludeKeyword || initialButtonLabel || initialButtonUrl);
  const [advancedOpen, setAdvancedOpen] = useState(advancedUsed);

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
  // Same pattern for the button-kind radiogroup (link / WhatsApp).
  const kindRefs = useRef<Record<'link' | 'whatsapp', HTMLButtonElement | null>>({ link: null, whatsapp: null });

  const isDmMode = deliveryMode === 'private' || deliveryMode === 'dual';
  // The stored image is still attached unless removed this session.
  const hasStoredImage = !!initialImageUrl && !imageRemoved;
  // Image that will actually be DELIVERED: only in DM modes, and only if one is set.
  const hasImage = imagesEnabled && isDmMode && (imageFile !== null || hasStoredImage);
  // CTA button is Facebook-only + DM-channel-only (the sender gates by mode). "Active"
  // means both fields are filled — the pair is stored/cleared together. The "target"
  // is the kind-specific second half of the pair: a URL, or a WhatsApp phone number.
  const ctaSupported = source === 'facebook' && isDmMode;
  const ctaTarget = buttonKind === 'whatsapp' ? whatsappPhone : buttonUrl;
  const ctaActive = ctaSupported && buttonLabel.trim() !== '' && ctaTarget.trim() !== '';
  // The editor cap is a flat 1000, EXCEPT when a CTA button rides WITHOUT an image: then the
  // reply rides a button template, capped at Meta's 640. With an image the button rides the
  // image card (full caption via «Read more»), so the full cap applies.
  const replyMax = ctaActive && !hasImage ? POST_REPLY_BUTTON_TEXT_MAX : REPLY_MAX;
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
      setExcludeKeywords(parseKeywords(initialExcludeKeyword));
      const waDigits = initialButtonUrl ? extractWhatsAppNumber(initialButtonUrl) : null;
      setButtonKind(waDigits ? 'whatsapp' : 'link');
      setButtonLabel(initialButtonLabel ?? '');
      setButtonUrl(waDigits ? '' : (initialButtonUrl ?? ''));
      setWhatsappPhone(waDigits ? `+${waDigits}` : '');
      setReply(initialReply ?? '');
      setLikeEnabled(initialLikeComment ?? false);
      setTagEnabled(initialTagCommenter ?? false);
      setAdvancedOpen(!!(initialExcludeKeyword || initialButtonLabel || initialButtonUrl));
      setImageFile(null);
      setImageObjectUrl(null);
      setImageRemoved(false);
    }
  }, [isOpen, initialKeyword, initialReply, initialType, initialLikeComment, initialTagCommenter, initialExcludeKeyword, initialButtonLabel, initialButtonUrl]);

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
    // CTA button (FB + DM only): label + target are all-or-nothing, and when the button
    // rides without an image the reply is capped at 640 (button-template limit).
    // Link kind: target must be http(s). WhatsApp kind: target is a phone number in
    // international format, resolved here into the stored wa.me URL — the backend only
    // ever sees a valid https URL either way.
    let resolvedButtonUrl = buttonUrl.trim();
    if (ctaSupported) {
      const label = buttonLabel.trim();
      const target = ctaTarget.trim();
      if ((label && !target) || (!label && target)) {
        toast.error(t('postTriggerButtonIncomplete'));
        return;
      }
      if (target && buttonKind === 'whatsapp') {
        const phone = normalizeInternationalPhone(target);
        if (!phone) {
          toast.error(t('postTriggerButtonBadWhatsapp'));
          return;
        }
        resolvedButtonUrl = buildWhatsAppUrl(phone);
      } else if (target) {
        // Auto-repair rather than reject: merchants paste bare domains
        // («mystore.com/offer») — normalizeHttpUrl prepends https:// for anything
        // that plausibly is a web address, so the error only fires on real garbage.
        const normalized = normalizeHttpUrl(target);
        if (!normalized) {
          toast.error(t('postTriggerButtonBadUrl'));
          return;
        }
        resolvedButtonUrl = normalized;
      } else {
        resolvedButtonUrl = '';
      }
    }
    if (replyOverLimit) {
      toast.error(t('postTriggerReplyTooLong'));
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
      await postsApi.updateTrigger({
        id: postId,
        source,
        triggerKeyword: keywordArg,
        triggerReply: reply.trim(),
        triggerType: mode,
        triggerImage: imageArg,
        // Only Facebook posts carry the like option (the row is hidden for Instagram).
        likeComment: source === 'facebook' ? likeEnabled : undefined,
        tagCommenter: source === 'facebook' ? tagEnabled : undefined,
        // Always send exclude keywords (empty string clears them) — both platforms.
        triggerExcludeKeyword: excludeKeywords.join(', '),
        // CTA button (FB + DM only). Send the pair (empty clears) only when the UI is shown;
        // otherwise omit so a stored button isn't clobbered when editing under another mode.
        // WhatsApp kind stores the resolved wa.me URL — same columns, same delivery path.
        ...(ctaSupported
          ? { triggerButtonLabel: buttonLabel.trim(), triggerButtonUrl: resolvedButtonUrl }
          : {}),
      });
      toast.success(t('postTriggerSaved'));
      onSaveSuccess();
    } catch (err) {
      // Quota is the one save error worth a specific message (mirrors KB limit UX);
      // everything else falls back to the generic error toast.
      const status = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
      if (status?.status === 413 && status?.data?.error === 'image_quota_exceeded') {
        toast.error(t('postTriggerImageQuota'));
      } else if (status?.status === 400 && status?.data?.error === 'image_unreadable') {
        // The server re-encodes uploads to strip EXIF; a file it cannot decode is
        // rejected rather than stored raw. Name the file as the problem, otherwise
        // the generic toast reads as "saving is broken".
        toast.error(t('postTriggerImageUnreadable'));
      } else {
        captureError(err, 'PostTriggerModal.handleSave');
        toast.error(tc('error'));
      }
    } finally {
      setSavingSave(false);
    }
  }

  function selectButtonKind(kind: 'link' | 'whatsapp') {
    setButtonKind(kind);
    // WhatsApp should need only the number: hand the merchant a ready-made label
    // (editable, ≤20 chars) instead of a second blank field. Switching back to
    // link unwinds OUR auto-fill (a WhatsApp label on a link button is wrong) —
    // but only the untouched default; a merchant-typed label survives the switch.
    const waDefault = t('postTriggerButtonWhatsappDefaultLabel');
    if (kind === 'whatsapp' && !buttonLabel.trim()) {
      setButtonLabel(waDefault);
    } else if (kind === 'link' && buttonLabel.trim() === waDefault) {
      setButtonLabel('');
    }
  }

  function requestClear() {
    setConfirmingClear(true);
  }

  async function handleConfirmClear() {
    setConfirmingClear(false);
    await runClear(() => postsApi.updateTrigger({ id: postId, source, triggerKeyword: null, triggerReply: null }));
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
        // In-flight only — validation errors toast instead, like every other check in
        // handleSave. Disabling on replyOverLimit blocked onClick, so its own
        // postTriggerReplyTooLong toast was unreachable and Save failed silently
        // (WCAG 3.3.1 wants the error stated, not just the control removed).
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
        {/* The post isn't live yet: saving arms the trigger now and it starts working the
            moment Facebook publishes the post — say so, or "saved" reads as "replying".
            Shown whenever the post is pending, with or without a known publish time. */}
        {isScheduled && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg alert-warning text-sm leading-relaxed" role="note">
            <CalendarClock className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>
              {scheduledPublishTime
                ? t('postTriggerScheduledNotice', {
                    time: formatScheduledTime(scheduledPublishTime, dateLocale),
                  })
                : t('postTriggerScheduledNoticeNoTime')}
            </span>
          </div>
        )}

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
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-400'
                    : 'border-surface-200 dark:border-surface-700 text-muted-foreground hover:bg-surface-50 dark:hover:bg-surface-300',
                )}
              >
                {m === 'keyword' ? t('postTriggerModeKeyword') : t('postTriggerModeAll')}
              </button>
            ))}
          </div>
        </div>

        {/* Keyword chip input — only in keyword mode. Required (with the reply) —
            marked visually; the actual gate stays the existing save-time toast. */}
        {mode === 'keyword' && (
          <FormField
            label={<>{t('postTriggerKeyword')} <span className="text-destructive" aria-hidden="true">*</span></>}
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
              {t('postTriggerReply')} <span className="text-destructive" aria-hidden="true">*</span>
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
            // Tracks `replyMax` (not a flat REPLY_MAX): attaching a CTA button without an
            // image drops the ceiling to the button-template limit the backend enforces.
            // Hardcoding the higher cap let merchants type past the real limit with only
            // the counter — which scrolls out of view once the CTA fields open — to warn them.
            maxLength={replyMax}
            className="leading-relaxed"
            style={{ fieldSizing: 'content', resize: 'none', minHeight: '120px', maxHeight: '280px' } as React.CSSProperties}
          />
        </div>

        {/* Image affordance — directly under the reply text: attaching an image is part
            of COMPOSING the message (messenger attachment metaphor), not an advanced
            tweak. Only rendered when the feature is configured server-side. */}
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

        {/* Like-the-comment option — Facebook only (the Instagram API can't like
            comments), so the row simply doesn't exist for IG posts. Top-level (not in
            «خيارات إضافية»): one-tap, zero-config, high-delight — worth its single row. */}
        {source === 'facebook' && (
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              {t('postTriggerLikeComment')}
              <InfoPopover label={t('postTriggerLikeComment')}>
                {t('postTriggerLikeCommentDesc')}
              </InfoPopover>
            </span>
            <Toggle
              enabled={likeEnabled}
              onChange={setLikeEnabled}
              size="sm"
              aria-label={t('postTriggerLikeComment')}
            />
          </div>
        )}

        {/* Mention-the-commenter option — Facebook only, same reasoning as the like row
            above (Instagram needs `@username`, a different mechanism). Sits next to it:
            both are one-tap, zero-config options on the public comment. */}
        {source === 'facebook' && (
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              {t('postTriggerTagCommenter')}
              <InfoPopover label={t('postTriggerTagCommenter')}>
                {t('postTriggerTagCommenterDesc')}
              </InfoPopover>
            </span>
            <Toggle
              enabled={tagEnabled}
              onChange={setTagEnabled}
              size="sm"
              aria-label={t('postTriggerTagCommenter')}
            />
          </div>
        )}

        {/* «خيارات إضافية» — the power features (exclude keywords + CTA button; both
            need typing/validation), behind one disclosure so the compose path stays
            short. Auto-expanded when the stored trigger already uses one of them
            (see advancedOpen init + the isOpen sync effect). */}
        <div className="rounded-xl border border-theme-border">
          <button
            type="button"
            onClick={() => setAdvancedOpen((o) => !o)}
            aria-expanded={advancedOpen}
            aria-controls="post-trigger-advanced"
            className={clsx(
              'w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-foreground',
              'hover:bg-surface-50 dark:hover:bg-surface-300 transition-colors rounded-t-xl',
              !advancedOpen && 'rounded-b-xl',
            )}
          >
            {t('postTriggerAdvancedTitle')}
            <ChevronDown
              className={clsx('w-4 h-4 ms-auto text-icon-muted transition-transform', advancedOpen && 'rotate-180')}
              aria-hidden="true"
            />
          </button>
          {advancedOpen && (
            <div id="post-trigger-advanced" className="flex flex-col gap-4 px-3 pb-3.5 pt-1">
              {/* Exclude keywords — optional veto list, both trigger modes. A comment containing
                  any of these skips the Post Reply and falls through to the AI pipeline. The
                  explanation lives in the popover — the label is not inside <label> because a
                  popover trigger inside one would steal its click-to-focus. */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <label htmlFor="trigger-exclude" className="text-sm font-medium text-foreground">
                    {t('postTriggerExclude')}
                  </label>
                  <InfoPopover label={t('postTriggerExclude')}>
                    {t('postTriggerExcludeHelp')}
                  </InfoPopover>
                </div>
                <KeywordChipInput
                  id="trigger-exclude"
                  value={excludeKeywords}
                  onChange={setExcludeKeywords}
                  placeholder={t('postTriggerExcludePlaceholder')}
                  maxKeywords={POST_REPLY_MAX_KEYWORDS}
                  maxLength={POST_REPLY_MAX_KEYWORD_LEN}
                />
              </div>

              {/* CTA button — Facebook + DM-channel only (the sender delivers it on the private
                  reply; a public comment can't carry a button). Label + target set together or
                  empty. Two kinds: a plain link, or a WhatsApp contact button whose wa.me URL
                  is built from a phone number on save (see handleSave). */}
              {ctaSupported && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <span id="trigger-button-kind-label" className="text-sm font-medium text-foreground">
                      {t('postTriggerButton')}
                    </span>
                    <InfoPopover label={t('postTriggerButton')}>
                      {t('postTriggerButtonHelp')}
                    </InfoPopover>
                  </div>
                  <div role="radiogroup" aria-labelledby="trigger-button-kind-label" className="grid grid-cols-2 gap-2">
                    {(['link', 'whatsapp'] as const).map((k) => (
                      <button
                        key={k}
                        ref={(el) => { kindRefs.current[k] = el; }}
                        type="button"
                        role="radio"
                        aria-checked={buttonKind === k}
                        tabIndex={buttonKind === k ? 0 : -1}
                        onClick={() => selectButtonKind(k)}
                        onKeyDown={(e) => {
                          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                            e.preventDefault();
                            const other = k === 'link' ? 'whatsapp' : 'link';
                            selectButtonKind(other);
                            kindRefs.current[other]?.focus();
                          }
                        }}
                        className={clsx(
                          'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                          buttonKind === k
                            ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-400'
                            : 'border-surface-200 dark:border-surface-700 text-muted-foreground hover:bg-surface-50 dark:hover:bg-surface-300',
                        )}
                      >
                        {k === 'link' ? t('postTriggerButtonKindLink') : t('postTriggerButtonKindWhatsapp')}
                      </button>
                    ))}
                  </div>
                  <Input
                    id="trigger-button-label"
                    value={buttonLabel}
                    onChange={e => setButtonLabel(e.target.value)}
                    placeholder={t('postTriggerButtonLabelPlaceholder')}
                    maxLength={POST_REPLY_BUTTON_LABEL_MAX}
                    dir="auto"
                    aria-label={t('postTriggerButtonLabelAria')}
                  />
                  {buttonKind === 'link' ? (
                    <Input
                      id="trigger-button-url"
                      type="url"
                      inputMode="url"
                      value={buttonUrl}
                      onChange={e => setButtonUrl(e.target.value)}
                      placeholder={t('postTriggerButtonUrlPlaceholder')}
                      dir="ltr"
                      aria-label={t('postTriggerButtonUrlAria')}
                    />
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <Input
                        id="trigger-button-whatsapp"
                        type="tel"
                        inputMode="tel"
                        value={whatsappPhone}
                        onChange={e => setWhatsappPhone(e.target.value)}
                        placeholder={t('postTriggerButtonWhatsappPhonePlaceholder')}
                        dir="ltr"
                        aria-label={t('postTriggerButtonWhatsappPhoneLabel')}
                      />
                      <p className="text-xs text-muted-foreground">{t('postTriggerButtonWhatsappPhoneHelp')}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

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
                // The mention rides the PUBLIC comment only (the DM already reaches the
                // customer), so the preview must show it there — otherwise the panel whose
                // whole job is "this is what gets posted" contradicts what gets posted.
                // Rendered as a chip, not literal `@[id]`: that token is what we SEND, while
                // what the reader sees is the customer's name.
                const mentionChip = row.channel === 'public' && tagEnabled && source === 'facebook' ? (
                  <span className="font-semibold text-brand-600 me-1" dir="auto">{t('postTriggerOutcomeMention')}</span>
                ) : null;
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
                        <div className="rounded-lg border border-theme-border overflow-hidden max-w-[200px] bg-surface-50 dark:bg-surface-200">
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
                          {/* The CTA button rides the SAME card — buttons stack under the
                              caption, after «Read more» when both are present (matching the
                              sender's button order on the generic template). */}
                          {ctaActive && (
                            <div className="border-t border-theme-border py-2 text-[12px] font-bold text-brand-600 flex items-center justify-center gap-1.5" dir="auto">
                              {buttonKind === 'whatsapp' && <WhatsAppIcon className="w-3 h-3 flex-shrink-0" aria-hidden="true" />}
                              {buttonLabel.trim()}
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
                      row.channel === 'private' && ctaActive ? (
                        // Text + button (no image → button template): the reply bubble with
                        // the CTA attached beneath — mirrored here so the merchant sees the
                        // exact delivery, including the kind (link vs WhatsApp glyph).
                        <div className="flex flex-col gap-1.5">
                          <span className="text-sm leading-relaxed text-muted-foreground" dir="auto">
                            {t('postTriggerOutcomeAsWritten')}
                          </span>
                          <span
                            className="inline-flex items-center justify-center gap-1.5 self-start max-w-[200px] min-w-[120px] rounded-lg border border-theme-border px-3 py-1.5 text-[12px] font-bold text-brand-600"
                            dir="auto"
                          >
                            {buttonKind === 'whatsapp' && <WhatsAppIcon className="w-3 h-3 flex-shrink-0" aria-hidden="true" />}
                            {buttonLabel.trim()}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm leading-relaxed text-muted-foreground" dir="auto">
                          {mentionChip}
                          {t('postTriggerOutcomeAsWritten')}
                        </span>
                      )
                    ) : (
                      <span className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground" dir="auto">
                        {mentionChip}
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
            className="inline-flex items-center rounded-md p-1 text-destructive hover:bg-surface-50 dark:hover:bg-surface-300 transition-colors"
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
