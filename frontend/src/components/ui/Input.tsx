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
    const messageId = `${inputId}-message`;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="label">{label}</label>
        )}
        {/*
          `dir` is passed through untouched. It used to be suppressed while the
          field was empty, which broke UNCONTROLLED inputs outright: `value` is
          always undefined there, so the element never received `dir="auto"` and
          typed Arabic never flipped the field. Empty-field direction is handled
          once, in globals.css, by `input[dir="auto"]:placeholder-shown`.
        */}
        <input
          ref={ref}
          id={inputId}
          dir={dir}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || helperText ? messageId : undefined}
          className={clsx(
            'input',
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

Input.displayName = 'Input';
