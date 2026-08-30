import React, { useCallback } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { KnowledgeSection, SectionId, CustomSectionId } from './types';
import { SECTION_CONFIGS, MAX_CUSTOM_SECTIONS, isCustomSection } from './types';
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
  /** View-only (workspace `member`) — see SectionEditor. */
  readOnly?: boolean;
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
  readOnly = false,
}: KnowledgeBaseSectionsProps) {
  const tKb = useTranslations('kb');

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
      {/* No progress bar here. The page's readiness ring is the one score;
          «N of M sections filled» was a second scoreboard for the overflow box,
          and filling every free-text section is not a goal (Business Info
          clarity, 2026-08-29). */}

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
                readOnly={readOnly}
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
              readOnly={readOnly}
            />
          </div>
        );
      })}

      {/* Add custom section button */}
      {!readOnly && customCount < MAX_CUSTOM_SECTIONS && (
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
