import React from 'react';
import clsx from 'clsx';

interface FormFieldProps {
  /** Visible label text */
  label: string;
  /** id of the input rendered as children — required so the label is properly associated */
  htmlFor: string;
  /** Optional helper text shown below the input */
  helper?: React.ReactNode;
  /** The input/textarea/custom control */
  children: React.ReactNode;
  /** Override or extend the wrapper className */
  className?: string;
}

export function FormField({ label, htmlFor, helper, children, className }: FormFieldProps) {
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label className="text-sm font-medium text-foreground" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
    </div>
  );
}
