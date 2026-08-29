import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useQuery } from '@tanstack/react-query';
import { X, Save, Check, FileText, Eye, MessageCircleQuestion, Lightbulb, ClipboardPaste } from 'lucide-react';
import { toast } from 'sonner';
import { Button, InfoPopover, ViewOnlyBanner } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { pagesApi, factCollectionsApi } from '@/lib/api';
import { writeCatalogImportDraft } from '@/lib/catalogImportDraft';
import { useDebounce } from '@/hooks/useDebounce';
import { useWorkspaceRole } from '@/hooks';
import { captureError } from '@/lib/sentryHelpers';
import { detectCatalogLikePatterns } from '@jawab24/shared';
import type { PageDetail } from '@jawab24/shared';
import type { KnowledgeSection, SectionId, CustomSectionId, KbGap, KbWarnings, SaveKbOutcome } from './types';
import { isCustomSection, MAX_CUSTOM_SECTIONS } from './types';
import { parseKnowledgeBase, serializeSections, getTotalCharCount } from './knowledgeBaseParser';
import { KnowledgeBaseSections } from './KnowledgeBaseSections';
import { KnowledgeBaseRawEditor } from './KnowledgeBaseRawEditor';
import { GapCard } from './GapCard';

const MAX_LENGTH = 16000;

interface KnowledgeBasePanelProps {
  page: PageDetail;
  onSave: (knowledgeBase: string) => Promise<SaveKbOutcome | undefined | void>;
  saving: boolean;
  saved: boolean;
  /** Rendered as a Cancel button in the footer when provided (modal host). */
  onClose?: () => void;
  /**
   * Called with the import-sheet URL when the merchant accepts the
   * catalog-detection CTA. The host decides how to navigate (the modal closes
   * itself first; the /business page can navigate in place). Defaults to a
   * plain router.push.
   */
  onImportNavigate?: (url: string) => void;
  /** Class for the scrollable body wrapper — hosts pass their own layout classes. */
  bodyClassName?: string;
  /** Class for the footer bar wrapper. */
  footerClassName?: string;
}

/**
 * The Business Info (knowledge base) editor — sections/raw editing, gap cards,
 * catalog-detection warning, and the save footer — with no modal chrome.
 * Extracted from KnowledgeBaseModal (B1) so the same editor can live inline on
 * /business while the modal remains a thin wrapper for conversation deep-links.
 *
 * Permissions: Business Info follows the SAME rule as the rest of /pages and
 * /settings — everyone in the workspace reads it, only owner/admin (مشرف) may
 * write. Every write path here (`PUT /pages/:id`, `POST /pages/:id/kb-gaps/
 * :gapId/dismiss`) is `requireRole('admin')` server-side, so this component is
 * the single UI choke point that keeps the editor honest about it: it serves
 * ALL four entry points (the /pages screen, /business, and the comment and
 * message detail modals via InlineKbEditorModal). Gating here rather than in
 * each host is what makes it impossible for a new host to reintroduce the
 * type-then-403 dead end.
 */
