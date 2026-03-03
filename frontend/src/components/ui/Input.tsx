import React, { InputHTMLAttributes, forwardRef, useId } from 'react';
import clsx from 'clsx';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'children'> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className, id, dir = 'auto', value, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id || generatedId;
    // When dir is "auto" and value is empty, inherit direction from parent
    // so placeholder text aligns correctly in RTL mode
    const effectiveDir = dir === 'auto' && !value ? undefined : dir;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="label">{label}</label>
        )}
        <input
          ref={ref}
          id={inputId}
          dir={effectiveDir}
          className={clsx(
            'input',
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

Input.displayName = 'Input';

