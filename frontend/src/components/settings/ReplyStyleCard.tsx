import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import clsx from 'clsx';
import { MAX_BRAND_VOICE_LENGTH } from '@jawab24/shared';
import type { Page } from '@jawab24/shared';
import { Card, InputFieldWrapper, CharCounter, Select, ConfirmationModal } from '@/components/ui';
import { captureError } from '@/lib/sentryHelpers';
import { Sparkles, MessageSquare, ArrowRight, X, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pagesApi } from '@/lib/api';
import { isReplyModeVisible } from '@/lib/featureFlags';
import { getLocaleDirection } from '@/utils/locale';
import { usePersistedBoolean } from '@/hooks/usePersistedBoolean';
import { useMultilingualSettingsField } from '@/hooks/useMultilingualSettingsField';
import { useHintDisplay } from '@/hooks/useHintDisplay';
import type { SettingsCardProps } from './types';

// Lazy-load the modal — keeps it out of the settings-page bundle until the merchant
// actually clicks Test (matches how /pages.tsx loads it via next/dynamic).
const TestSmartReplyModal = dynamic(
  () => import('@/components/test-smart-reply/TestSmartReplyModal').then((m) => m.TestSmartReplyModal),
  { ssr: false },
);

const STYLES = ['professional', 'casual', 'enthusiastic'] as const;
const HOLD_RELOCATION_SEEN_KEY = 'hold_relocation_seen';

// A page counts as overridden only on real language content (mirrors the
// backend resolver: sourceLang bookkeeping / cleared values = inherit).
const hasOverrideContent = (multi: Page['brandVoiceNotesMulti']) =>
  Object.entries((multi ?? {}) as Record<string, string>)
    .some(([k, v]) => k !== 'sourceLang' && typeof v === 'string' && v.trim().length > 0);

// The page override's display text for an editing language: that language's
// variant, else the first real content in any language (same any-language
// tail as the backend resolver).
const pageOverrideTextFor = (page: Page | null | undefined, lang: string) => {
  const override = (page?.brandVoiceNotesMulti ?? {}) as Record<string, string>;
  return override[lang]
    || Object.entries(override).find(([k, v]) => k !== 'sourceLang' && v?.trim())?.[1]
    || '';
};

interface ReplyStyleCardProps extends SettingsCardProps {
  hasChanges?: boolean;
  onScrollToAdvanced?: () => void;
  /**
   * The PERSISTED workspace persona (parent's initialSettings) — the text an
   * inheriting page actually inherits. The page-scope editor seeds from this,
   * never from the live `settings` draft, which can be dirty. Optional only
   * for legacy call sites/tests; when absent the draft is assumed clean.
   */
  savedBrandVoiceNotesMulti?: Record<string, string>;
  /**
   * The PERSISTED workspace reply mode (parent's initialSettings) — what an
   * inheriting page actually inherits TODAY. The page-scope options render the
   * inherit label from this, never from the live draft (same rule as
   * savedBrandVoiceNotesMulti), and page pins are disabled while the draft
   * default is unsaved so the merchant never customizes against a default
   * that doesn't exist yet.
   */
  savedReplyMode?: 'sales' | 'info';
  /** Active workspace id — gates the reply-mode section (D-085 pilot). */
  workspaceId?: string | null;
}

