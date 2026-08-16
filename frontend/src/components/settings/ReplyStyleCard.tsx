import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import clsx from 'clsx';
import { MAX_BRAND_VOICE_LENGTH } from '@jawab24/shared';
import type { Page } from '@jawab24/shared';
import { Card, InputFieldWrapper, CharCounter, Select } from '@/components/ui';
import { Sparkles, MessageSquare, ArrowRight, X, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pagesApi } from '@/lib/api';
import { getLocaleDirection } from '@/utils/locale';
import { usePersistedBoolean } from '@/hooks/usePersistedBoolean';
import { useMultilingualSettingsField } from '@/hooks/useMultilingualSettingsField';
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
  const field = useMultilingualSettingsField(settings.brandVoiceNotesMulti);
  const { currentLang, value, sourceLang } = field;
  // Unlike the message cards, the persona shows a machine translation in place
  // (italic, editable) rather than blanking it — and treats system defaults as
  // ordinary content, hence the extra 'default' + non-empty conditions.
  const isAutoTranslated = field.isAutoTranslated && sourceLang !== 'default' && !!value;
  const isEmpty = !value.trim();

  const [testPage, setTestPage] = useState<Page | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [holdNoticeDismissed, setHoldNoticeDismissed] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [expanded, setExpanded] = usePersistedBoolean('settings:replyStyle:expanded', true);

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
    setSettings({ ...settings, brandVoiceNotesMulti: field.withValue(next) });
  };

  const insertExample = (example: string) => {
    const next = value.trim() ? `${value.trimEnd()}\n${example}` : example;
    updateValue(next.slice(0, MAX_BRAND_VOICE_LENGTH));
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  // Fetch pages once on mount so we can:
  // (1) show which page the test will run against (multi-page transparency),
  // (2) let merchants with multiple pages pick which one to test on,
  // (3) avoid a second network round-trip on click.
  // Mirrors the canonical accessor from pages.tsx — backend returns Page[] directly,
  // some legacy paths wrap as { data: Page[] }.
  const [pages, setPages] = useState<Page[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    pagesApi.getAll().then((response) => {
      if (cancelled) return;
      const data = Array.isArray(response.data)
        ? response.data
        : (Array.isArray(response.data?.data) ? response.data.data : []);
      const fetched = data as Page[];
      setPages(fetched);
      // Default to the first CONNECTED page — a disconnected page can't generate
      // a test reply. Mirrors the test-reply selection in pages.tsx (the canonical
      // `isConnected !== false` predicate); falls back to the first page only when
      // none are connected. `fetched[0]` alone defaulted to the most recently
      // created page, which is often a stale/disconnected one.
      const defaultPage = fetched.find((p) => p.isConnected !== false) ?? fetched[0];
      setSelectedPageId((prev) => prev ?? defaultPage?.id ?? null);
    }).catch(() => {
      // Silent — the test button itself will surface a real error if invoked.
    });
    return () => { cancelled = true; };
  }, []);

  const selectedPage =
    pages.find((p) => p.id === selectedPageId) ??
    pages.find((p) => p.isConnected !== false) ??
    pages[0] ??
    null;

  const openTestModal = () => {
    setTestError(null);
    // With a page scope active, the test ALWAYS runs on that page — a separate
    // picker here let the merchant write a page persona and then test on a
    // DIFFERENT page, seeing no effect of what they just wrote.
    const target = scopedPage ?? selectedPage;
    if (!target?.id) {
      setTestError(t('replyStyle.testNoPages'));
      return;
    }
    setTestPage(target);
  };

  // ── Per-page persona scope (D-084) ──────────────────────────────────────
  // The switcher renders only for multi-page workspaces (the agency case the
  // feature exists for) — a single-page merchant keeps today's card untouched.
  // 'workspace' scope = the existing settings-save flow, byte-identical.
  // A page scope edits pages.brand_voice_notes_multi via its own PATCH: an
  // EXPLICIT customize/revert pair — never a silent fork on first keystroke.
  const connectedPages = pages.filter((p) => p.isConnected !== false);
  const [personaScope, setPersonaScope] = useState<'workspace' | string>('workspace');
  const scopedPage = personaScope === 'workspace' ? null : connectedPages.find((p) => p.id === personaScope) ?? null;

  // A page counts as overridden only on real language content (mirrors the
  // backend resolver: sourceLang bookkeeping / cleared values = inherit).
  const hasOverrideContent = (multi: Page['brandVoiceNotesMulti']) =>
    Object.entries((multi ?? {}) as Record<string, string>)
      .some(([k, v]) => k !== 'sourceLang' && typeof v === 'string' && v.trim().length > 0);
  const overriddenCount = connectedPages.filter((p) => hasOverrideContent(p.brandVoiceNotesMulti)).length;

  // A page override counts only when a language entry has real content —
  // sourceLang bookkeeping and cleared values mean "inherit" (mirrors the
  // backend resolver's rule exactly).
  const pageOverride = (scopedPage?.brandVoiceNotesMulti ?? {}) as Record<string, string>;
  const pageHasOverride = hasOverrideContent(scopedPage?.brandVoiceNotesMulti);
  const pageOverrideText = pageOverride[currentLang]
    || Object.entries(pageOverride).find(([k, v]) => k !== 'sourceLang' && v?.trim())?.[1]
    || '';

  const [pageEditing, setPageEditing] = useState(false);
  const [pageDraft, setPageDraft] = useState('');
  const [pageSaving, setPageSaving] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const switchScope = (next: 'workspace' | string) => {
    setPersonaScope(next);
    setPageEditing(false);
    setPageError(null);
  };

  const startCustomizing = () => {
    // Prefill with what the page effectively uses today (its own text, else the
    // inherited workspace text) so the merchant edits, not retypes.
    setPageDraft(pageHasOverride ? pageOverrideText : value);
    setPageEditing(true);
    setPageError(null);
  };

  const applyPagePatch = async (payload: Record<string, string> | null) => {
    if (!scopedPage) return;
    setPageSaving(true);
    setPageError(null);
    try {
      const response = await pagesApi.updateBrandVoice(scopedPage.id, payload);
      const updated = response.data as Page;
      setPages((prev) => prev.map((p) => (p.id === updated.id ? { ...p, brandVoiceNotesMulti: updated.brandVoiceNotesMulti } : p)));
      setPageEditing(false);
    } catch {
      setPageError(t('replyStyle.pageSaveError'));
    } finally {
      setPageSaving(false);
    }
  };

  const savePagePersona = () => {
    const text = pageDraft.trim();
    if (!text) return;
    // Send only the current language — the backend runs the same auto-translate
    // helper as the workspace save and fills the other supported languages.
    void applyPagePatch({ [currentLang]: text.slice(0, MAX_BRAND_VOICE_LENGTH) });
  };

  const revertPagePersona = () => void applyPagePatch(null);

  const toneLabel = t(`replyStyle.${settings.replyStyle}` as const);
  const previewText = value.trim().slice(0, 60);

  return (
    <Card className="border-none shadow-sm shadow-theme-border/30 p-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="reply-style-body"
        className="w-full flex items-center gap-2.5 mb-3 text-start rounded-lg -m-1 p-1 hover:bg-muted/50 transition-colors"
      >
        <div className="w-8 h-8 rounded-lg icon-bg-brand flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-foreground text-sm text-start">{t('replyStyle.title')}</h4>
          {!expanded && (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5" dir="auto">
              {toneLabel}
              {previewText && <span className="mx-1.5 opacity-50">·</span>}
              {previewText}
              {value.trim().length > 60 && '…'}
            </p>
          )}
        </div>
        <ChevronDown
          className={clsx(
            'w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform',
            expanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      <div id="reply-style-body" hidden={!expanded}>

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
        {/* Persona scope switcher (D-084) — multi-page workspaces only. */}
        {connectedPages.length > 1 && (
          <div className="mb-2 flex items-center gap-2 flex-wrap p-2 rounded-xl bg-brand-50 dark:bg-brand-500/10 border border-brand-200 dark:border-brand-500/30">
            <span id="persona-scope-label" className="text-xs font-bold text-brand-700 dark:text-brand-300 shrink-0">
              {t('replyStyle.scopeLabel')}
            </span>
            <Select
              value={personaScope}
              onChange={switchScope}
              options={[
                { value: 'workspace', label: t('replyStyle.scopeAllPages') },
                // Overridden pages are marked IN the list — the merchant sees
                // which pages diverge before opening each one.
                ...connectedPages.map((p) => ({
                  value: p.id,
                  label: hasOverrideContent(p.brandVoiceNotesMulti)
                    ? t('replyStyle.overriddenOption', { page: p.name ?? '' })
                    : p.name ?? '',
                })),
              ]}
              aria-labelledby="persona-scope-label"
              compact
            />
            {scopedPage && (
              <span
                className={clsx(
                  'text-[11px] font-bold px-2 py-0.5 rounded-full',
                  pageHasOverride
                    ? 'bg-accent-100 text-accent-700 dark:bg-accent-500/20 dark:text-accent-300'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {pageHasOverride ? t('replyStyle.customChip') : t('replyStyle.inheritedChip')}
              </span>
            )}
            {!scopedPage && overriddenCount > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-500/20 dark:text-accent-300">
                {t('replyStyle.overriddenCount', { count: overriddenCount })}
              </span>
            )}
          </div>
        )}
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="brandVoiceNotes" className="text-sm font-bold text-foreground">
            {scopedPage ? t('replyStyle.pageBrandVoice', { page: scopedPage.name ?? '' }) : t('replyStyle.brandVoice')}
          </label>
          {!scopedPage && isAutoTranslated && (
            <span className="text-[11px] text-muted-foreground">{t('replyStyle.autoTranslated')}</span>
          )}
        </div>

        {/* Page scope: explicit inherit/customize states — no silent fork. */}
        {scopedPage && !pageEditing && (
          <div className="rounded-2xl border border-theme-border p-3 flex flex-col gap-2">
            <p className="text-sm leading-relaxed whitespace-pre-line" dir="auto">
              {pageHasOverride
                ? pageOverrideText
                : <span className="text-muted-foreground italic">{value || t('replyStyle.noWorkspacePersona')}</span>}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={startCustomizing}
                disabled={pageSaving}
                className="min-h-[44px] px-4 rounded-xl text-sm font-bold bg-brand-500/10 text-brand-700 dark:text-brand-300 border border-brand-500/30 hover:bg-brand-500/20 transition-colors"
              >
                {pageHasOverride ? t('replyStyle.editPagePersona') : t('replyStyle.customizeBtn')}
              </button>
              {pageHasOverride && (
                <button
                  type="button"
                  onClick={revertPagePersona}
                  disabled={pageSaving}
                  aria-busy={pageSaving}
                  className="min-h-[44px] px-4 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  {t('replyStyle.revertBtn')}
                </button>
              )}
            </div>
          </div>
        )}
        {scopedPage && pageEditing && (
          <div className="flex flex-col gap-2">
            <InputFieldWrapper
              className="border border-theme-border hover:border-brand-300 dark:hover:border-brand-700 transition-colors"
              trailing={
                pageDraft.length >= MAX_BRAND_VOICE_LENGTH * 0.8
                  ? <CharCounter value={pageDraft.length} max={MAX_BRAND_VOICE_LENGTH} />
                  : null
              }
            >
              <textarea
                aria-label={t('replyStyle.pageBrandVoice', { page: scopedPage.name ?? '' })}
                className="w-full bg-transparent border-none p-4 pe-14 rounded-2xl resize-y text-sm leading-relaxed min-h-[140px] placeholder:text-muted-foreground placeholder:italic focus:outline-none focus:ring-0"
                dir="auto"
                maxLength={MAX_BRAND_VOICE_LENGTH}
                rows={5}
                placeholder={t('replyStyle.brandVoicePlaceholder')}
                value={pageDraft}
                onChange={(e) => setPageDraft(e.target.value)}
              />
            </InputFieldWrapper>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={savePagePersona}
                disabled={pageSaving || !pageDraft.trim()}
                aria-busy={pageSaving}
                className="min-h-[44px] px-4 rounded-xl text-sm font-bold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {pageSaving ? t('replyStyle.savingPage') : t('replyStyle.savePageBtn')}
              </button>
              <button
                type="button"
                onClick={() => { setPageEditing(false); setPageError(null); }}
                disabled={pageSaving}
                className="min-h-[44px] px-4 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {t('replyStyle.cancelPageEdit')}
              </button>
            </div>
            {/* Save-model disambiguation: page personas save HERE, immediately —
                not through the page-bottom «حفظ الإعدادات» button. Without this
                line the merchant edits, scrolls down, and doubts it saved. */}
            <p className="text-[11px] text-muted-foreground" dir="auto">{t('replyStyle.pageSaveHint')}</p>
          </div>
        )}
        {scopedPage && pageError && (
          <p className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">{pageError}</p>
        )}

        {/* Empty state — offer the generic persona skeleton (name · voice · style · goal),
            modeled on the structure high-converting merchants use. Business-agnostic, so it
            fits any merchant; the old hardcoded retail examples were dropped as misleading
            (e.g. "free shipping over 200 SAR" makes no sense for a travel or training page). */}
        {!scopedPage && isEmpty && (
          <div className="mb-2">
            <button
              type="button"
              onClick={() => insertExample(t('replyStyle.exampleTemplate'))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-brand-500/10 text-brand-700 dark:text-brand-300 border border-brand-500/30 hover:bg-brand-500/20 transition-colors active:scale-[0.98] text-start"
            >
              {t('replyStyle.templateLabel')}
            </button>
            <p className="text-[11px] text-muted-foreground mt-1" dir="auto">{t('replyStyle.templateHint')}</p>
          </div>
        )}

        {!scopedPage && (
        <InputFieldWrapper
          className="border border-theme-border hover:border-brand-300 dark:hover:border-brand-700 transition-colors"
          trailing={
            value.length >= MAX_BRAND_VOICE_LENGTH * 0.8
              ? <CharCounter value={value.length} max={MAX_BRAND_VOICE_LENGTH} />
              : null
          }
        >
          <textarea
            id="brandVoiceNotes"
            ref={textareaRef}
            aria-label={t('replyStyle.brandVoice')}
            className={clsx(
              'w-full bg-transparent border-none p-4 pe-14 rounded-2xl resize-y text-sm leading-relaxed min-h-[140px]',
              'placeholder:text-muted-foreground placeholder:italic',
              'focus:outline-none focus:ring-0',
              isAutoTranslated && 'text-muted-foreground italic',
              currentLang === 'ar' && 'italic-arabic',
            )}
            dir={value ? 'auto' : getLocaleDirection(currentLang)}
            maxLength={MAX_BRAND_VOICE_LENGTH}
            rows={5}
            placeholder={t('replyStyle.brandVoicePlaceholder')}
            value={value}
            onChange={(e) => updateValue(e.target.value)}
          />
        </InputFieldWrapper>
        )}
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
      {/* No separate «التجربة على» row (owner call, 2026-08-16): the persona
          scope switcher is the ONE page selector — the test follows it
          (scopedPage ?? first connected page). A second picker here could
          contradict the scope: write a page persona, test a different page,
          see no effect of what was just written. */}
      {(hasChanges || testError) && (
        <div className="mt-1.5 flex items-center justify-end gap-1.5 flex-wrap">
          {hasChanges && (
            <p className="text-[11px] text-muted-foreground">{t('replyStyle.testSaveFirst')}</p>
          )}
          {testError && (
            <p className="text-xs text-destructive w-full text-end" role="alert">{testError}</p>
          )}
        </div>
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
