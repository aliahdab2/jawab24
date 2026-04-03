import React, { useRef, useEffect, useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ConfirmationModal } from '@/components/ui';
import { CUSTOM_SECTION_MARKER } from './types';
import type { KnowledgeSection } from './types';
import { SectionEditor } from './SectionEditor';

interface KnowledgeBaseCustomSectionProps {
  section: KnowledgeSection;
  isExpanded: boolean;
  onToggle: () => void;
  onChange: (content: string) => void;
  onTitleChange: (title: string) => void;
  onDelete: () => void;
  remainingChars: number;
}

export function KnowledgeBaseCustomSection({
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

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasContent) {
      setShowDeleteConfirm(true);
    } else {
      onDelete();
    }
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Strip colons to keep parser reliable
    onTitleChange(e.target.value.replace(/:/g, ''));
  };

  return (
    <div
      className={`rounded-2xl border-2 transition-all duration-200 overflow-hidden ${
        isExpanded
          ? 'border-brand-400 bg-brand-50/20 shadow-sm'
          : hasContent
            ? 'border-brand-200 bg-brand-50/10'
            : 'border-theme-border bg-card hover:border-surface-300 dark:hover:border-surface-500'
      }`}
    >
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3.5 sm:p-4 text-start"
      >
        {/* Custom marker icon */}
        <span className="text-xl flex-shrink-0 text-icon-muted">{CUSTOM_SECTION_MARKER}</span>

        {/* Title + preview */}
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

        {/* Delete button */}
        <button
          type="button"
          onClick={handleDelete}
          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-icon-muted hover:text-red-500 transition-colors flex-shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        {/* Char count + Status dot */}
        {!isExpanded && hasContent && (
          <span className="text-[10px] tabular-nums text-muted-foreground flex-shrink-0">
            {section.content.length.toLocaleString()}
          </span>
        )}
        <div
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 transition-colors ${
            hasContent ? 'bg-brand-500' : 'bg-dot-muted'
          }`}
        />

        {/* Chevron */}
        <ChevronDown
          className={`w-4 h-4 text-icon-muted flex-shrink-0 transition-transform duration-200 ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <SectionEditor
          content={section.content}
          onChange={onChange}
          description={tKb('customSection.desc')}
          placeholder={tKb('customSection.placeholder')}
          ariaLabel={tKb('customSection.placeholder')}
          isExpanded={isExpanded}
          remainingChars={remainingChars}
        />
      )}

      <ConfirmationModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => { setShowDeleteConfirm(false); onDelete(); }}
        title={tKb('customSection.deleteTitle')}
        message={tKb('customSection.deleteConfirm')}
        variant="danger"
      />
    </div>
  );
}
