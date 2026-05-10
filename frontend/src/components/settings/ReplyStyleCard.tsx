import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import clsx from 'clsx';
import { MAX_TEMPLATE_MESSAGE_LENGTH } from '@jawab24/shared';
import type { Page } from '@jawab24/shared';
import { Card, InputFieldWrapper, CharCounter } from '@/components/ui';
import { Sparkles, MessageSquare, ArrowRight, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pagesApi } from '@/lib/api';
import type { SettingsCardProps } from './types';

// Lazy-load the modal — keeps it out of the settings-page bundle until the merchant
// actually clicks Test (matches how /pages.tsx loads it via next/dynamic).
const TestSmartReplyModal = dynamic(
  () => import('@/components/test-smart-reply/TestSmartReplyModal').then((m) => m.TestSmartReplyModal),
  { ssr: false },
);

const STYLES = ['professional', 'casual', 'enthusiastic'] as const;
const HOLD_RELOCATION_SEEN_KEY = 'hold_relocation_seen';

interface ReplyStyleCardProps extends SettingsCardProps {
  hasChanges?: boolean;
  onScrollToAdvanced?: () => void;
}

export function ReplyStyleCard({ settings, setSettings, hasChanges, onScrollToAdvanced }: ReplyStyleCardProps) {
  const t = useTranslations('settings');
  const currentLang = settings.dashboardLanguage;
  const value = settings.brandVoiceNotesMulti?.[currentLang] || '';
  const sourceLang = settings.brandVoiceNotesMulti?.sourceLang;
  const isAutoTranslated = !!(sourceLang && sourceLang !== 'manual' && sourceLang !== 'default' && sourceLang !== currentLang && value);
  const isEmpty = !value.trim();

  const [testPage, setTestPage] = useState<Page | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [holdNoticeDismissed, setHoldNoticeDismissed] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Show migration notice once per merchant who currently uses holdLowConfidence.
  // Re-evaluates on toggle so flipping holdLowConfidence off hides the notice.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!settings.holdLowConfidence) {
      setHoldNoticeDismissed(true);
      return;
    }
    const seen = window.localStorage.getItem(HOLD_RELOCATION_SEEN_KEY);
    setHoldNoticeDismissed(!!seen);
  }, [settings.holdLowConfidence]);

  const dismissHoldNotice = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(HOLD_RELOCATION_SEEN_KEY, '1');
    }
    setHoldNoticeDismissed(true);
  };

  const handleHoldNoticeAction = () => {
    dismissHoldNotice();
    onScrollToAdvanced?.();
  };

  const updateValue = (next: string) => {
    setSettings({
      ...settings,
      brandVoiceNotesMulti: {
        ...settings.brandVoiceNotesMulti,
        [currentLang]: next,
        sourceLang: currentLang,
      },
    });
  };

  const insertExample = (example: string) => {
    const next = value.trim() ? `${value.trimEnd()}\n${example}` : example;
    updateValue(next.slice(0, MAX_TEMPLATE_MESSAGE_LENGTH));
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  // Fetch pages once on mount so we can:
  // (1) show "Testing on: <name>" before the merchant clicks (multi-page transparency),
  // (2) use that cached page on click without a second network round-trip.
  // Mirrors the canonical accessor from pages.tsx — backend returns Page[] directly,
  // some legacy paths wrap as { data: Page[] }.
  const [firstPage, setFirstPage] = useState<Page | null>(null);
  useEffect(() => {
    let cancelled = false;
    pagesApi.getAll().then((response) => {
      if (cancelled) return;
      const data = Array.isArray(response.data)
        ? response.data
        : (Array.isArray(response.data?.data) ? response.data.data : []);
      const pages = data as Page[];
      setFirstPage(pages[0] ?? null);
    }).catch(() => {
      // Silent — the test button itself will surface a real error if invoked.
    });
    return () => { cancelled = true; };
  }, []);

  const openTestModal = () => {
    setTestError(null);
    if (!firstPage?.id) {
      setTestError(t('replyStyle.testNoPages'));
      return;
    }
    setTestPage(firstPage);
  };

  return (
    <Card className="border-none shadow-sm shadow-theme-border/30 p-3">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-lg icon-bg-brand flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4" />
        </div>
        <h4 className="font-bold text-foreground text-sm text-start">{t('replyStyle.title')}</h4>
      </div>

      {/* Migration notice for merchants who used the old holdLowConfidence location. */}
      {!holdNoticeDismissed && (
        <div className="mb-4 p-3 rounded-xl alert-info border flex items-start gap-3">
          <div className="flex-1 text-start">
            <p className="text-sm font-medium text-foreground">{t('replyStyle.holdMovedNotice')}</p>
            <button
              type="button"
              onClick={handleHoldNoticeAction}
              className="text-sm font-bold text-brand-500 dark:text-brand-400 hover:text-brand-600 dark:hover:text-brand-300 mt-1 inline-flex items-center gap-1"
            >
              {t('replyStyle.holdMovedAction')}
              <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            onClick={dismissHoldNotice}
            aria-label={t('replyStyle.holdMovedDismiss')}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Brand voice notes — promoted to hero. */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="brandVoiceNotes" className="text-sm font-bold text-foreground">
            {t('replyStyle.brandVoice')}
          </label>
          {isAutoTranslated && (
            <span className="text-[11px] text-muted-foreground">{t('replyStyle.autoTranslated')}</span>
          )}
        </div>

        {/* Examples — only when the field is empty, to teach the feature without nagging existing users. */}
        {isEmpty && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(['example1', 'example2', 'example3'] as const).map((key) => {
              const example = t(`replyStyle.${key}`);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => insertExample(example)}
                  className="px-2.5 py-1 text-[11px] font-medium rounded-full bg-muted text-muted-foreground border border-theme-border hover:bg-muted/80 hover:text-foreground transition-colors active:scale-[0.98] text-start"
                >
                  + {example}
                </button>
              );
            })}
          </div>
        )}

        <InputFieldWrapper
          trailing={
            value.length >= MAX_TEMPLATE_MESSAGE_LENGTH * 0.8
              ? <CharCounter value={value.length} max={MAX_TEMPLATE_MESSAGE_LENGTH} />
              : null
          }
        >
          <textarea
            id="brandVoiceNotes"
            ref={textareaRef}
            aria-label={t('replyStyle.brandVoice')}
            className={clsx(
              'w-full bg-transparent border-none p-3 pe-14 rounded-2xl resize-none text-sm',
              'placeholder:text-muted-foreground placeholder:italic',
              'focus:outline-none focus:ring-0',
              isAutoTranslated && 'text-muted-foreground italic',
              currentLang === 'ar' && 'italic-arabic',
            )}
            dir={value ? 'auto' : undefined}
            maxLength={MAX_TEMPLATE_MESSAGE_LENGTH}
            rows={3}
            placeholder={t('replyStyle.brandVoicePlaceholder')}
            value={value}
            onChange={(e) => updateValue(e.target.value)}
          />
        </InputFieldWrapper>
      </div>

      {/* Tone + Test — single compact row. */}
      <div className="flex flex-wrap items-center gap-2">
        <span id="replyStyleToneLabel" className="text-xs font-medium text-foreground/80 shrink-0">
          {t('replyStyle.tone')}
        </span>
        <div
          role="radiogroup"
          aria-labelledby="replyStyleToneLabel"
          className="inline-flex p-0.5 rounded-lg bg-muted border border-theme-border"
        >
          {STYLES.map((style) => {
            const selected = settings.replyStyle === style;
            return (
              <button
                key={style}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setSettings({ ...settings, replyStyle: style })}
                className={clsx(
                  'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
                  selected
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`replyStyle.${style}`)}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={openTestModal}
          disabled={hasChanges === true}
          title={hasChanges ? t('replyStyle.testSaveFirst') : undefined}
          className={clsx(
            'ms-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-[0.98]',
            hasChanges === true
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-brand-500 text-white hover:bg-brand-600',
          )}
        >
          <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
          {t('replyStyle.openTestModal')}
        </button>
      </div>
      {(hasChanges || firstPage?.name || testError) && (
        <div className="mt-1.5 text-end">
          {hasChanges && (
            <p className="text-[11px] text-muted-foreground">{t('replyStyle.testSaveFirst')}</p>
          )}
          {!hasChanges && firstPage?.name && (
            <p className="text-[11px] text-muted-foreground" dir="auto">
              {t('replyStyle.testingOnPage', { pageName: firstPage.name })}
            </p>
          )}
          {testError && (
            <p className="text-xs text-destructive" role="alert">{testError}</p>
          )}
        </div>
      )}

      {testPage && (
        <TestSmartReplyModal
          page={testPage}
          onClose={() => setTestPage(null)}
        />
      )}
    </Card>
  );
}
