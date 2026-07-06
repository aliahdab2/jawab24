import React, { useCallback } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { KnowledgeSection, SectionId, CustomSectionId } from './types';
import { SECTION_CONFIGS, MAX_CUSTOM_SECTIONS, isCustomSection } from './types';
import { calculateProgress } from './knowledgeBaseParser';
import { KnowledgeBaseSection } from './KnowledgeBaseSection';
import { KnowledgeBaseCustomSection } from './KnowledgeBaseCustomSection';

interface KnowledgeBaseSectionsProps {
  sections: KnowledgeSection[];
  expandedId: SectionId | null;
  onExpandedChange: (id: SectionId | null) => void;
  onSectionChange: (sectionId: SectionId, content: string) => void;
  onAddCustomSection: () => void;
  onDeleteCustomSection: (sectionId: CustomSectionId) => void;
  onCustomTitleChange: (sectionId: CustomSectionId, title: string) => void;
  remainingChars: number;
}

export function KnowledgeBaseSections({
  sections,
  expandedId,
  onExpandedChange,
  onSectionChange,
  onAddCustomSection,
  onDeleteCustomSection,
  onCustomTitleChange,
  remainingChars,
}: KnowledgeBaseSectionsProps) {
  const tKb = useTranslations('kb');
  const { filled, total } = calculateProgress(sections);

  // Click-to-focus is event-driven: when the user explicitly toggles a
  // section open, focus its textarea to skip the extra tap. We do NOT focus
  // as a side-effect of `isExpanded` changing in SectionEditor — that fires
  // on the modal's initial-mount auto-expand too and would pop the soft
  // keyboard before the user has interacted with anything.
  // Memoized so children stay referentially stable across renders and can
  // skip re-rendering when only an unrelated section's content changes.
  const handleToggle = useCallback((id: SectionId) => {
    const willExpand = expandedId !== id;
    onExpandedChange(willExpand ? id : null);
    if (willExpand) {
      requestAnimationFrame(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          `[data-section-id="${CSS.escape(String(id))}"] textarea`
        );
        textarea?.focus({ preventScroll: true });
      });
    }
  }, [expandedId, onExpandedChange]);

  const customCount = sections.filter((s) => isCustomSection(s.id)).length;

  return (
    <div className="flex flex-col gap-2">
      {/* Progress indicator */}
      <div className="flex items-center gap-3 px-1 mb-1">
        <div className="flex-1 flex gap-1">
          {sections.map((s) => (
            <div
              key={s.id}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                s.content.trim() ? 'bg-brand-500' : 'bg-surface-200'
              }`}
            />
          ))}
        </div>
        <span className="text-xs font-medium text-surface-500 flex-shrink-0">
          {filled === total
            ? tKb('progressComplete')
            : tKb('progress', { filled, total })}
        </span>
      </div>

      {/* Section cards. The data-section-id wrapper is what handleToggle's
          focus query looks up — keep it in sync with the SectionId used in
          state.
          Callbacks are passed straight through (memoized in parents) and
          children bind the section id internally so React.memo can skip
          re-renders of sibling cards while typing. remainingChars is gated
          on isExpanded for the same reason — only the open card consumes
          it (file/voice insert) and the global budget changes every
          keystroke. */}
      {sections.map((section) => {
        const isExpanded = expandedId === section.id;
        const sectionRemaining = isExpanded ? remainingChars : undefined;

        if (isCustomSection(section.id)) {
          return (
            <div key={section.id} data-section-id={section.id}>
              <KnowledgeBaseCustomSection
                section={section}
                isExpanded={isExpanded}
                onToggle={handleToggle}
                onChange={onSectionChange}
                onTitleChange={onCustomTitleChange}
                onDelete={onDeleteCustomSection}
                remainingChars={sectionRemaining}
              />
            </div>
          );
        }

        const config = SECTION_CONFIGS.find((c) => c.id === section.id);
        if (!config) return null;
        return (
          <div key={section.id} data-section-id={section.id}>
            <KnowledgeBaseSection
              section={section}
              config={config}
              isExpanded={isExpanded}
              onToggle={handleToggle}
              onChange={onSectionChange}
              remainingChars={sectionRemaining}
            />
          </div>
        );
      })}

      {/* Add custom section button */}
      {customCount < MAX_CUSTOM_SECTIONS && (
        <button
          type="button"
          onClick={onAddCustomSection}
          className="flex items-center justify-center gap-2 p-3.5 rounded-2xl border-2 border-dashed border-surface-200 text-muted-foreground hover:border-brand-300 hover:text-brand-500 hover:bg-brand-50/10 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span className="text-sm font-medium">
            {tKb('addCustomSection')}
          </span>
        </button>
      )}
    </div>
  );
}
