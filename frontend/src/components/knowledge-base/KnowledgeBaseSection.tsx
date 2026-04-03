import React from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { KnowledgeSection, SectionConfig } from './types';
import { SectionEditor } from './SectionEditor';

interface KnowledgeBaseSectionProps {
  section: KnowledgeSection;
  config: SectionConfig;
  isExpanded: boolean;
  onToggle: () => void;
  onChange: (content: string) => void;
  remainingChars: number;
}

export function KnowledgeBaseSection({
  section,
  config,
  isExpanded,
  onToggle,
  onChange,
  remainingChars,
}: KnowledgeBaseSectionProps) {
  const tKb = useTranslations('kb');
  const hasContent = section.content.trim().length > 0;

  // Preview: first line of content, truncated
  const preview = hasContent
    ? section.content.split('\n')[0].slice(0, 60) + (section.content.length > 60 ? '...' : '')
    : tKb('section.tapToAdd');

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
      {/* Header - always visible, clickable */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3.5 sm:p-4 text-start"
      >
        {/* Emoji icon */}
        <span className="text-xl flex-shrink-0">{config.emoji}</span>

        {/* Title + preview */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-bold ${hasContent || isExpanded ? 'text-foreground' : 'text-muted-foreground'}`}>
            {tKb(config.titleKey)}
          </p>
          {!isExpanded && (
            <p className={`text-xs mt-0.5 truncate ${hasContent ? 'text-surface-500 dark:text-surface-700' : 'text-muted-foreground'}`}>
              {preview}
            </p>
          )}
        </div>

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
          description={tKb(config.descKey)}
          placeholder={tKb(config.placeholderKey)}
          ariaLabel={tKb(config.titleKey)}
          isExpanded={isExpanded}
          remainingChars={remainingChars}
        />
      )}
    </div>
  );
}
