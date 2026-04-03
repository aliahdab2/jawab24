import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { VoiceRecordButton } from './VoiceRecordButton';

interface SectionEditorProps {
  content: string;
  onChange: (content: string) => void;
  description: string;
  placeholder: string;
  ariaLabel: string;
  isExpanded: boolean;
}

/**
 * Shared textarea editor with voice input, auto-resize, and char counter.
 * Used by KnowledgeBaseSection and KnowledgeBaseCustomSection.
 */
export function SectionEditor({
  content,
  onChange,
  description,
  placeholder,
  ariaLabel,
  isExpanded,
}: SectionEditorProps) {
  const tKb = useTranslations('kb');
  const locale = useLocale();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [justTranscribed, setJustTranscribed] = useState(false);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(80, el.scrollHeight)}px`;
  }, []);

  const handleVoiceTranscribed = useCallback((text: string) => {
    const current = content.trim();
    const newContent = current ? `${current}\n${text}` : text;
    onChange(newContent);
    setJustTranscribed(true);
    setTimeout(() => setJustTranscribed(false), 2000);
    setTimeout(() => autoResize(), 50);
  }, [content, onChange, autoResize]);

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
        <VoiceRecordButton
          variant="inline"
          onTranscribed={handleVoiceTranscribed}
          languageHint={locale}
          className="flex-shrink-0"
        />
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
      {content.length > 6000 && (
        <p className={`text-end text-xs mt-1 ${
          content.length > 7200 ? 'text-amber-500' : 'text-muted-foreground'
        }`}>
          {tKb('charCount', { count: content.length, max: 8000 })}
        </p>
      )}
    </div>
  );
}
