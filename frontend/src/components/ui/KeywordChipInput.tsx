import React, { KeyboardEvent, useRef, useState } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

interface KeywordChipInputProps {
  value: string[];
  onChange: (keywords: string[]) => void;
  placeholder?: string;
  maxKeywords?: number;
  maxLength?: number;
  id?: string;
}

export function KeywordChipInput({
  value,
  onChange,
  placeholder,
  maxKeywords = 10,
  maxLength = 100,
  id,
}: KeywordChipInputProps) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function addKeyword(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (trimmed.length > maxLength) return;
    if (value.length >= maxKeywords) return;
    // Avoid exact duplicates (case-insensitive)
    if (value.some(k => k.toLowerCase() === trimmed.toLowerCase())) return;
    onChange([...value, trimmed]);
    setInputValue('');
  }

  function removeKeyword(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addKeyword(inputValue);
    } else if (e.key === 'Backspace' && inputValue === '' && value.length > 0) {
      removeKeyword(value.length - 1);
    }
  }

  const atLimit = value.length >= maxKeywords;

  return (
    <div
      className={clsx(
        'flex flex-wrap gap-1.5 min-h-[42px] px-3 py-2 rounded-lg border bg-background',
        'border-theme-border focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20',
        'transition-colors cursor-text',
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((kw, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-sm font-medium bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-700"
        >
          <span dir="auto">{kw}</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); removeKeyword(i); }}
            className="flex items-center text-brand-400 hover:text-brand-600 dark:hover:text-brand-200 transition-colors"
            aria-label={`Remove ${kw}`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      {atLimit ? (
        <span className="text-xs text-muted-foreground self-center" aria-live="polite">
          {value.length}/{maxKeywords}
        </span>
      ) : (
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => addKeyword(inputValue)}
          placeholder={value.length === 0 ? placeholder : undefined}
          dir={inputValue ? 'auto' : undefined}
          maxLength={maxLength}
          // Force the Android soft keyboard to show "Enter" rather than the
          // auto-detected "Next" — without this, pressing Enter blurs to the
          // next form input via the browser IME (preventDefault on keydown
          // doesn't catch the IME-level focus shift).
          enterKeyHint="enter"
          className="flex-1 min-w-[120px] bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none border-none p-0"
        />
      )}
    </div>
  );
}
