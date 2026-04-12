import React from 'react';
import { useTranslations } from 'next-intl';
import type { KnowledgeSection, SectionConfig } from './types';
import { CollapsibleSectionCard } from './CollapsibleSectionCard';
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
    <CollapsibleSectionCard
      isExpanded={isExpanded}
      hasContent={hasContent}
      charCount={section.content.length}
      onToggle={onToggle}
      header={
        <>
          <span className="text-xl flex-shrink-0">{config.emoji}</span>
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
        onChange={onChange}
        description={tKb(config.descKey)}
        placeholder={tKb(config.placeholderKey)}
        ariaLabel={tKb(config.titleKey)}
        isExpanded={isExpanded}
        remainingChars={remainingChars}
      />
    </CollapsibleSectionCard>
  );
}