export function KnowledgeBasePanel({
  page,
  onSave,
  saving,
  saved,
  onClose,
  onImportNavigate,
  bodyClassName = 'flex-1 min-h-0 p-3 landscape:p-3 landscape:pt-2 sm:p-5 overflow-y-auto overscroll-contain relative',
  footerClassName = 'flex-shrink-0 flex items-center justify-between gap-3 landscape:gap-2 px-4 py-3 pb-safe-modal lg:pb-4 landscape:py-2 lg:px-5 border-t border-theme-border bg-card',
}: KnowledgeBasePanelProps) {
  const tKb = useTranslations('kb');
  const tc = useTranslations('common');
  const tPages = useTranslations('pages');
  const router = useRouter();
  // Workspace role gate: `member` (عضو) gets a read-only editor, owner/admin
  // (مشرف) get the full one. Same `canEdit` flag Settings and Integrations
  // already use, so all three surfaces answer "who may change this?" identically.
  const { canEdit } = useWorkspaceRole();
  // GA for all merchants (2026-08-15; the catalog endpoints stay admin-gated
  // server-side). Store-linked pages keep the pre-import banner shape.
  const canImportToCatalog = !page.ecommerceStoreId;
  // The CTA is a WRITE (it saves the KB before handing off to the import
  // sheet), so it needs the role on top of the canary. Deliberately NOT folded
  // into canImportToCatalog: that flag also drives the collections probe and
  // `hasAlternativeHome`, which describe the WORKSPACE's price home and must
  // read the same for a member as for an admin. Only the button and the copy
  // that promises it move.
  const showCatalogCta = canImportToCatalog && canEdit;

  const [sections, setSections] = useState<KnowledgeSection[]>([]);
  const [expandedId, setExpandedId] = useState<SectionId | null>(null);
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState('');
  const [showFacebookBanner, setShowFacebookBanner] = useState(false);
  const [gaps, setGaps] = useState<KbGap[]>([]);
  const [expandedGapId, setExpandedGapId] = useState<string | null>(null);
  const [kbWarnings, setKbWarnings] = useState<KbWarnings | null>(null);
  // Live price-notice dismissal — per editing session, reset on page switch.
  const [liveNoticeDismissed, setLiveNoticeDismissed] = useState(false);

  // Initialize from page data
  useEffect(() => {
    const text = page.knowledgeBase || '';
    const suggested = page.suggestedKnowledgeBase || '';

    let parsed: KnowledgeSection[];
    if (text) {
      parsed = parseKnowledgeBase(text);
      setRawText(text);
    } else if (suggested) {
      parsed = parseKnowledgeBase(suggested);
      setRawText(suggested);
      setShowFacebookBanner(true);
    } else {
      parsed = parseKnowledgeBase('');
      setRawText('');
    }

    setSections(parsed);
    // Auto-expand first empty section
    const firstEmpty = parsed.find((s) => !s.content.trim());
    setExpandedId(firstEmpty?.id || null);
  }, [page]);

  // Reset the live-notice dismissal only when the merchant switches PAGES —
  // keyed on page.id, NOT the page object: every save refetches the pages
  // query and mints a new object, and a dismissed notice must not resurrect
  // just because the merchant saved.
  useEffect(() => {
    setLiveNoticeDismissed(false);
  }, [page.id]);

  // Fetch KB gaps for this page
  useEffect(() => {
    pagesApi.getKbGaps(page.id)
      .then((res) => setGaps(res.data?.data || []))
      .catch(() => { /* non-critical, silently ignore */ });
  }, [page.id]);

  // Live catalog-pattern detection — the same shared detector the backend runs
  // on save (`kbWarnings`), applied while typing so the merchant hears "exact
  // prices live in your lists" BEFORE saving, not after. Debounced: detection
  // is cheap regex work, but there is no reason to run it per keystroke.
  const currentText = useMemo(
    () => (rawMode ? rawText : serializeSections(sections)),
    [rawMode, rawText, sections],
  );
  const debouncedText = useDebounce(currentText, 400);
  const liveDetection = useMemo(() => detectCatalogLikePatterns(debouncedText), [debouncedText]);

  // "Does this merchant have a structured home for prices?" — catalog import
  // (canary-gated) or existing fact collections. The collections probe only
  // fires when detection is live AND the catalog path is closed, so ordinary
  // editing adds zero requests; on /business the query key is shared with
  // BusinessListsSection, so it is served from the React Query cache anyway.
  const { data: listCollections, isError: probeFailed, error: probeError } = useQuery({
    queryKey: ['fact-collections', page.id],
    queryFn: () => factCollectionsApi.list(page.id).then((r) => r.data.data),
    enabled: liveDetection.hasCatalog && !canImportToCatalog,
    staleTime: 60_000,
  });
  // A failed probe degrades gracefully (the merchant falls back to the
  // post-save banner) but must not degrade INVISIBLY: a persistent failure
  // means lists merchants never see the live notice, and nothing else would
  // report it. Same tag as BusinessListsSection's load of this query.
  useEffect(() => {
    if (probeFailed) {
      captureError(probeError, 'Fact-collections probe for the live KB notice failed', {
        tags: { action: 'load-fact-collections' },
        extra: { pageId: page.id },
      });
    }
  }, [probeFailed, probeError, page.id]);
  const listsExist = (listCollections?.length ?? 0) > 0;
  const hasAlternativeHome = canImportToCatalog || listsExist;

  // Owner ruling (2026-08-03): the live notice shows ONLY when the merchant
  // has somewhere better to put the prices. Everyone else keeps the existing
  // post-save "coming soon" banner untouched.
  // Never for a member: the notice asks the reader to MOVE the prices, which is
  // a write they cannot make. (The post-save `kbWarnings` variant is already
  // unreachable for them — it is only set by a successful save.)
  const showLiveNotice = canEdit && liveDetection.hasCatalog && hasAlternativeHome && !liveNoticeDismissed;

  // One banner slot, one owner. A save that lands before the debounce or the
  // collections probe resolves sees hasAlternativeHome=false and sets the
  // post-save state; once live territory is established the stale post-save
  // state must go, or it shows the misleading «coming soon» copy — and shadows
  // the live notice's dismiss button (banner surviving its own dismiss).
  useEffect(() => {
    if (liveDetection.hasCatalog && hasAlternativeHome) {
      setKbWarnings(null);
    }
  }, [liveDetection.hasCatalog, hasAlternativeHome]);

  // Handle section content change
  const handleSectionChange = useCallback((sectionId: SectionId, content: string) => {
    setSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, content } : s))
    );
  }, []);

  // Add a new custom section
  const handleAddCustomSection = useCallback(() => {
    const customCount = sections.filter((s) => isCustomSection(s.id)).length;
    if (customCount >= MAX_CUSTOM_SECTIONS) return;

    const newId = `custom:${Date.now()}` as CustomSectionId;
    const defaultTitle = tKb('defaultSectionTitle');

    setSections((prev) => [...prev, { id: newId, content: '', title: defaultTitle }]);
    setExpandedId(newId);
  }, [sections, tKb]);

  // Delete a custom section
  const handleDeleteCustomSection = useCallback((sectionId: CustomSectionId) => {
    setSections((prev) => prev.filter((s) => s.id !== sectionId));
    setExpandedId((prev) => (prev === sectionId ? null : prev));
  }, []);

  // Rename a custom section
  const handleCustomTitleChange = useCallback((sectionId: CustomSectionId, title: string) => {
    setSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, title } : s))
    );
  }, []);

  // Toggle raw mode
  const toggleRawMode = useCallback(() => {
    if (rawMode) {
      // Switching back to structured: re-parse raw text
      const parsed = parseKnowledgeBase(rawText);
      setSections(parsed);
      const firstEmpty = parsed.find((s) => !s.content.trim());
      setExpandedId(firstEmpty?.id || null);
    } else {
      // Switching to raw: serialize current sections
      setRawText(serializeSections(sections));
    }
    setRawMode((prev) => !prev);
  }, [rawMode, rawText, sections]);

  // Save handler — captures any catalog-detection warnings returned by the
  // backend so the inline banner can prompt the merchant to restructure.
  // When the merchant has a structured home (live notice territory) the
  // post-save banner is suppressed: the live notice already said it, and
  // resurrecting a dismissed notice with the older "coming soon" copy would
  // both nag and mislead.
  const handleSave = useCallback(async () => {
    setKbWarnings(null);
    const result = await onSave(currentText);
    if (result && result.ok && result.kbWarnings?.hasCatalog && !hasAlternativeHome) {
      setKbWarnings(result.kbWarnings);
    }
  }, [currentText, onSave, hasAlternativeHome]);

  // Warning-banner CTA: persist the editor text FIRST, then hand it to the
  // import sheet via the sessionStorage draft (a 16k paste doesn't fit in a
  // query param). The save is not optional: the live notice lets this CTA
  // fire mid-edit, the handoff closes the editor, and the post-import cleanup
  // sheet matches lines against the SAVED KB — skipping the save would
  // silently discard everything typed since the last save.
  const handleMoveToCatalog = useCallback(async () => {
    const result = await onSave(currentText);
    // Save failed (the host already toasted): stay in the editor with the
    // text intact rather than handing off work that was never persisted.
    if (result && !result.ok) return;
    writeCatalogImportDraft({ pageId: page.id, text: currentText });
    const url = `/business?page=${page.id}&import=1`;
    if (onImportNavigate) {
      onImportNavigate(url);
    } else {
      router.push(url);
    }
  }, [currentText, onSave, page.id, onImportNavigate, router]);

  // Gap approved: append Q&A to "notes" section
  const handleGapApproved = useCallback((gapId: string, answer: string) => {
    const gap = gaps.find(g => g.id === gapId);
    if (!gap) return;

    setSections(prev => prev.map(s => {
      if (s.id !== 'notes') return s;
      const entry = `Q: ${gap.queryText}\nA: ${answer}`;
      const newContent = s.content.trim()
        ? `${s.content.trim()}\n\n${entry}`
        : entry;
      return { ...s, content: newContent };
    }));

    setGaps(prev => prev.filter(g => g.id !== gapId));
    setExpandedGapId(null);
    pagesApi.dismissGap(page.id, gapId).catch(() => {});
    toast.success(tKb('gaps.addedHint'));
  }, [gaps, page.id, tKb]);

  // Gap skipped: resolve without adding content
  const handleGapSkipped = useCallback((gapId: string) => {
    setGaps(prev => prev.filter(g => g.id !== gapId));
    setExpandedGapId(null);
    pagesApi.dismissGap(page.id, gapId).catch(() => {});
  }, [page.id]);

  const totalChars = useMemo(
    () => rawMode ? rawText.length : getTotalCharCount(sections),
    [rawMode, rawText, sections],
  );
  const isOverLimit = totalChars > MAX_LENGTH;
  const isNearLimit = totalChars > MAX_LENGTH * 0.9;

  return (
    <>
      <div className={bodyClassName}>
        {/* Description — what the free text is FOR, with an InfoPopover for the
            fuller role split. The structured-home sentence only renders for
            merchants who actually have one (owner ruling 2026-08-03). */}
        <div className="flex items-start gap-1.5 mb-2 landscape:hidden">
          <p className="text-xs sm:text-sm text-surface-500 text-start">
            {tKb('description')}
            {hasAlternativeHome && (
              <> {tKb('descriptionStructuredHint')}</>
            )}
          </p>
          <InfoPopover label={tKb('freeTextInfo.title')} panelWidth="md">
            <div className="space-y-1.5 text-start">
              <p className="font-medium">{tKb('freeTextInfo.title')}</p>
              <p>{tKb('freeTextInfo.what')}</p>
              {hasAlternativeHome && <p>{tKb('freeTextInfo.structured')}</p>}
              <p>{tKb('freeTextInfo.why')}</p>
            </div>
          </InfoPopover>
        </div>

        {/* View-only banner for members — the shared component Settings and the
            /business sections use, so "who may change this?" reads identically
            app-wide and a reword lands everywhere at once. */}
        {!canEdit && <ViewOnlyBanner />}

        {/* Facebook import banner */}
        {showFacebookBanner && (
          <div className="flex items-center gap-2 p-3 mb-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-800/40">
            <span className="text-blue-600 text-xs font-medium">
              {tKb('importedFromFacebook')}
            </span>
            <button
              onClick={() => setShowFacebookBanner(false)}
              aria-label={tc('close')}
              className="ms-auto min-h-[44px] min-w-[44px] -m-2 flex items-center justify-center text-blue-400 hover:text-blue-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Unanswered questions — interactive gap cards. A member sees the
            QUESTIONS but not the actions (approve edits the KB, skip POSTs the
            dismiss — both admin-gated): what a customer asked and nobody could
            answer is workspace information, and the member working the inbox is
            often the one who knows the answer. Only the "tap to answer"
            instruction changes. */}
        {gaps.length > 0 && (
          <div className="mb-3 space-y-2">
            <div className="flex items-center gap-2 px-1">
              <MessageCircleQuestion className="w-4 h-4 text-amber-600 flex-shrink-0" aria-hidden="true" />
              <span className="text-xs font-semibold text-amber-800">
                {tKb('gaps.title')} ({gaps.length})
              </span>
            </div>
            <p className="text-xs text-amber-700 px-1">{tKb(canEdit ? 'gaps.hint' : 'gaps.hintViewOnly')}</p>
            {gaps.map((gap) => (
              <GapCard
                key={gap.id}
                gap={gap}
                isExpanded={expandedGapId === gap.id}
                onToggle={() => setExpandedGapId(prev => prev === gap.id ? null : gap.id)}
                onApprove={(answer) => handleGapApproved(gap.id, answer)}
                onSkip={() => handleGapSkipped(gap.id)}
                readOnly={!canEdit}
              />
            ))}
          </div>
        )}

        {/* Thin-KB tip — show when total content is under 100 chars. Not for a
            member: "add more detail" is advice for whoever can add it. */}
        {canEdit && !rawMode && totalChars < 100 && (
          <div className="flex items-start gap-2.5 p-3 mb-3 rounded-xl alert-warning border">
            <Lightbulb className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs leading-relaxed">
              {tKb('thinKbTip')}
            </p>
          </div>
        )}

        {/* Catalog-detection notice. Two variants, one slot:
            - LIVE (pre-save, while typing) — only for merchants with a
              structured home for prices (catalog import or existing lists);
              present-tense copy, CTA when the import path is open.
            - POST-SAVE — the pre-existing backend `kbWarnings` banner, kept
              unchanged for merchants without an alternative ("coming soon").
            Non-blocking in both shapes; dismiss keeps the current text. */}
        {(showLiveNotice || (kbWarnings && kbWarnings.hasCatalog)) && (
          <div className="flex items-start gap-2.5 p-3 mb-3 rounded-xl alert-warning border" role="status" aria-live="polite">
            <Lightbulb className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 text-xs leading-relaxed">
              <p className="font-medium mb-1">
                {tKb('catalogWarning.priceListTitle')}
              </p>
              <p>
                {showLiveNotice
                  ? tKb(showCatalogCta ? 'catalogWarning.liveBodyWithCta' : 'catalogWarning.liveBody', {
                      priceCount: liveDetection.priceCount,
                    })
                  : tKb('catalogWarning.body', { priceCount: kbWarnings?.priceCount ?? 0 })}
              </p>
              {showLiveNotice && showCatalogCta && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleMoveToCatalog}
                  disabled={saving}
                  className="mt-2"
                >
                  <ClipboardPaste className="w-3.5 h-3.5 me-1.5" aria-hidden="true" />
                  {tKb('catalogWarning.cta')}
                </Button>
              )}
            </div>
            <button
              type="button"
              // One click dismisses the SLOT: clearing only the visible
              // variant would let the other one un-shadow behind it.
              onClick={() => { setLiveNoticeDismissed(true); setKbWarnings(null); }}
              className="flex-shrink-0 p-1 -m-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40"
              aria-label={tc('dismiss')}
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Content: sections or raw editor */}
        {rawMode ? (
          <KnowledgeBaseRawEditor
            value={rawText}
            onChange={setRawText}
            maxLength={MAX_LENGTH}
            ariaLabel={tKb('title')}
            onPasteTruncated={({ kept }) => toast.warning(tKb('pasteTruncated', { kept }))}
            readOnly={!canEdit}
          />
        ) : (
          <KnowledgeBaseSections
            sections={sections}
            expandedId={expandedId}
            onExpandedChange={setExpandedId}
            onSectionChange={handleSectionChange}
            onAddCustomSection={handleAddCustomSection}
            onDeleteCustomSection={handleDeleteCustomSection}
            onCustomTitleChange={handleCustomTitleChange}
            remainingChars={MAX_LENGTH - totalChars}
            readOnly={!canEdit}
          />
        )}
      </div>

      {/* Footer — hosts place this below the scrollable body */}
      <div className={footerClassName}>
        {/* Raw mode toggle */}
        <button
          type="button"
          onClick={toggleRawMode}
          className="flex items-center gap-1.5 text-xs font-medium text-surface-500 hover:text-surface-700 transition-colors"
        >
          {rawMode ? (
            <>
              <Eye className="w-3.5 h-3.5" />
              {tKb('hideRawText')}
            </>
          ) : (
            <>
              <FileText className="w-3.5 h-3.5" />
              {tKb('showRawText')}
            </>
          )}
        </button>

        <div className="flex items-center gap-3 landscape:gap-2">
          {totalChars > 0 && (
            <div className="flex items-center gap-2">
              {isOverLimit && (
                <span className="text-xs font-medium text-red-500 max-sm:hidden" role="alert">
                  {tKb('overLimit', { excess: (totalChars - MAX_LENGTH).toLocaleString() })}
                </span>
              )}
              <span className={`text-xs font-medium tabular-nums ${
                isOverLimit ? 'text-red-500' : isNearLimit ? 'text-amber-500' : 'text-muted-foreground'
              }`}>
                {totalChars.toLocaleString()}/{MAX_LENGTH.toLocaleString()}
              </span>
            </div>
          )}
          {onClose && (
            // View-only makes this the ONLY way out of the modal, so it stops
            // being the secondary action and stops hiding on small screens.
            <Button
              variant={canEdit ? 'secondary' : 'primary'}
              size="sm"
              onClick={onClose}
              className={canEdit ? 'max-sm:hidden' : undefined}
            >
              {canEdit ? tc('cancel') : tc('close')}
            </Button>
          )}
          {canEdit && (
            <Button
              size="sm"
              onClick={handleSave}
              loading={saving}
              disabled={isOverLimit}
              icon={saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              variant={saved ? 'secondary' : 'primary'}
              className="max-sm:h-10 max-sm:px-6"
            >
              {saved ? tPages('savedStatus') : tc('save')}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
