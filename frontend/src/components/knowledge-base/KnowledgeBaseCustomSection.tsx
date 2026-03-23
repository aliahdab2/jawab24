import React, { useRef, useEffect, useCallback, useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ConfirmationModal } from '@/components/ui';
import { CUSTOM_SECTION_MARKER } from './types';
import type { KnowledgeSection } from './types';
import { VoiceRecordButton } from './VoiceRecordButton';

interface KnowledgeBaseCustomSectionProps {
  section: KnowledgeSection;
  isExpanded: boolean;
  onToggle: () => void;
  onChange: (content: string) => void;
  onTitleChange: (title: string) => void;
  onDelete: () => void;
}

export function KnowledgeBaseCustomSection({
  section,
  isExpanded,
  onToggle,
  onChange,
  onTitleChange,
  onDelete,
}: KnowledgeBaseCustomSectionProps) {
  const tKb = useTranslations('kb');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const hasContent = section.content.trim().length > 0;
  const [justTranscribed, setJustTranscribed] = useState(false);

  // Auto-resize textarea to fit content
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(80, el.scrollHeight)}px`;
  }, []);

  const handleVoiceTranscribed = useCallback((text: string) => {
    const current = section.content.trim();
    const newContent = current ? `${current}\n${text}` : text;
    onChange(newContent);
    setJustTranscribed(true);
    setTimeout(() => setJustTranscribed(false), 2000);
    setTimeout(() => autoResize(), 50);
  }, [section.content, onChange, autoResize]);

  // Auto-focus title input when expanded (if title is default)
  useEffect(() => {
    if (isExpanded) {
      if (titleRef.current && !section.content.trim()) {
        titleRef.current.focus();
        titleRef.current.select();
      } else if (textareaRef.current) {
        textareaRef.current.focus();
        autoResize();
      }
    }
  }, [isExpanded, section.content, autoResize]);

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

        {/* Status dot */}
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
        <div className="px-3.5 pb-3.5 sm:px-4 sm:pb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">
              {tKb('customSection.desc')}
            </p>
            <VoiceRecordButton
              variant="inline"
              onTranscribed={handleVoiceTranscribed}
            />
          </div>
          <textarea
            ref={textareaRef}
            className={`w-full min-h-[80px] p-3 sm:p-4 border-2 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 overflow-hidden text-sm leading-relaxed bg-background text-foreground placeholder:text-muted-foreground transition-colors duration-500 ${
              justTranscribed ? 'border-amber-400' : 'border-theme-border'
            }`}
            placeholder={tKb('customSection.placeholder')}
            aria-label={tKb('customSection.placeholder')}
            value={section.content}
            onChange={(e) => onChange(e.target.value)}
            onInput={autoResize}
            dir="auto"
            rows={3}
          />
          {section.content.length > 0 && (
            <p className={`text-end text-xs mt-1 ${
              section.content.length > 4500 ? 'text-amber-500' : 'text-muted-foreground'
            }`}>
              {tKb('charCount', { count: section.content.length, max: 5000 })}
            </p>
          )}
        </div>
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
