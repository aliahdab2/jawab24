import { useEffect } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Card, Toggle, InputFieldWrapper, CharCounter } from '@/components/ui';
import { useTextareaAutoResize } from '@/hooks/useTextareaAutoResize';
import { MessageSquare, Mail, Zap, ArrowLeft } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { getLocaleDirection, isRTLLocale } from '@/utils/locale';
import type { SettingsCardProps } from './types';
import { InlineFieldError } from './InlineFieldError';

type ReplyMode = 'public' | 'private' | 'dual';

/**
 * The Auto-Reply board — ONE flat card answering "who replies, and where" (D-029).
 *
 * Three rows = every mechanism that replies in the merchant's name, each with its
 * visible state:
 *   💬 Comments      — Smart Replies from Business Info   [toggle]
 *   ✉️ Messages      — Smart Replies from Business Info   [toggle]
 *   ⚡ Post Reply    — the merchant's own words           ‹always on› + manage link
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

  const dualNudgeInput = settings.dualReplyNudgeMulti?.[settings.dashboardLanguage] || '';
  // Auto-translated entries blank the input (the stored text becomes the placeholder),
  // so the textarea is visually empty even though dualNudgeInput is set. Direction must
  // be based on the actually-rendered value, not the stored value.
  const dualNudgeSourceLang = settings.dualReplyNudgeMulti?.sourceLang;
  const dualNudgeIsAutoTranslated = !!(dualNudgeSourceLang && dualNudgeSourceLang !== 'manual' && dualNudgeSourceLang !== settings.dashboardLanguage);
  const dualNudgeRenderedValue = dualNudgeIsAutoTranslated ? '' : dualNudgeInput;

  // Grow the nudge textarea to fit its content so the full message is always
  // visible (no internal scroll) on narrow screens. minHeight ≈ one line + padding.
  const { ref: dualNudgeRef, autoResize: dualNudgeAutoResize } = useTextareaAutoResize(48);
  useEffect(() => {
    if (settings.commentReplyMode === 'dual') dualNudgeAutoResize();
  }, [settings.commentReplyMode, dualNudgeRenderedValue, dualNudgeAutoResize]);

  const modeOptions: Array<{ value: ReplyMode; label: string; recommended?: boolean }> = [
    { value: 'public', label: t('commentReplyMode.publicOnly') },
    { value: 'private', label: t('commentReplyMode.privateOnly') },
    { value: 'dual', label: t('commentReplyMode.dual'), recommended: true },
  ];

  return (
    <Card className="border-none shadow-card-glow p-4 landscape:p-3">
      <p className="text-sm text-muted-foreground font-medium mb-1 text-start">
        {t('autoReplyBoard.subtitle')}
      </p>

      <ul className="divide-y divide-theme-border">
        {/* 💬 Comments — Smart Replies */}
        <li className="flex items-center gap-3 py-3.5">
          <div className={clsx(
            'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors',
            settings.commentsAutoReply ? 'icon-bg-brand' : 'bg-muted text-muted-foreground',
          )}>
            <MessageSquare className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className={clsx('flex-1 min-w-0 text-start transition-opacity', !settings.commentsAutoReply && 'opacity-60')}>
            <h3 className="font-bold text-sm text-foreground">{t('autoReplyBoard.comments')}</h3>
            <p className="text-xs text-muted-foreground">{t('autoReplyBoard.smartRepliesSub')}</p>
          </div>
          <Toggle
            enabled={settings.commentsAutoReply}
            onChange={setChannel('commentsAutoReply')}
            aria-label={`${t('autoReplyBoard.comments')} — ${t('autoReplyBoard.smartRepliesSub')}`}
          />
        </li>

        {/* ✉️ Private messages — Smart Replies */}
        <li className="flex items-center gap-3 py-3.5">
          <div className={clsx(
            'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors',
            settings.messagesAutoReply ? 'icon-bg-brand' : 'bg-muted text-muted-foreground',
          )}>
            <Mail className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className={clsx('flex-1 min-w-0 text-start transition-opacity', !settings.messagesAutoReply && 'opacity-60')}>
            <h3 className="font-bold text-sm text-foreground">{t('autoReplyBoard.messages')}</h3>
            <p className="text-xs text-muted-foreground">{t('autoReplyBoard.smartRepliesSub')}</p>
          </div>
          <Toggle
            enabled={settings.messagesAutoReply}
            onChange={setChannel('messagesAutoReply')}
            aria-label={`${t('autoReplyBoard.messages')} — ${t('autoReplyBoard.smartRepliesSub')}`}
          />
        </li>

        {/* ⚡ Post Reply — merchant-authored, always on (D-027). No toggle by design. */}
        <li className="flex items-center gap-3 py-3.5">
          <div className="w-10 h-10 rounded-xl bg-sky-500 text-white flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0 text-start">
            <h3 className="font-bold text-sm text-foreground flex items-center gap-2 flex-wrap">
              {t('autoReplyBoard.postReply')}
              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                {t('autoReplyBoard.alwaysOn')}
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
        <h4 id="comment-reply-mode-label" className="text-sm font-bold text-foreground mb-3 text-start">
          {t('autoReplyBoard.modeQuestion')}
        </h4>

        <div
          role="radiogroup"
          aria-labelledby="comment-reply-mode-label"
          className="inline-flex rounded-xl border border-theme-border overflow-hidden"
        >
          {modeOptions.map((opt) => (
            <label
              key={opt.value}
              className={clsx(
                'relative cursor-pointer select-none px-4 py-2.5 text-sm font-medium min-h-[44px] flex items-center gap-1.5',
                'border-s border-theme-border first:border-s-0 transition-colors',
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
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full status-brand">
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
                    const value = e.target.value.slice(0, 80);
                    const currentLang = settings.dashboardLanguage;
                    setSettings({
                      ...settings,
                      dualReplyNudgeMulti: {
                        ...settings.dualReplyNudgeMulti,
                        [currentLang]: value,
                        sourceLang: currentLang,
                      },
                    });
                  }}
                  onInput={dualNudgeAutoResize}
                  placeholder={dualNudgeIsAutoTranslated && dualNudgeInput ? dualNudgeInput : t('publicReplyPlaceholder')}
                  dir={dualNudgeRenderedValue ? 'auto' : getLocaleDirection(settings.dashboardLanguage)}
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
      </div>
    </Card>
  );
}
