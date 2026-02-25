import React from 'react';
interface KnowledgeBaseRawEditorProps {
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  ariaLabel?: string;
}

export function KnowledgeBaseRawEditor({ value, onChange, maxLength, ariaLabel }: KnowledgeBaseRawEditorProps) {

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <textarea
        className="flex-1 w-full min-h-[200px] p-4 border-2 border-surface-200 rounded-2xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none text-surface-900 text-sm leading-relaxed placeholder:text-surface-300"
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
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
                : 'text-surface-400'
          }`}
        >
          {value.length.toLocaleString()}/{maxLength.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
