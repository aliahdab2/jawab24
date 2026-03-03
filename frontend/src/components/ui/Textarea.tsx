import React, { TextareaHTMLAttributes, forwardRef, useId } from 'react';
import clsx from 'clsx';

interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'children'> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helperText, className, id, dir = 'auto', value, ...props }, ref) => {
    const generatedId = useId();
    const textareaId = id || generatedId;
    // When dir is "auto" and value is empty, inherit direction from parent
    // so placeholder text aligns correctly in RTL mode
    const effectiveDir = dir === 'auto' && !value ? undefined : dir;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={textareaId} className="label">{label}</label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          dir={effectiveDir}
          className={clsx(
            'input min-h-[100px] resize-y',
            error && 'border-red-500 focus:ring-red-500',
            className
          )}
          value={value}
          {...props}
        />
        {error && (
          <p className="mt-1.5 text-sm text-red-500">{error}</p>
        )}
        {helperText && !error && (
          <p className="mt-1.5 text-sm text-surface-500">{helperText}</p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';

