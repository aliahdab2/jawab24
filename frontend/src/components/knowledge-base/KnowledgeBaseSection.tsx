import React, { useRef, useEffect, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import type { KnowledgeSection, SectionConfig } from './types';

interface KnowledgeBaseSectionProps {
  section: KnowledgeSection;
  config: SectionConfig;
  isExpanded: boolean;
  onToggle: () => void;
  onChange: (content: string) => void;
}

export function KnowledgeBaseSection({
  section,
  config,
  isExpanded,
  onToggle,
  onChange,
}: KnowledgeBaseSectionProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasContent = section.content.trim().length > 0;

  // Auto-resize textarea to fit content
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(80, el.scrollHeight)}px`;
  }, []);

  // Auto-focus and auto-resize when expanded
  useEffect(() => {
    if (isExpanded && textareaRef.current) {
      textareaRef.current.focus();
      autoResize();
    }
  }, [isExpanded, autoResize]);

  // Preview: first line of content, truncated
  const preview = hasContent
    ? section.content.split('\n')[0].slice(0, 60) + (section.content.length > 60 ? '...' : '')
    : t('kb.section.tapToAdd' as TranslationKey);

  return (
    <div
      className={`rounded-2xl border-2 transition-all duration-200 overflow-hidden ${
        isExpanded
          ? 'border-brand-400 bg-brand-50/20 shadow-sm'
          : hasContent
            ? 'border-brand-200 bg-brand-50/10'
            : 'border-surface-200 bg-white hover:border-surface-300'
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
          <p className={`text-sm font-bold ${hasContent || isExpanded ? 'text-surface-900' : 'text-surface-600'}`}>
            {t(config.titleKey as TranslationKey)}
          </p>
          {!isExpanded && (
            <p className={`text-xs mt-0.5 truncate ${hasContent ? 'text-surface-500' : 'text-surface-400'}`}>
              {preview}
            </p>
          )}
        </div>

        {/* Status dot */}
        <div
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 transition-colors ${
            hasContent ? 'bg-brand-500' : 'bg-surface-200'
          }`}
        />

        {/* Chevron */}
        <ChevronDown
          className={`w-4 h-4 text-surface-400 flex-shrink-0 transition-transform duration-200 ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-3.5 pb-3.5 sm:px-4 sm:pb-4">
          <p className="text-xs text-surface-400 mb-2">
            {t(config.descKey as TranslationKey)}
          </p>
          <textarea
            ref={textareaRef}
            className="w-full min-h-[80px] p-3 sm:p-4 border-2 border-surface-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 overflow-hidden text-sm leading-relaxed text-surface-900 placeholder:text-surface-300"
            placeholder={t(config.placeholderKey as TranslationKey)}
            value={section.content}
            onChange={(e) => onChange(e.target.value)}
            onInput={autoResize}
            dir="auto"
            rows={3}
          />
        </div>
      )}
    </div>
  );
}
