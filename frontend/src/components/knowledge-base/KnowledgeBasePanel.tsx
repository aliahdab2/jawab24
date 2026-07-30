import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { X, Save, Check, FileText, Eye, MessageCircleQuestion, Lightbulb, ClipboardPaste } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { pagesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { isCatalogVisible } from '@/lib/featureFlags';
import { writeCatalogImportDraft } from '@/lib/catalogImportDraft';
import type { Page } from '@jawab24/shared';
import type { KnowledgeSection, SectionId, CustomSectionId, KbGap, KbWarnings } from './types';
import { isCustomSection, MAX_CUSTOM_SECTIONS } from './types';
import { parseKnowledgeBase, serializeSections, getTotalCharCount } from './knowledgeBaseParser';
import { KnowledgeBaseSections } from './KnowledgeBaseSections';
import { KnowledgeBaseRawEditor } from './KnowledgeBaseRawEditor';
import { GapCard } from './GapCard';

const MAX_LENGTH = 16000;

interface KnowledgeBasePanelProps {
  page: Page;
  onSave: (knowledgeBase: string) => Promise<KbWarnings | undefined | void>;
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
  const { user } = useAuthStore();
  // Catalog canary gate (cosmetic — the catalog endpoints stay admin-gated
  // server-side). Outside the allowlist the banner keeps its pre-import shape.
  const canImportToCatalog = isCatalogVisible(user) && !page.ecommerceStoreId;

  const [sections, setSections] = useState<KnowledgeSection[]>([]);
  const [expandedId, setExpandedId] = useState<SectionId | null>(null);
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState('');
  const [showFacebookBanner, setShowFacebookBanner] = useState(false);
  const [gaps, setGaps] = useState<KbGap[]>([]);
  const [expandedGapId, setExpandedGapId] = useState<string | null>(null);
  const [kbWarnings, setKbWarnings] = useState<KbWarnings | null>(null);

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

  // Fetch KB gaps for this page
  useEffect(() => {
    pagesApi.getKbGaps(page.id)
      .then((res) => setGaps(res.data?.data || []))
      .catch(() => { /* non-critical, silently ignore */ });
  }, [page.id]);

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
  const handleSave = useCallback(async () => {
    const text = rawMode ? rawText : serializeSections(sections);
    setKbWarnings(null);
    const result = await onSave(text);
    if (result && typeof result === 'object' && 'hasCatalog' in result && result.hasCatalog) {
      setKbWarnings(result);
    }
  }, [rawMode, rawText, sections, onSave]);

  // Warning-banner CTA: hand the CURRENT text (the banner only shows post-save,
  // so it equals the saved KB) to the import sheet via the sessionStorage
  // draft — a 16k paste doesn't fit in a query param.
  const handleMoveToCatalog = useCallback(() => {
    const text = rawMode ? rawText : serializeSections(sections);
    writeCatalogImportDraft({ pageId: page.id, text });
    const url = `/business?page=${page.id}&import=1`;
    if (onImportNavigate) {
      onImportNavigate(url);
    } else {
      router.push(url);
    }
  }, [rawMode, rawText, sections, page.id, onImportNavigate, router]);

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
        {/* Description */}
        <p className="text-xs sm:text-sm text-surface-500 mb-2 text-start landscape:hidden">
          {tKb('description')}
        </p>

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

        {/* Unanswered questions — interactive gap cards */}
        {gaps.length > 0 && (
          <div className="mb-3 space-y-2">
            <div className="flex items-center gap-2 px-1">
              <MessageCircleQuestion className="w-4 h-4 text-amber-600 flex-shrink-0" aria-hidden="true" />
              <span className="text-xs font-semibold text-amber-800">
                {tKb('gaps.title')} ({gaps.length})
              </span>
            </div>
            <p className="text-xs text-amber-700 px-1">{tKb('gaps.hint')}</p>
            {gaps.map((gap) => (
              <GapCard
                key={gap.id}
                gap={gap}
                isExpanded={expandedGapId === gap.id}
                onToggle={() => setExpandedGapId(prev => prev === gap.id ? null : gap.id)}
                onApprove={(answer) => handleGapApproved(gap.id, answer)}
                onSkip={() => handleGapSkipped(gap.id)}
              />
            ))}
          </div>
        )}

        {/* Thin-KB tip — show when total content is under 100 chars */}
        {!rawMode && totalChars < 100 && (
          <div className="flex items-start gap-2.5 p-3 mb-3 rounded-xl alert-warning border">
            <Lightbulb className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs leading-relaxed">
              {tKb('thinKbTip')}
            </p>
          </div>
        )}

        {/* Catalog-detection warning — appears after save when raw KB looks
            like a price list or course catalog. Non-blocking; merchant can
            dismiss and keep the current text. */}
        {kbWarnings && kbWarnings.hasCatalog && (
          <div className="flex items-start gap-2.5 p-3 mb-3 rounded-xl alert-warning border" role="status" aria-live="polite">
            <Lightbulb className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 text-xs leading-relaxed">
              <p className="font-medium mb-1">
                {kbWarnings.reasons.includes('course_catalog')
                  ? tKb('catalogWarning.courseCatalogTitle')
                  : tKb('catalogWarning.priceListTitle')}
              </p>
              <p>
                {tKb(canImportToCatalog ? 'catalogWarning.bodyWithCta' : 'catalogWarning.body', {
                  priceCount: kbWarnings.priceCount,
                })}
              </p>
              {canImportToCatalog && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleMoveToCatalog}
                  className="mt-2"
                >
                  <ClipboardPaste className="w-3.5 h-3.5 me-1.5" aria-hidden="true" />
                  {tKb('catalogWarning.cta')}
                </Button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setKbWarnings(null)}
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
            <Button variant="secondary" size="sm" onClick={onClose} className="max-sm:hidden">
              {tc('cancel')}
            </Button>
          )}
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
        </div>
      </div>
    </>
  );
}
