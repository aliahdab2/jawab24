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
    const messageId = `${textareaId}-message`;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={textareaId} className="label">{label}</label>
        )}
        {/* See Input.tsx — `dir` is passed through; empty-field direction is
            handled once in globals.css, not per component. */}
        <textarea
          ref={ref}
          id={textareaId}
          dir={dir}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || helperText ? messageId : undefined}
          className={clsx(
            'input min-h-[100px] resize-y',
            error && 'danger-input',
            className
          )}
          value={value}
          {...props}
        />
        {error && (
          <p id={messageId} role="alert" className="mt-1.5 text-sm text-destructive">{error}</p>
        )}
        {helperText && !error && (
          <p id={messageId} className="mt-1.5 text-sm text-muted-foreground">{helperText}</p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
