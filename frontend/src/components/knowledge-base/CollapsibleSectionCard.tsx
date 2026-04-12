import React from 'react';
import { ChevronDown } from 'lucide-react';

interface CollapsibleSectionCardProps {
  isExpanded: boolean;
  hasContent: boolean;
  charCount: number;
  onToggle: () => void;
  /** Icon + title + preview row — rendered inside the toggle button */
  header: React.ReactNode;
  /** Optional element placed between the header and the status indicators (e.g. delete button) */
  headerAction?: React.ReactNode;
  /** Content rendered below the header when expanded */
  children?: React.ReactNode;
}

/**
 * Shared card shell for KB sections.
 * Provides the border-state container, toggle button layout, char count,
 * status dot, and chevron — identical in KnowledgeBaseSection and
 * KnowledgeBaseCustomSection.
 */
export function CollapsibleSectionCard({
  isExpanded,
  hasContent,
  charCount,
  onToggle,
  header,
  headerAction,
  children,
}: CollapsibleSectionCardProps) {
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
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 sm:p-4 text-start"
      >
        {header}

        {headerAction}

        {!isExpanded && hasContent && (
          <span className="text-[10px] tabular-nums text-muted-foreground flex-shrink-0">
            {charCount.toLocaleString()}
          </span>
        )}

        <div
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 transition-colors ${
            hasContent ? 'bg-brand-500' : 'bg-dot-muted'
          }`}
        />

        <ChevronDown
          className={`w-4 h-4 text-icon-muted flex-shrink-0 transition-transform duration-200 ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isExpanded && children}
    </div>
  );
}
