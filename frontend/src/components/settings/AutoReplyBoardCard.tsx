import { useEffect } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Card, Toggle, InputFieldWrapper, CharCounter, InfoPopover } from '@/components/ui';
import { useTextareaAutoResize } from '@/hooks/useTextareaAutoResize';
import { useMultilingualSettingsField } from '@/hooks/useMultilingualSettingsField';
import { ArrowLeft } from 'lucide-react';
import { PostReplyIcon } from '@/utils/postReply';
import { SmartReplyIcon } from '@/utils/smartReply';
import { KB_DEEP_LINK_ACTIVE } from '@/utils/kb';
import { useTranslations, useLocale } from 'next-intl';
import { getLocaleDirection, isRTLLocale } from '@/utils/locale';
import type { SettingsCardProps } from './types';
import { InlineFieldError } from './InlineFieldError';

type CommentDeliveryMode = 'public' | 'private' | 'dual';

/**
 * The Auto-Reply board — ONE flat card answering "who replies, and where" (D-029).
 *
 * Three rows = every mechanism that replies in the merchant's name, each with its
 * visible state:
 *   ✨ Comments      — Smart Replies from Business Info   [toggle]
 *   ✨ Messages      — Smart Replies from Business Info   [toggle]
 *   🔑 Post Reply    — the merchant's own words           ‹always on› + manage link
 *
 * Row tiles show the replying MECHANISM (Sparkles+violet = Smart Reply, key+sky =
 * Post Reply — the same icon+hue pairs as the inbox reply-source badges); the row
 * titles name the channel.
 *
 * Design rules (owner-iterated ×4, 2026-07-16):
 * - Only the AI needs consent, so only the AI rows get toggles. Post Reply is
 *   merchant-authored and always-on (D-027) — the ABSENCE of a switch is the message,
 *   reinforced by the badge. When an AI row is off it dims; the Post Reply row never
 *   dims, so "what still runs on my comments" is answered structurally, with no copy.
 * - There is NO standalone "Enable Smart Replies" switch: `aiEnabled` is derived —
 *   ON exactly when either channel row is on — killing the zombie state where the
 *   engine was off while channels were on (comments got a canned template, DMs got
 *   nothing). The column stays in the DB; the UI just can't diverge it anymore.
 * - The display-mode question sits LAST at card level because it styles BOTH systems'
 *   comment replies (the adapter reads commentReplyMode for post_reply too) — it must
 *   never be nested under, or dimmed by, the Smart Replies toggle.
 * - Native radio inputs power the segmented control: correct semantics and arrow-key
 *   navigation for free (WCAG), styled via peer-checked.
 */
