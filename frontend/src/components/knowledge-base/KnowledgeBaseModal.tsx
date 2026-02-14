import React, { useState, useEffect, useCallback } from 'react';
import { BookOpen, X, Save, Check, FileText, Eye } from 'lucide-react';
import { Button } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import type { Page } from '@jawab24/shared';
import type { KnowledgeSection, SectionId, CustomSectionId } from './types';
import { isCustomSection, MAX_CUSTOM_SECTIONS } from './types';
import { parseKnowledgeBase, serializeSections } from './knowledgeBaseParser';
import { KnowledgeBaseSections } from './KnowledgeBaseSections';
import { KnowledgeBaseRawEditor } from './KnowledgeBaseRawEditor';

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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 landscape:items-center sm:p-4 landscape:p-2">
      <div
        className="bg-white rounded-t-3xl sm:rounded-2xl landscape:rounded-2xl shadow-xl w-full sm:max-w-2xl landscape:max-w-3xl h-[85vh] landscape:h-[90vh] sm:h-auto sm:max-h-[85vh] flex flex-col overflow-hidden"
        style={{ paddingBottom: '8px' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 landscape:py-2 sm:p-5 border-b border-surface-100 flex-shrink-0">
          <div className="flex items-center gap-3 landscape:gap-2">
            <div className="w-9 h-9 landscape:w-8 landscape:h-8 sm:w-10 sm:h-10 rounded-xl bg-brand-100 flex items-center justify-center">
              <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 text-brand-600" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-surface-900">
                {t('kb.title' as TranslationKey)}
              </h2>
              <p className="text-xs sm:text-sm text-surface-500 landscape:hidden">{page.name}</p>
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
            <div className="flex items-center gap-2 p-3 mb-3 rounded-xl bg-blue-50 border border-blue-100">
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

          {/* Content: sections or raw editor */}
          {rawMode ? (
            <KnowledgeBaseRawEditor
              value={rawText}
              onChange={setRawText}
              maxLength={MAX_LENGTH}
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
        <div className="flex items-center justify-between gap-3 landscape:gap-2 px-4 py-3 landscape:py-2 sm:p-5 border-t border-surface-100 flex-shrink-0 bg-surface-50">
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
