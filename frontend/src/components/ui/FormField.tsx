import React from 'react';
import clsx from 'clsx';

interface FormFieldProps {
  /** Visible label content — usually a string; may carry a non-interactive adornment
   *  (e.g. a required marker). Interactive adornments (popovers) must NOT go here:
   *  they'd sit inside the <label> and steal its click-to-focus behavior. */
  label: React.ReactNode;
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
