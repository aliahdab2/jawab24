import React, { useEffect, useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useTextareaAutoResize } from '@/hooks/useTextareaAutoResize';
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
  const { ref: textareaRef, autoResize } = useTextareaAutoResize(80);
  const [justTranscribed, setJustTranscribed] = useState(false);

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

  // Resize the textarea when the section expands so existing content fits
  // without an internal scrollbar. Focus is intentionally NOT taken here —
  // popping the soft keyboard as a side-effect of expansion (including the
  // initial-mount auto-expand of the first empty section) is unwanted UX.
  // The textarea focuses naturally when the user taps it.
  useEffect(() => {
    if (isExpanded) autoResize();
  }, [isExpanded, autoResize]);

  return (
    <div className="px-3.5 pb-3.5 sm:px-4 sm:pb-4">
      {/* Toolbar row: description (desktop) + action buttons */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs text-muted-foreground min-w-0 hidden sm:block">
          {description}
        </p>
        {/* On mobile show description as a compact label; on desktop it's in the row above */}
        <p className="text-xs text-muted-foreground min-w-0 sm:hidden truncate flex-1">
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
        className={`w-full min-h-[min(42dvh,280px)] sm:min-h-[120px] p-3 sm:p-4 border-2 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 overflow-y-auto text-sm leading-relaxed bg-background text-foreground placeholder:text-muted-foreground transition-colors duration-500 resize-none ${
          justTranscribed ? 'border-amber-400' : 'border-theme-border'
        }`}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={content}
        onChange={(e) => onChange(e.target.value)}
        onInput={autoResize}
        dir="auto"
      />
    </div>
  );
}
