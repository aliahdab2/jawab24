import React, { useState, useEffect, useCallback } from 'react';
import { BookOpen, X, Save, Check, FileText, Eye, MessageCircleQuestion } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { pagesApi } from '@/lib/api';
import type { Page } from '@jawab24/shared';
import type { KnowledgeSection, SectionId, CustomSectionId, KbGap } from './types';
import { isCustomSection, MAX_CUSTOM_SECTIONS } from './types';
import { parseKnowledgeBase, serializeSections } from './knowledgeBaseParser';
import { KnowledgeBaseSections } from './KnowledgeBaseSections';
import { KnowledgeBaseRawEditor } from './KnowledgeBaseRawEditor';
import { GapCard } from './GapCard';

const MAX_LENGTH = 10000;

interface KnowledgeBaseModalProps {
  page: Page;
  onClose: () => void;
  onSave: (knowledgeBase: string) => Promise<void>;
  saving: boolean;
  saved: boolean;
}

export function KnowledgeBaseModal({ page, onClose, onSave, saving, saved }: KnowledgeBaseModalProps) {
  const { t } = useTranslation();

  const [sections, setSections] = useState<KnowledgeSection[]>([]);
  const [expandedId, setExpandedId] = useState<SectionId | null>(null);
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState('');
  const [showFacebookBanner, setShowFacebookBanner] = useState(false);
  const [gaps, setGaps] = useState<KbGap[]>([]);
  const [expandedGapId, setExpandedGapId] = useState<string | null>(null);

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

  // ESC to close
  useEscapeKey(onClose, true);

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
    const defaultTitle = t('kb.defaultSectionTitle');

    setSections((prev) => [...prev, { id: newId, content: '', title: defaultTitle }]);
    setExpandedId(newId);
  }, [sections, t]);

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

  // Save handler
  const handleSave = useCallback(() => {
    const text = rawMode ? rawText : serializeSections(sections);
    onSave(text);
  }, [rawMode, rawText, sections, onSave]);

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
    toast.success(t('kb.gaps.addedHint' as TranslationKey));
  }, [gaps, page.id, t]);

  // Gap skipped: resolve without adding content
  const handleGapSkipped = useCallback((gapId: string) => {
    setGaps(prev => prev.filter(g => g.id !== gapId));
    setExpandedGapId(null);
    pagesApi.dismissGap(page.id, gapId).catch(() => {});
  }, [page.id]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 landscape:items-center sm:p-4 landscape:p-2">
      <div
        className="bg-card rounded-t-3xl sm:rounded-2xl landscape:rounded-2xl shadow-xl w-full sm:max-w-2xl landscape:max-w-3xl h-[85vh] landscape:h-[90vh] sm:h-auto sm:max-h-[85vh] flex flex-col overflow-hidden pt-safe sm:pt-0"
        style={{ paddingBottom: '8px' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 landscape:py-2 sm:p-5 border-b border-theme-border flex-shrink-0">
          <div className="flex items-center gap-3 landscape:gap-2">
            <div className="w-9 h-9 landscape:w-8 landscape:h-8 sm:w-10 sm:h-10 rounded-xl icon-bg-brand flex items-center justify-center">
              <BookOpen className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-foreground">
                {t('kb.title' as TranslationKey)}
              </h2>
              <p className="text-xs sm:text-sm text-muted-foreground landscape:hidden">{page.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-100 text-surface-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col min-h-0 p-4 landscape:p-3 landscape:pt-2 sm:p-5 overflow-y-auto">
          {/* Description */}
          <p className="text-xs sm:text-sm text-surface-500 mb-3 text-start landscape:hidden">
            {t('kb.description' as TranslationKey)}
          </p>

          {/* Facebook import banner */}
          {showFacebookBanner && (
            <div className="flex items-center gap-2 p-3 mb-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-800/40">
              <span className="text-blue-600 text-xs font-medium">
                {t('kb.importedFromFacebook' as TranslationKey)}
              </span>
              <button
                onClick={() => setShowFacebookBanner(false)}
                className="ms-auto text-blue-400 hover:text-blue-600"
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
                  {t('kb.gaps.title' as TranslationKey)} ({gaps.length})
                </span>
              </div>
              <p className="text-xs text-amber-700 px-1">{t('kb.gaps.hint' as TranslationKey)}</p>
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

          {/* Content: sections or raw editor */}
          {rawMode ? (
            <KnowledgeBaseRawEditor
              value={rawText}
              onChange={setRawText}
              maxLength={MAX_LENGTH}
              ariaLabel={t('kb.title')}
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
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 landscape:gap-2 px-4 py-3 landscape:py-2 sm:p-5 border-t border-theme-border flex-shrink-0 bg-surface-50">
          {/* Raw mode toggle */}
          <button
            type="button"
            onClick={toggleRawMode}
            className="flex items-center gap-1.5 text-xs font-medium text-surface-500 hover:text-surface-700 transition-colors"
          >
            {rawMode ? (
              <>
                <Eye className="w-3.5 h-3.5" />
                {t('kb.hideRawText' as TranslationKey)}
              </>
            ) : (
              <>
                <FileText className="w-3.5 h-3.5" />
                {t('kb.showRawText' as TranslationKey)}
              </>
            )}
          </button>

          <div className="flex items-center gap-3 landscape:gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              loading={saving}
              icon={saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              variant={saved ? 'secondary' : 'primary'}
            >
              {saved ? t('pages.savedStatus') : t('common.save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
