import React from 'react';
interface KnowledgeBaseRawEditorProps {
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  ariaLabel?: string;
  /** Called when a paste would exceed maxLength. The textarea's native
   *  maxLength truncates the paste BEFORE onChange fires, so the cut is
   *  invisible to the value — this is the only place it can be detected. */
  onPasteTruncated?: (info: { kept: number; total: number }) => void;
}

export function KnowledgeBaseRawEditor({ value, onChange, maxLength, ariaLabel, onPasteTruncated }: KnowledgeBaseRawEditorProps) {
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onPasteTruncated) return;
    const pasted = e.clipboardData.getData('text');
    if (!pasted) return;
    const el = e.currentTarget;
    const selectionLength = el.selectionEnd - el.selectionStart;
    const resultingLength = value.length - selectionLength + pasted.length;
    if (resultingLength > maxLength) {
      onPasteTruncated({ kept: maxLength, total: resultingLength });
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <textarea
        className="flex-1 w-full min-h-[200px] p-4 border-2 border-theme-border rounded-2xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none bg-background text-foreground text-sm leading-relaxed placeholder:text-muted-foreground"
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
        onPaste={handlePaste}
        maxLength={maxLength}
        dir="auto"
        aria-label={ariaLabel}
      />
      <div className="flex items-center justify-end mt-2 px-1">
        <span
          className={`text-xs font-medium ${
            value.length > maxLength * 0.95
              ? 'text-red-500'
              : value.length > maxLength * 0.75
                ? 'text-amber-500'
                : 'text-muted-foreground'
          }`}
        >
          {value.length.toLocaleString()}/{maxLength.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
