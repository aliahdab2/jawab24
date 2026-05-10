import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import clsx from 'clsx';
import { MAX_TEMPLATE_MESSAGE_LENGTH } from '@jawab24/shared';
import type { Page } from '@jawab24/shared';
import { Card } from '@/components/ui';
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
    <Card className="border-none shadow-md shadow-theme-border/30 p-4 landscape:p-3">
      <div className="flex items-center gap-4 mb-4 landscape:mb-3">
        <div className="w-12 h-12 rounded-xl icon-bg-brand flex items-center justify-center landscape:w-10 landscape:h-10">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="text-start">
          <h4 className="font-bold text-foreground text-lg landscape:text-base">{t('replyStyle.title')}</h4>
          <p className="text-xs text-muted-foreground font-medium landscape:hidden">{t('replyStyle.desc')}</p>
        </div>
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
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <label htmlFor="brandVoiceNotes" className="text-sm font-bold text-foreground">
            {t('replyStyle.brandVoice')}
          </label>
          {isAutoTranslated && (
            <span className="text-xs text-muted-foreground">{t('replyStyle.autoTranslated')}</span>
          )}
        </div>

        {/* Examples — only when the field is empty, to teach the feature without nagging existing users. */}
        {isEmpty && (
          <div className="mb-3">
            <p className="text-xs text-muted-foreground mb-2">{t('replyStyle.examples')}</p>
            <div className="flex flex-wrap gap-2">
              {(['example1', 'example2', 'example3'] as const).map((key) => {
                const example = t(`replyStyle.${key}`);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => insertExample(example)}
                    className="px-3 py-2 text-xs font-medium rounded-full bg-muted text-muted-foreground border border-theme-border hover:bg-muted/80 hover:text-foreground transition-colors min-h-[36px] active:scale-[0.98] text-start"
                  >
                    + {example}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <textarea
          id="brandVoiceNotes"
          ref={textareaRef}
          aria-label={t('replyStyle.brandVoice')}
          className={clsx(
            'input min-h-[120px] border-none bg-background focus:ring-2 focus:ring-brand-500 p-3 rounded-2xl placeholder:text-muted-foreground placeholder:italic w-full',
            isAutoTranslated && 'text-muted-foreground italic',
            currentLang === 'ar' && 'italic-arabic',
          )}
          dir="auto"
          maxLength={MAX_TEMPLATE_MESSAGE_LENGTH}
          rows={5}
          placeholder={t('replyStyle.brandVoicePlaceholder')}
          value={value}
          onChange={(e) => updateValue(e.target.value)}
        />
        <p className="text-xs text-muted-foreground mt-1 text-end">
          {value.length}/{MAX_TEMPLATE_MESSAGE_LENGTH}
        </p>
      </div>

      {/* Tone — demoted from button row to a compact dropdown. Same data model. */}
      <div className="mb-5 flex items-center gap-3">
        <label htmlFor="replyStyleTone" className="text-sm font-medium text-foreground/80 shrink-0">
          {t('replyStyle.tone')}
        </label>
        <select
          id="replyStyleTone"
          value={settings.replyStyle}
          onChange={(e) => setSettings({ ...settings, replyStyle: e.target.value })}
          className="input bg-background border border-theme-border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 min-h-[40px]"
        >
          {STYLES.map((style) => (
            <option key={style} value={style}>
              {t(`replyStyle.${style}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Test reply — opens the existing chat-style TestSmartReplyModal so the merchant
          can preview how the AI uses their brand voice + tone. Reuses the modal already
          launched from the pages list (single source of truth for the test flow). */}
      <div className="pt-4 border-t border-theme-border">
        {hasChanges && (
          <p className="text-xs text-muted-foreground mb-2">{t('replyStyle.testSaveFirst')}</p>
        )}
        <button
          type="button"
          onClick={openTestModal}
          disabled={hasChanges === true}
          className={clsx(
            'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all min-h-[44px] active:scale-[0.98]',
            hasChanges === true
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-brand-500 text-white hover:bg-brand-600 shadow-lg',
          )}
        >
          <MessageSquare className="w-4 h-4" aria-hidden="true" />
          {t('replyStyle.openTestModal')}
        </button>
        {firstPage?.name && (
          <p className="mt-2 text-xs text-muted-foreground" dir="auto">
            {t('replyStyle.testingOnPage', { pageName: firstPage.name })}
          </p>
        )}
        {testError && (
          <p className="mt-2 text-sm text-destructive" role="alert">{testError}</p>
        )}
      </div>

      {testPage && (
        <TestSmartReplyModal
          page={testPage}
          onClose={() => setTestPage(null)}
        />
      )}
    </Card>
  );
}