export function ReplyStyleCard({ settings, setSettings, hasChanges, onScrollToAdvanced, savedBrandVoiceNotesMulti, savedReplyMode = 'sales', workspaceId }: ReplyStyleCardProps) {
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
  // A page scope shows the editor DIRECTLY, prefilled with the page's effective
  // persona (its own text, else the SAVED workspace text). The SAVE button
  // is the explicit fork point — it only enables once the draft differs, so an
  // override is never created by merely looking (owner call, 2026-08-16: the
  // extra «تخصيص» step was redundant friction on top of that).
  // The switcher lists every connected page PLUS any disconnected page still
  // carrying an override: the override lives on the row, not the token, so a
  // revoked token must not make the persona invisible and unrevertable while
  // a reconnect silently revives it.
  // A page carrying ANY row-level override stays listed even when disconnected
  // — the reply-mode pin (D-085) counts exactly like the persona does: it lives
  // on the row, not the token, so a revoked token must not make the pin
  // invisible and unrevertable while a reconnect silently revives it.
  const hasRowOverride = (p: Page) => hasOverrideContent(p.brandVoiceNotesMulti) || p.replyMode === 'sales' || p.replyMode === 'info';
  const switcherPages = pages.filter((p) => p.isConnected !== false || hasRowOverride(p));
  const [personaScope, setPersonaScope] = useState<'workspace' | string>('workspace');
  const scopedPage = personaScope === 'workspace' ? null : switcherPages.find((p) => p.id === personaScope) ?? null;

  const overriddenCount = pages.filter((p) => hasOverrideContent(p.brandVoiceNotesMulti)).length;

  const pageHasOverride = hasOverrideContent(scopedPage?.brandVoiceNotesMulti);
  const pageOverrideText = pageOverrideTextFor(scopedPage, currentLang);

  // The inherited text a page-scope editor shows is the PERSISTED workspace
  // persona, never the live draft: `value` can be dirty (hasChanges exists
  // precisely because of that), and presenting an unsaved draft as "this page
  // uses the general persona" is false — one «حفظ شخصية الصفحة» away from
  // pinning words the merchant never saved anywhere.
  const savedWorkspaceMulti = savedBrandVoiceNotesMulti ?? settings.brandVoiceNotesMulti;
  const savedWorkspaceValue = savedWorkspaceMulti?.[currentLang] || '';

  // The page's effective text: its own override, else the saved workspace text.
  const pageEffectiveText = pageHasOverride ? pageOverrideText : savedWorkspaceValue;

  const [pageDraft, setPageDraft] = useState('');
  const [pageSaving, setPageSaving] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<string | null>(null);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const pageDraftChanged = pageDraft.trim() !== pageEffectiveText.trim();
  // "Divergent" is not the same as "savable": an EMPTY textarea diverges from the
  // inherited text but cannot be saved (a page persona is never blank — clearing
  // one is the Revert flow, which an inheriting page does not even offer). Both
  // the Save button and the Test gate must key off the savable predicate, or the
  // merchant who select-all-deletes gets Save disabled AND Test disabled with a
  // tooltip telling them to save.
  const pageDraftSavable = !!pageDraft.trim() && pageDraftChanged;

  // Single seeding source: reseed whenever the scoped page OR the editing
  // language changes. Without the language leg, flipping the dashboard locale
  // mid-scope kept the OLD language's text in the draft and saved it under the
  // NEW language key. The ref keys the last seed, so re-renders (or a
  // workspace save changing savedWorkspaceValue) never clobber typing; the
  // guard makes the no-deps effect idempotent per (page, language) pair.
  const pageSeedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!scopedPage) {
      pageSeedKeyRef.current = null;
      return;
    }
    const seedKey = `${scopedPage.id}:${currentLang}`;
    if (pageSeedKeyRef.current === seedKey) return;
    pageSeedKeyRef.current = seedKey;
    setPageDraft(hasOverrideContent(scopedPage.brandVoiceNotesMulti) ? pageOverrideTextFor(scopedPage, currentLang) : savedWorkspaceValue);
    setPageError(null);
    setPageNotice(null);
  }, [scopedPage, currentLang, savedWorkspaceValue]);

  // Success notices are transient — the chip carries the durable state.
  useEffect(() => {
    if (!pageNotice) return;
    const timer = setTimeout(() => setPageNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [pageNotice]);

  const switchScope = (next: 'workspace' | string) => {
    setPersonaScope(next);
    setPageError(null);
    setPageNotice(null);
    setPageModeError(null);
    // Every transient message here names the scope it was raised in. The
    // mode notice renders in BOTH branches, so leaving it up through a switch
    // makes «تم حفظ اختيار هذه الصفحة ✓» describe a page that was never saved —
    // or the workspace radiogroup, which is not saved without the Save bar at
    // all. Same defect this card exists to remove, one control over.
    clearPageModeNotice();
  };

  const applyPagePatch = async (payload: Record<string, string> | null) => {
    if (!scopedPage) return;
    setPageSaving(true);
    setPageError(null);
    setPageNotice(null);
    try {
      const response = await pagesApi.updateBrandVoice(scopedPage.id, payload);
      const updated = response.data as Page;
      setPages((prev) => prev.map((p) => (p.id === updated.id ? { ...p, brandVoiceNotesMulti: updated.brandVoiceNotesMulti } : p)));
      if (payload === null) {
        // Reverted to inherit — the editor shows the saved workspace text again.
        setPageDraft(savedWorkspaceValue);
        setPageNotice(t('replyStyle.pageReverted'));
      } else {
        setPageNotice(t('replyStyle.pageSaved'));
      }
    } catch (err) {
      captureError(err, 'Failed to save page persona', {
        tags: { component: 'ReplyStyleCard' },
        extra: { pageId: scopedPage.id, revert: payload === null },
      });
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

  // A persona is merchant-authored writing (up to MAX_BRAND_VOICE_LENGTH per
  // language, auto-translated variants included) and the PATCH has no undo —
  // deleting it needs an explicit confirmation, not a one-click button beside
  // the save.
  const revertPagePersona = () => setConfirmRevert(true);

  // ── Reply mode (D-085) — pilot workspaces only ───────────────────────────
  // Workspace scope binds settings.replyMode through the page-bottom save
  // (a PIPELINE_FIELDS member — no new save path). A page scope PATCHes
  // immediately (optimistic, rolled back on error), like the lead config.
  const replyModeEnabled = isReplyModeVisible(workspaceId);
  const modeLabel = (mode: 'sales' | 'info') =>
    t(mode === 'info' ? 'replyMode.infoDesk' : 'replyMode.sales');
  const [pageModeSaving, setPageModeSaving] = useState(false);
  const [pageModeError, setPageModeError] = useState<string | null>(null);
  // Its OWN notice, not the persona's `pageNotice`: sharing that state renders
  // the confirmation twice — once here and once under the persona textarea,
  // where "saved for this page" would be describing the wrong control.
  // The transient-message mechanism itself is the shared hook (Rule 10.5/10.8),
  // which also owns the unmount cleanup a hand-rolled ref+timeout forgot.
  const {
    hint: pageModeNotice,
    showHint: flashPageModeNotice,
    clearHint: clearPageModeNotice,
  } = useHintDisplay(4000);
  // Page pins are disabled while the DRAFT default differs from the PERSISTED
  // one: the inherit option's label names the saved default, and letting the
  // merchant customize against an unsaved draft pins pages to a default that
  // doesn't exist yet.
  // The draft workspace mode, narrowed once — two readers (the unsaved-draft
  // guard below and the persona copy further down) must not each re-derive it.
  const draftWorkspaceMode: 'sales' | 'info' = settings.replyMode === 'info' ? 'info' : 'sales';
  const workspaceModeDraftUnsaved = draftWorkspaceMode !== savedReplyMode;
  const scopedPageMode: 'sales' | 'info' | null =
    scopedPage?.replyMode === 'info' ? 'info' : scopedPage?.replyMode === 'sales' ? 'sales' : null;

  const setWorkspaceMode = (mode: 'sales' | 'info') => {
    if (settings.replyMode !== mode) setSettings({ ...settings, replyMode: mode });
  };

  const setPageMode = async (mode: 'sales' | 'info' | null) => {
    if (!scopedPage || pageModeSaving || scopedPageMode === mode) return;
    const pageId = scopedPage.id;
    const previous = scopedPageMode;
    setPageModeSaving(true);
    setPageModeError(null);
    // Optimistic: pin locally now, roll back on error.
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, replyMode: mode } : p)));
    try {
      await pagesApi.updateReplyMode(pageId, mode);
      // A save with NO button must SAY it saved. Without this the click was
      // silent — no button, no ✓, nothing — so the merchant reasonably reads it
      // as "nothing happened / where is Save?" (owner report 2026-08-17). The
      // persona editor in this same scope confirms its save; so does this now.
      flashPageModeNotice(t('replyMode.pageSaved'));   // «تم حفظ اختيار هذه الصفحة ✓»
    } catch (err) {
      setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, replyMode: previous } : p)));
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      setPageModeError(code === 'REPLY_MODE_NOT_ENABLED' ? t('replyMode.notEnabled') : t('replyMode.pageUpdateError'));
      captureError(err, 'Failed to save page reply mode', {
        tags: { component: 'ReplyStyleCard' },
        extra: { pageId },
      });
    } finally {
      setPageModeSaving(false);
    }
  };

  // The mode the scoped page will actually RUN with (its pin, else the saved
  // workspace default) — decides whether the quiet-leads note applies.
  const scopedPageEffectiveMode = scopedPageMode ?? savedReplyMode;

  // Which mode the PERSONA COPY below should describe. The placeholder used to
  // tell every merchant to write «اطلب اسم العميل ورقمه» — an instruction the
  // ai-worker's INFO-DESK block explicitly overrides ("override any instruction
  // in your persona notes to collect customer details"), and that in SALES mode
  // changes nothing either, because asking for name+phone is demonstrated by the
  // static prefix, not by the persona. So the card invited the merchant to write
  // a behavioural line that is inert in one mode and reversed in the other.
  // Workspace scope follows the DRAFT (the guidance must flip the moment the
  // merchant picks a mode); a page scope follows what that page will run.
  //
  // ⚠️ Off the allowlist the copy follows the SAVED mode, never a hardcoded
  // 'sales'. The allowlist gates the WRITE paths only — the reply pipeline
  // "reads whatever is stored" (backend/docs/SETTINGS.md). So on the documented
  // rollback path (REPLY_MODE_WORKSPACE_IDS emptied as the kill switch, or a
  // workspace dropped after the pilot) a stored 'info' KEEPS running INFO-DESK
  // while its control disappears. Forcing sales copy there would show the
  // collect-instruction guidance to precisely the merchant whose replies still
  // reverse it — reintroducing this card's defect on the one path where nobody
  // is watching. There is no draft to follow without a control, hence the saved
  // value; a workspace that never set info still resolves to 'sales'.
  const copyMode: 'sales' | 'info' = scopedPage
    ? scopedPageEffectiveMode
    : (replyModeEnabled ? draftWorkspaceMode : savedReplyMode);
  const placeholderKey = copyMode === 'info'
    ? 'replyStyle.brandVoicePlaceholderInfo'
    : 'replyStyle.brandVoicePlaceholder';

  // Testing must never run against text the merchant can still see but has not
  // saved. `hasChanges` only covers the WORKSPACE draft (`settings` vs
  // `initialSettings`), and a page persona lives in local `pageDraft` — so a
  // page-scope edit left the button ENABLED and the reply was generated from the
  // SAVED persona while the new text sat on screen. Worse than a silent save: it
  // answers plausibly from the wrong input, so the merchant reads it as "my words
  // had no effect".
  // ⚠️ The `scopedPage` guard is load-bearing. Outside a page scope the seeding
  // effect returns early, so `pageDraft` stays '' (or holds the last page's text)
  // while `pageEffectiveText` is the workspace persona — the draft predicate is
  // then true for every merchant with a persona, which would disable the button
  // for all of them.
  const testBlockedByPageDraft = !!scopedPage && pageDraftSavable;
  const testBlocked = hasChanges === true || testBlockedByPageDraft;

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
        {switcherPages.length > 1 && (
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
                // which pages diverge before opening each one. A disconnected
                // page appears only because it carries an override, and says so.
                // A pinned reply mode (D-085) is marked the same way.
                ...switcherPages.map((p) => {
                  const base = hasOverrideContent(p.brandVoiceNotesMulti)
                    ? (p.isConnected === false
                      ? t('replyStyle.overriddenOptionDisconnected', { page: p.name ?? '' })
                      : t('replyStyle.overriddenOption', { page: p.name ?? '' }))
                    : p.name ?? '';
                  const pinnedMode = replyModeEnabled && (p.replyMode === 'sales' || p.replyMode === 'info')
                    ? (p.replyMode as 'sales' | 'info')
                    : null;
                  return {
                    value: p.id,
                    label: pinnedMode ? t('replyMode.pinnedOption', { label: base, mode: modeLabel(pinnedMode) }) : base,
                  };
                }),
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
            {/* The teaching line renders ONLY in «كل الصفحات» view — in a page
                scope the chip already states the page's mode and the save-hint
                below the button carries the how-to; a paragraph here repeated
                both (merchant feedback 2026-08-17: crowded, duplicated info). */}
            {!scopedPage && (
              <p className="w-full text-[11px] text-brand-700/80 dark:text-brand-300/80 mt-0.5" dir="auto">
                {t('replyStyle.allPagesExplainer')}
              </p>
            )}
          </div>
        )}
        {/* Reply-mode question (D-085) — pilot workspaces only. Business
            question, not a technical term: the merchant picks what the
            assistant DOES with a buying customer. Workspace scope binds
            settings.replyMode (saved by the page-bottom button); a page scope
            PATCHes immediately with an inherit option naming the SAVED
            default. */}
        {replyModeEnabled && (
          <div className="mb-3 p-3 rounded-xl border border-theme-border bg-muted/30">
            <p id="reply-mode-question" className="text-sm font-bold text-foreground mb-2" dir="auto">
              {t('replyMode.question')}
            </p>
            {!scopedPage ? (
              <div role="radiogroup" aria-labelledby="reply-mode-question" className="flex flex-col gap-2">
                {(['sales', 'info'] as const).map((mode) => {
                  const selected = (settings.replyMode === 'info' ? 'info' : 'sales') === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setWorkspaceMode(mode)}
                      className={clsx(
                        'min-h-[44px] w-full flex flex-col items-start gap-0.5 px-3 py-2 rounded-xl border text-start transition-colors',
                        selected
                          ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
                          : 'border-theme-border hover:border-brand-300 dark:hover:border-brand-700',
                      )}
                    >
                      <span className="text-sm font-bold text-foreground">{modeLabel(mode)}</span>
                      <span className="text-xs text-muted-foreground" dir="auto">
                        {t(mode === 'info' ? 'replyMode.infoDeskDesc' : 'replyMode.salesDesc')}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div
                role="radiogroup"
                aria-labelledby="reply-mode-question"
                aria-busy={pageModeSaving}
                className="flex flex-col gap-2"
              >
                {([null, 'sales', 'info'] as const).map((mode) => {
                  const selected = scopedPageMode === mode;
                  const label = mode === null
                    ? t('replyMode.inherit', { mode: modeLabel(savedReplyMode) })
                    : modeLabel(mode);
                  return (
                    <button
                      key={mode ?? 'inherit'}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={pageModeSaving || workspaceModeDraftUnsaved}
                      onClick={() => void setPageMode(mode)}
                      className={clsx(
                        'min-h-[44px] w-full flex flex-col items-start gap-0.5 px-3 py-2 rounded-xl border text-start transition-colors',
                        selected
                          ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
                          : 'border-theme-border hover:border-brand-300 dark:hover:border-brand-700',
                        (pageModeSaving || workspaceModeDraftUnsaved) && 'opacity-60 cursor-not-allowed',
                      )}
                    >
                      <span className="text-sm font-bold text-foreground">{label}</span>
                      {mode !== null && (
                        <span className="text-xs text-muted-foreground" dir="auto">
                          {t(mode === 'info' ? 'replyMode.infoDeskDesc' : 'replyMode.salesDesc')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {/* ONE hint line: page pins blocked until the draft default is
                saved; otherwise page choices save immediately. The quiet-leads
                note appears exactly when the shown selection means 'info'. */}
            {scopedPage && workspaceModeDraftUnsaved && (
              <p className="mt-1.5 text-[11px] text-muted-foreground" dir="auto">{t('replyMode.saveDefaultFirst')}</p>
            )}
            {scopedPage && !workspaceModeDraftUnsaved && (
              <p className="mt-1.5 text-[11px] text-muted-foreground" dir="auto">{t('replyMode.pageAutoSaves')}</p>
            )}
            {((scopedPage && scopedPageEffectiveMode === 'info') || (!scopedPage && settings.replyMode === 'info')) && (
              <p className="mt-1.5 text-[11px] text-muted-foreground" dir="auto">{t('replyMode.infoLeadsNote')}</p>
            )}
            {/* Success is announced HERE, next to the control that saved —
                the persona editor's notice lives further down the card and a
                merchant who never scrolls there sees nothing at all.
                The live region is ALWAYS mounted and merely sr-only when empty
                (the pattern the persona notice below already uses): a region
                inserted together with its text is not reliably announced, which
                would leave screen-reader users with the very silent save this
                notice exists to end. The error path uses role="alert", which IS
                announced on insertion, so only success needed the change. */}
            <p
              aria-live="polite"
              className={clsx(
                'mt-1.5 text-xs text-brand-600 dark:text-brand-400',
                (!pageModeNotice || pageModeError) && 'sr-only',
              )}
              dir="auto"
            >
              {pageModeError ? '' : pageModeNotice ?? ''}
            </p>
            {pageModeError && (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">{pageModeError}</p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between mb-1.5">
          {/* The htmlFor follows the scope — in page scope the workspace
              textarea (#brandVoiceNotes) is not in the DOM, and a label with a
              dangling `for` neither focuses the visible field on click nor
              associates it for assistive tech. */}
          <label htmlFor={scopedPage ? 'pageBrandVoiceNotes' : 'brandVoiceNotes'} className="text-sm font-bold text-foreground">
            {scopedPage ? t('replyStyle.pageBrandVoice', { page: scopedPage.name ?? '' }) : t('replyStyle.brandVoice')}
          </label>
          {!scopedPage && isAutoTranslated && (
            <span className="text-[11px] text-muted-foreground">{t('replyStyle.autoTranslated')}</span>
          )}
        </div>

        {/* Page scope: the editor directly, prefilled with the effective persona.
            The SAVE button is the fork point — disabled until the draft differs,
            so an override is never created by merely looking. */}
        {scopedPage && (
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
                id="pageBrandVoiceNotes"
                aria-label={t('replyStyle.pageBrandVoice', { page: scopedPage.name ?? '' })}
                className={clsx(
                  'w-full bg-transparent border-none p-4 pe-14 rounded-2xl resize-y text-sm leading-relaxed min-h-[140px]',
                  'placeholder:text-muted-foreground placeholder:italic focus:outline-none focus:ring-0',
                  // Inherited text renders muted-italic until the merchant makes
                  // it this page's own — same signal the workspace card uses for
                  // auto-translated text.
                  !pageHasOverride && !pageDraftChanged && 'text-muted-foreground italic',
                )}
                dir="auto"
                maxLength={MAX_BRAND_VOICE_LENGTH}
                rows={5}
                placeholder={t(placeholderKey)}
                value={pageDraft}
                onChange={(e) => setPageDraft(e.target.value)}
              />
            </InputFieldWrapper>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={savePagePersona}
                disabled={pageSaving || !pageDraftSavable}
                aria-busy={pageSaving}
                // Disabled = INERT (muted), not a faded primary: at rest there is
                // nothing to save, and a half-opacity teal block was the loudest
                // element on the card. The teal state now means exactly one
                // thing — "you have an unsaved page change".
                className="min-h-[44px] px-4 rounded-xl text-sm font-bold bg-brand-600 text-white hover:bg-brand-700 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors"
              >
                {pageSaving ? t('replyStyle.savingPage') : t('replyStyle.savePageBtn')}
              </button>
              {pageHasOverride && (
                <button
                  type="button"
                  onClick={revertPagePersona}
                  disabled={pageSaving}
                  // Bordered ghost, not bare text: on narrow screens this wraps
                  // to its own row, and without an outline it read as a stray
                  // caption rather than an action (mobile audit 2026-08-17).
                  className="min-h-[44px] px-4 rounded-xl text-sm font-medium border border-theme-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {t('replyStyle.revertBtn')}
                </button>
              )}
            </div>
            {/* ONE state-aware line owns the how-to: inherited pages get the
                fork instruction (edit + save = own persona), overridden pages
                get the save-model disambiguation (saves HERE, immediately — not
                the page-bottom «حفظ الإعدادات» button). */}
            <p className="text-[11px] text-muted-foreground" dir="auto">
              {pageHasOverride ? t('replyStyle.pageSaveHint') : t('replyStyle.pageInheritedHint')}
            </p>
            {/* Explicit success signal — the workspace path confirms its save
                («تم حفظ الإعدادات بنجاح ✓»), so must this one; the chip alone
                doesn't move when an EXISTING override is edited. */}
            <p aria-live="polite" className={clsx('text-xs text-brand-600 dark:text-brand-400', !pageNotice && 'sr-only')} dir="auto">
              {pageNotice ?? ''}
            </p>
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
            placeholder={t(placeholderKey)}
            value={value}
            onChange={(e) => updateValue(e.target.value)}
          />
        </InputFieldWrapper>
        )}
        {/* The general persona saves through the page-bottom «حفظ الإعدادات»
            button (it batches with tone + the other settings), unlike the
            page-scope inline save — say so the moment the merchant edits,
            or they look for an inline button that isn't there. */}
        {!scopedPage && hasChanges && (
          <p className="mt-1.5 text-[11px] text-muted-foreground" dir="auto">{t('replyStyle.workspaceSaveHint')}</p>
        )}
        {/* Info mode is the ONE case where a persona instruction is actively
            reversed rather than merely inert, so it is the one case that earns a
            line of its own. Sales/non-pilot pay nothing — the placeholder alone
            carries the guidance there, and a card that grows on every merchant
            to warn the few is the wrong trade on a phone. Placed after both
            scope branches so one node serves the workspace and page editors. */}
        {copyMode === 'info' && (
          <p className="mt-1.5 text-[11px] text-muted-foreground" dir="auto">{t('replyStyle.infoModeNote')}</p>
        )}
      </div>

      {/* Tone + Test.
          ⚠️ The tone is WORKSPACE-level (replyStyle feeds the ai-worker tone
          directive and the reply-cache key; D-084 scoped only the persona text),
          yet it renders under the page-scope editor too, where it can read as
          per-page. The SCOPE is still workspace-wide pending the InMedia pilot —
          what changed (2026-08-17) is that the page scope now SAYS so
          (`tonePageNote`) instead of leaving the merchant to guess. A page
          needing its own tone still states it in its persona text. Recorded in
          backend/docs/SETTINGS.md.
          The segments were 'px-2.5 py-1 text-xs' — a ~24px tap target on a card
          whose every other control is min-h-[44px] (the reply-mode options right
          above it). Widened to a full-row 3-up grid at 44px: it clears the touch
          floor and gains a description WITHOUT becoming a third stacked block of
          described options — that version was built, measured much taller, and
          was rejected for the phone (owner, 2026-08-17). The Test button moves
          up beside the label, so the row count is unchanged. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span id="replyStyleToneLabel" className="text-xs font-bold text-foreground shrink-0">
            {t('replyStyle.tone')}
          </span>
          <button
            type="button"
            onClick={openTestModal}
            disabled={testBlocked}
            title={testBlocked ? t('replyStyle.testSaveFirst') : undefined}
            // `title` is hover-only — it never surfaces on a phone, which is
            // where this card is read. So the page-draft block (the one with no
            // Save bar on screen to explain it) also states its reason in a
            // visible line, wired here for assistive tech.
            aria-describedby={testBlockedByPageDraft ? 'replyStyleTestBlocked' : undefined}
            className={clsx(
              // min-h-[44px] for the same reason the tone row got it: this
              // button sits IN that row now, and a ~30px target beside 44px
              // ones is the mis-tap geometry the widening was meant to remove.
              'ms-auto inline-flex items-center gap-1.5 min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-[0.98]',
              testBlocked
                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                : 'bg-brand-500 text-white hover:bg-brand-600',
            )}
          >
            <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
            {t('replyStyle.openTestModal')}
          </button>
        </div>
        <div
          role="radiogroup"
          aria-labelledby="replyStyleToneLabel"
          className="grid grid-cols-3 gap-0.5 p-0.5 rounded-xl bg-muted border border-theme-border"
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
                  // leading-tight so the longest label ("Enthusiastic") can wrap
                  // to a second line inside the 44px box on a 320px card instead
                  // of overflowing its third of the row.
                  'min-h-[44px] px-1 text-[13px] font-bold leading-tight rounded-[10px] transition-all',
                  selected
                    ? 'bg-background text-brand-600 dark:text-brand-400 shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`replyStyle.${style}`)}
              </button>
            );
          })}
        </div>
        {/* ONE line, describing the SELECTED option — the whole gain of the
            rejected block, at a twelfth of its height. */}
        <p className="text-[11px] text-muted-foreground" dir="auto">
          {t(`replyStyle.${settings.replyStyle}Desc` as const)}
        </p>
        {/* The tone is workspace-level (see the warning above). Inside a page
            scope that is invisible and reads as per-page — so say it there, and
            only there. */}
        {scopedPage && (
          <p className="text-[11px] text-muted-foreground" dir="auto">{t('replyStyle.tonePageNote')}</p>
        )}
        {/* Only for the page-draft block: a workspace-draft block already has
            the Save bar and its own hint on screen, so a third mention there
            would be noise. Costs no height at rest. */}
        {testBlockedByPageDraft && (
          <p id="replyStyleTestBlocked" className="text-[11px] text-muted-foreground" dir="auto">
            {t('replyStyle.testSaveFirst')}
          </p>
        )}
      </div>
      {/* No separate «التجربة على» row (owner call, 2026-08-16): the persona
          scope switcher is the ONE page selector — the test follows it
          (scopedPage ?? first connected page). No standalone «save to test»
          line either (owner call): the single hint under the textarea carries
          both messages, and the disabled button keeps its tooltip. */}
      {testError && (
        <div className="mt-1.5 flex items-center justify-end gap-1.5 flex-wrap">
          <p className="text-xs text-destructive w-full text-end" role="alert">{testError}</p>
        </div>
      )}

      </div>

      {testPage && (
        <TestSmartReplyModal
          page={testPage}
          onClose={() => setTestPage(null)}
        />
      )}

      {/* Revert is destructive (deletes the page's persona in every language,
          no undo) — never one click. */}
      <ConfirmationModal
        isOpen={confirmRevert}
        onClose={() => setConfirmRevert(false)}
        onConfirm={() => {
          setConfirmRevert(false);
          void applyPagePatch(null);
        }}
        title={t('replyStyle.revertConfirmTitle')}
        message={t('replyStyle.revertConfirmBody', { page: scopedPage?.name ?? '' })}
        confirmText={t('replyStyle.revertBtn')}
        variant="danger"
      />
    </Card>
  );
}
