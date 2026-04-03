import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { VoiceRecordButton } from './VoiceRecordButton';
import { FileUploadButton } from './FileUploadButton';

interface SectionEditorProps {
  content: string;
  onChange: (content: string) => void;
  description: string;
  placeholder: string;
  ariaLabel: string;
  isExpanded: boolean;
  /** Characters remaining in the total KB budget. Used to truncate file extractions. */
  remainingChars?: number;
}

/**
 * Shared textarea editor with voice input, file upload, and auto-resize.
 * Used by KnowledgeBaseSection and KnowledgeBaseCustomSection.
 */
export function SectionEditor({
  content,
  onChange,
  description,
  placeholder,
  ariaLabel,
  isExpanded,
  remainingChars,
}: SectionEditorProps) {
  const locale = useLocale();
  const tKb = useTranslations('kb');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [justTranscribed, setJustTranscribed] = useState(false);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(80, el.scrollHeight)}px`;
  }, []);

  /** Shared handler for voice transcription and file extraction — append text + highlight.
   *  Truncates inserted text to fit the remaining KB budget when available. */
  const handleTextInsert = useCallback((text: string) => {
    const current = content.trim();
    const separator = current ? '\n' : '';
    let insertText = text;

    // Truncate to fit remaining KB budget (remainingChars accounts for all other sections)
    if (remainingChars !== undefined) {
      const currentSectionChars = current.length + separator.length;
      const budget = remainingChars + content.length - currentSectionChars;
      if (insertText.length > budget && budget > 0) {
        const originalLength = insertText.length;
        insertText = insertText.slice(0, budget);
        toast.info(
          tKb('extractTrimmedToBudget')
            .replace('{kept}', budget.toLocaleString())
            .replace('{total}', originalLength.toLocaleString()),
        );
      }
    }

    const newContent = current ? `${current}${separator}${insertText}` : insertText;
    onChange(newContent);
    setJustTranscribed(true);
    setTimeout(() => setJustTranscribed(false), 2000);
    setTimeout(() => autoResize(), 50);
  }, [content, onChange, autoResize, remainingChars, tKb]);

  useEffect(() => {
    if (isExpanded && textareaRef.current) {
      textareaRef.current.focus();
      autoResize();
    }
  }, [isExpanded, autoResize]);

  return (
    <div className="px-3.5 pb-3.5 sm:px-4 sm:pb-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-xs text-muted-foreground min-w-0">
          {description}
        </p>
        <div className="flex items-center gap-1 flex-shrink-0">
          <FileUploadButton
            onExtracted={handleTextInsert}
            className="flex-shrink-0"
          />
          <VoiceRecordButton
            variant="inline"
            onTranscribed={handleTextInsert}
            languageHint={locale}
            className="flex-shrink-0"
          />
        </div>
      </div>
      <textarea
        ref={textareaRef}
        className={`w-full min-h-[80px] p-3 sm:p-4 border-2 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 overflow-hidden text-sm leading-relaxed bg-background text-foreground placeholder:text-muted-foreground transition-colors duration-500 ${
          justTranscribed ? 'border-amber-400' : 'border-theme-border'
        }`}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={content}
        onChange={(e) => onChange(e.target.value)}
        onInput={autoResize}
        dir="auto"
        rows={3}
      />
    </div>
  );
}
