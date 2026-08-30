import React, { useCallback, memo } from 'react';
import { useTranslations } from 'next-intl';
import type { KnowledgeSection, SectionConfig, SectionId } from './types';
import { CollapsibleSectionCard } from './CollapsibleSectionCard';
import { SectionEditor } from './SectionEditor';

interface KnowledgeBaseSectionProps {
  section: KnowledgeSection;
  config: SectionConfig;
  isExpanded: boolean;
  /** Stable across renders; child binds the section id. */
  onToggle: (id: SectionId) => void;
  /** Stable across renders; child binds the section id. */
  onChange: (id: SectionId, content: string) => void;
  /** Undefined when collapsed so memoized siblings skip re-renders triggered by the global budget changing. */
  remainingChars: number | undefined;
  /** View-only (workspace `member`) — see SectionEditor. */
  readOnly?: boolean;
}

function KnowledgeBaseSectionImpl({
  section,
  config,
  isExpanded,
  onToggle,
  onChange,
  remainingChars,
  readOnly = false,
}: KnowledgeBaseSectionProps) {
  const tKb = useTranslations('kb');
  const hasContent = section.content.trim().length > 0;

  const handleToggle = useCallback(() => onToggle(section.id), [onToggle, section.id]);
  const handleChange = useCallback((content: string) => onChange(section.id, content), [onChange, section.id]);

  // Preview: first line of content, truncated
  const preview = hasContent
    ? section.content.split('\n')[0].slice(0, 60) + (section.content.length > 60 ? '...' : '')
    : tKb('section.tapToAdd');

  return (
    <CollapsibleSectionCard
      isExpanded={isExpanded}
      hasContent={hasContent}
      charCount={section.content.length}
      charCountLabel={tKb('charCountAria', { count: section.content.length })}
      onToggle={handleToggle}
      header={
        <>
          <span className="w-9 h-9 rounded-xl icon-bg-brand flex items-center justify-center flex-shrink-0">
            <config.icon className="w-4 h-4" aria-hidden="true" />
          </span>
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
        </>
      }
    >
      <SectionEditor
        content={section.content}
        onChange={handleChange}
        description={tKb(config.descKey)}
        placeholder={tKb(config.placeholderKey)}
        ariaLabel={tKb(config.titleKey)}
        isExpanded={isExpanded}
        remainingChars={remainingChars}
        readOnly={readOnly}
      />
    </CollapsibleSectionCard>
  );
}

export const KnowledgeBaseSection = memo(KnowledgeBaseSectionImpl);
