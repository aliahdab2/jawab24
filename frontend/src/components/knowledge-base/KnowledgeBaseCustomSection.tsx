import React, { useRef, useEffect, useState, useCallback, memo } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ConfirmationModal } from '@/components/ui';
import { CUSTOM_SECTION_MARKER } from './types';
import type { KnowledgeSection, CustomSectionId } from './types';
import { CollapsibleSectionCard } from './CollapsibleSectionCard';
import { SectionEditor } from './SectionEditor';

interface KnowledgeBaseCustomSectionProps {
  section: KnowledgeSection;
  isExpanded: boolean;
  /** Stable across renders; child binds the section id. */
  onToggle: (id: CustomSectionId) => void;
  /** Stable across renders; child binds the section id. */
  onChange: (id: CustomSectionId, content: string) => void;
  /** Stable across renders; child binds the section id. */
  onTitleChange: (id: CustomSectionId, title: string) => void;
  /** Stable across renders; child binds the section id. */
  onDelete: (id: CustomSectionId) => void;
  /** Undefined when collapsed so memoized siblings skip re-renders triggered by the global budget changing. */
  remainingChars: number | undefined;
}

function KnowledgeBaseCustomSectionImpl({
  section,
  isExpanded,
  onToggle,
  onChange,
  onTitleChange,
  onDelete,
  remainingChars,
}: KnowledgeBaseCustomSectionProps) {
  const tKb = useTranslations('kb');
  const titleRef = useRef<HTMLInputElement>(null);
  const hasContent = section.content.trim().length > 0;

  // Auto-focus title input when expanded (if no content yet)
  useEffect(() => {
    if (isExpanded && titleRef.current && !section.content.trim()) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [isExpanded, section.content]);

  // Preview: first line of content, truncated
  const preview = hasContent
    ? section.content.split('\n')[0].slice(0, 60) + (section.content.length > 60 ? '...' : '')
    : tKb('section.tapToAdd');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const sectionId = section.id as CustomSectionId;
  const handleToggle = useCallback(() => onToggle(sectionId), [onToggle, sectionId]);
  const handleChange = useCallback((content: string) => onChange(sectionId, content), [onChange, sectionId]);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasContent) {
      setShowDeleteConfirm(true);
    } else {
      onDelete(sectionId);
    }
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Strip colons to keep parser reliable
    onTitleChange(sectionId, e.target.value.replace(/:/g, ''));
  };

  return (
    <>
      <CollapsibleSectionCard
        isExpanded={isExpanded}
        hasContent={hasContent}
        charCount={section.content.length}
        onToggle={handleToggle}
        header={
          <>
            <span className="text-xl flex-shrink-0 text-icon-muted">{CUSTOM_SECTION_MARKER}</span>
            <div className="flex-1 min-w-0">
              {isExpanded ? (
                <input
                  ref={titleRef}
                  className="text-sm font-bold text-foreground bg-transparent border-0 border-b border-transparent focus:border-brand-400 outline-none w-full p-0"
                  value={section.title || ''}
                  onChange={handleTitleChange}
                  onClick={(e) => e.stopPropagation()}
                  placeholder={tKb('customSection.titlePlaceholder')}
                  aria-label={tKb('customSection.titlePlaceholder')}
                  maxLength={40}
                  dir="auto"
                />
              ) : (
                <p className={`text-sm font-bold ${hasContent ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {section.title || tKb('customSection.titlePlaceholder')}
                </p>
              )}
              {!isExpanded && (
                <p className={`text-xs mt-0.5 truncate ${hasContent ? 'text-surface-500 dark:text-surface-700' : 'text-muted-foreground'}`}>
                  {preview}
                </p>
              )}
            </div>
          </>
        }
        headerAction={
          <button
            type="button"
            onClick={handleDelete}
            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-icon-muted hover:text-red-500 transition-colors flex-shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        }
      >
        <SectionEditor
          content={section.content}
          onChange={handleChange}
          description={tKb('customSection.desc')}
          placeholder={tKb('customSection.placeholder')}
          ariaLabel={tKb('customSection.placeholder')}
          isExpanded={isExpanded}
          remainingChars={remainingChars}
        />
      </CollapsibleSectionCard>

      <ConfirmationModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => { setShowDeleteConfirm(false); onDelete(sectionId); }}
        title={tKb('customSection.deleteTitle')}
        message={tKb('customSection.deleteConfirm')}
        variant="danger"
      />
    </>
  );
}

export const KnowledgeBaseCustomSection = memo(KnowledgeBaseCustomSectionImpl);