export function AutoReplyBoardCard({ settings, setSettings, fieldErrors }: SettingsCardProps) {
  const t = useTranslations('settings');
  const locale = useLocale();
  const isRTL = isRTLLocale(locale);

  // Derived aiEnabled: the engine is on exactly when either channel is (D-029).
  const setChannel = (key: 'commentsAutoReply' | 'messagesAutoReply') => (enabled: boolean) => {
    const next = { ...settings, [key]: enabled };
    next.aiEnabled = next.commentsAutoReply || next.messagesAutoReply;
    setSettings(next);
  };

  const dualNudgeField = useMultilingualSettingsField(settings.dualReplyNudgeMulti);
  const dualNudgeInput = dualNudgeField.value;
  // Auto-translated entries blank the input (the stored text becomes the placeholder),
  // so the textarea is visually empty even though dualNudgeInput is set. Direction must
  // be based on the actually-rendered value, not the stored value.
  const dualNudgeIsAutoTranslated = dualNudgeField.isAutoTranslated;
  const dualNudgeRenderedValue = dualNudgeIsAutoTranslated ? '' : dualNudgeInput;

  // Grow the nudge textarea to fit its content so the full message is always
  // visible (no internal scroll) on narrow screens. minHeight ≈ one line + padding.
  const { ref: dualNudgeRef, autoResize: dualNudgeAutoResize } = useTextareaAutoResize(48);
  useEffect(() => {
    if (settings.commentReplyMode === 'dual') dualNudgeAutoResize();
  }, [settings.commentReplyMode, dualNudgeRenderedValue, dualNudgeAutoResize]);

  const modeOptions: Array<{ value: CommentDeliveryMode; label: string; recommended?: boolean }> = [
    { value: 'public', label: t('commentReplyMode.publicOnly') },
    { value: 'private', label: t('commentReplyMode.privateOnly') },
    { value: 'dual', label: t('commentReplyMode.dual'), recommended: true },
  ];

  // "from your Business Info" is a doorway to authoring it, not just a description.
  const renderSmartRepliesSub = () => t.rich('autoReplyBoard.smartRepliesSub', {
    kb: (chunks) => (
      <Link
        href={KB_DEEP_LINK_ACTIVE}
        className="underline decoration-dotted underline-offset-2 hover:text-brand-600 dark:hover:text-brand-400"
      >
        {chunks}
      </Link>
    ),
  });

  return (
    <Card className="border-none shadow-card-glow p-4 landscape:p-3">
      <p className="text-sm text-muted-foreground font-medium mb-1 text-start">
        {t('autoReplyBoard.subtitle')}
      </p>

      <ul className="divide-y divide-theme-border">
        {/* 💬 Comments — Smart Replies */}
        <li className="flex items-center gap-3 py-3.5">
          {/* Tile = the MECHANISM (Sparkles+violet = Smart Reply, exactly the inbox
              رد ذكي badge; the key+sky row below = Post Reply) — the row title
              already names the channel. ON = solid violet so the AI rows carry at
              least the visual weight of Post Reply's solid sky tile; OFF = gray. */}
          <div className={clsx(
            'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors',
            settings.commentsAutoReply ? 'bg-violet-500 text-white' : 'bg-muted text-muted-foreground',
          )}>
            <SmartReplyIcon className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className={clsx('flex-1 min-w-0 text-start transition-opacity', !settings.commentsAutoReply && 'opacity-60')}>
            <h3 className="font-bold text-sm text-foreground">{t('autoReplyBoard.comments')}</h3>
            <p className="text-xs text-muted-foreground">{renderSmartRepliesSub()}</p>
          </div>
          <Toggle
            enabled={settings.commentsAutoReply}
            onChange={setChannel('commentsAutoReply')}
            aria-label={t('autoReplyBoard.comments')}
          />
        </li>

        {/* ✉️ Private messages — Smart Replies */}
        <li className="flex items-center gap-3 py-3.5">
          <div className={clsx(
            'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors',
            settings.messagesAutoReply ? 'bg-violet-500 text-white' : 'bg-muted text-muted-foreground',
          )}>
            <SmartReplyIcon className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className={clsx('flex-1 min-w-0 text-start transition-opacity', !settings.messagesAutoReply && 'opacity-60')}>
            <h3 className="font-bold text-sm text-foreground">{t('autoReplyBoard.messages')}</h3>
            <p className="text-xs text-muted-foreground">{renderSmartRepliesSub()}</p>
          </div>
          <Toggle
            enabled={settings.messagesAutoReply}
            onChange={setChannel('messagesAutoReply')}
            aria-label={t('autoReplyBoard.messages')}
          />
        </li>

        {/* ⚡ Post Reply — merchant-authored, no toggle by design (D-027). The badge
            states the TRUE independence: it runs even with the Smart Reply toggles
            off — but it is NOT unconditional: outside business hours it goes silent
            (commentProcessor gates postReplyEligible on isWithinBusinessHours), so
            when the schedule is on the badge discloses that instead. */}
        <li className="flex items-center gap-3 py-3.5">
          <div className="w-10 h-10 rounded-xl bg-sky-500 text-white flex items-center justify-center flex-shrink-0">
            <PostReplyIcon className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0 text-start">
            <h3 className="font-bold text-sm text-foreground flex items-center gap-2 flex-wrap">
              {t('autoReplyBoard.postReply')}
              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full reply-source-post-reply">
                {settings.businessHoursOnly
                  ? t('autoReplyBoard.followsReplyHours')
                  : t('autoReplyBoard.worksWithoutSmart')}
              </span>
            </h3>
            <p className="text-xs text-muted-foreground">{t('autoReplyBoard.postReplySub')}</p>
          </div>
          <Link
            href="/comments?openPostReply=true"
            className="flex items-center gap-1 text-xs font-bold text-sky-700 dark:text-sky-300 hover:underline flex-shrink-0 min-h-[44px]"
          >
            {t('autoReplyBoard.manage')}
            <ArrowLeft className={clsx('w-3.5 h-3.5', !isRTL && 'rotate-180')} aria-hidden="true" />
          </Link>
        </li>
      </ul>

      {/* Display mode — styles BOTH systems' comment replies, so it lives at card
          level and is never dimmed by the Smart Replies toggles. */}
      <div className="mt-1 pt-4 border-t border-theme-border">
        <h4 id="comment-reply-mode-label" className="text-sm font-bold text-foreground mb-1 text-start">
          {t('autoReplyBoard.modeQuestion')}
        </h4>
        {/* Scope caption: the adapter reads commentReplyMode for post_reply too, so the
            selector stays relevant even with the Smart Replies toggles off — say so. */}
        <p id="comment-reply-mode-scope" className="text-xs text-muted-foreground mb-3 text-start">
          {t('autoReplyBoard.modeScopeNote')}
        </p>

        {/* One option per ROW on a phone, a segmented control from `sm` up.
            As a single `inline-flex` line it could not fit and did not wrap:
            the three labels plus the «Recommended» badge need ~625 px against
            ~290 px inside the card at 360 px, so the control ran off the screen
            and took the whole page's horizontal scroll with it (reported
            2026-08-19, both languages — Arabic is no shorter). Stacking is the
            same shape the reply-mode options on ReplyStyleCard already use. */}
        <div
          role="radiogroup"
          aria-labelledby="comment-reply-mode-label"
          aria-describedby="comment-reply-mode-scope"
          className="flex flex-col w-full sm:inline-flex sm:flex-row sm:w-auto rounded-xl border border-theme-border overflow-hidden"
        >
          {modeOptions.map((opt) => (
            <label
              key={opt.value}
              className={clsx(
                'relative cursor-pointer select-none px-4 py-2.5 text-sm font-medium min-h-[44px] flex items-center gap-1.5',
                // The divider follows the axis: a rule ABOVE each stacked row,
                // a rule BEFORE each segment once they sit side by side.
                'border-t border-theme-border first:border-t-0 transition-colors',
                'sm:border-t-0 sm:border-s sm:first:border-s-0',
                // Keyboard focus must be visible (WCAG 2.4.7): the radio itself is
                // sr-only, so surface its focus on the label.
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40 has-[:focus-visible]:z-10',
                settings.commentReplyMode === opt.value
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300 font-bold'
                  : 'text-muted-foreground hover:bg-muted/60',
              )}
            >
              {/* Native radio: correct semantics + arrow-key navigation for free. */}
              <input
                type="radio"
                name="commentReplyMode"
                value={opt.value}
                checked={settings.commentReplyMode === opt.value}
                onChange={() => setSettings({ ...settings, commentReplyMode: opt.value })}
                className="sr-only"
              />
              {opt.label}
              {opt.recommended && (
                // `ms-auto` parks the badge at the row's far end while the row is
                // full-width; from `sm` up the label is content-sized, so there
                // is no free space and it simply trails the text as before.
                <span className="ms-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full status-brand flex-shrink-0">
                  {t('recommended')}
                </span>
              )}
            </label>
          ))}
        </div>

        {/* Dynamic one-liner per mode */}
        <p className="mt-2 text-sm text-muted-foreground animate-in fade-in text-start">
          {settings.commentReplyMode === 'dual' && t('commentReplyMode.dualDesc')}
          {settings.commentReplyMode === 'public' && t('commentReplyMode.publicDesc')}
          {settings.commentReplyMode === 'private' && t('commentReplyMode.privateDesc')}
        </p>

        {/* Short comment reply (nudge) — only sent by the backend in dual mode */}
        {settings.commentReplyMode === 'dual' && (
          <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="p-4 landscape:p-3 rounded-xl bg-brand-50/20 dark:bg-brand-950/20 border border-brand-200/50 dark:border-brand-800/40">
              <h4 className="font-bold text-brand-900 dark:text-brand-300 text-sm mb-1">{t('dualReplyConfigTitle.improved')}</h4>
              <p className="text-xs text-muted-foreground mb-3">{t('dualReplyConfigDesc')}</p>
              <InputFieldWrapper trailing={<CharCounter value={dualNudgeInput.length} max={80} />}>
                <textarea
                  ref={dualNudgeRef}
                  aria-label={t('dualReplyConfigTitle.improved')}
                  value={dualNudgeRenderedValue}
                  onChange={(e) => {
                    setSettings({ ...settings, dualReplyNudgeMulti: dualNudgeField.withValue(e.target.value.slice(0, 80)) });
                  }}
                  onInput={dualNudgeAutoResize}
                  placeholder={dualNudgeIsAutoTranslated && dualNudgeInput ? dualNudgeInput : t('publicReplyPlaceholder')}
                  dir={dualNudgeRenderedValue ? 'auto' : getLocaleDirection(locale)}
                  maxLength={80}
                  rows={2}
                  className={clsx(
                    'w-full bg-transparent border-none p-3 pe-14 rounded-2xl text-sm resize-none overflow-hidden',
                    'placeholder:text-muted-foreground placeholder:italic',
                    'focus:outline-none focus:ring-0',
                  )}
                />
              </InputFieldWrapper>

              <InlineFieldError message={fieldErrors?.dualReplyNudge ?? fieldErrors?.dualReplyNudgeMulti} />
              <p className="text-xs text-brand-700 dark:text-brand-400 font-medium mt-1.5">{t('dualReplyConfigHelper')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('dualReplyVariationsHint')}</p>
            </div>
          </div>
        )}

        {/* Auto-like — Smart Reply comments only (Post Reply carries its own per-post
            toggle). One compact line, mirroring PostTriggerModal's like row: the scope
            note (smart replies, complaints skipped, FB only) lives in the InfoPopover
            so the crowded settings page pays for a single row. Dims with the Comments
            channel like the rows above: no smart comment replies → no likes. */}
        <div className="mt-3 pt-3 border-t border-theme-border flex items-center justify-between gap-3">
          <span className={clsx(
            'flex items-center gap-1.5 text-sm font-medium text-foreground text-start transition-opacity',
            !settings.commentsAutoReply && 'opacity-60',
          )}>
            {t('autoReplyBoard.likeComments')}
            <InfoPopover label={t('autoReplyBoard.likeComments')}>
              {t('autoReplyBoard.likeCommentsSub')}
            </InfoPopover>
          </span>
          <Toggle
            enabled={settings.likeComments}
            onChange={(enabled) => setSettings({ ...settings, likeComments: enabled })}
            size="sm"
            aria-label={t('autoReplyBoard.likeComments')}
          />
        </div>
      </div>
    </Card>
  );
}
