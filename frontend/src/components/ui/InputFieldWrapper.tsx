import clsx from 'clsx';
import type { ReactNode } from 'react';

interface InputFieldWrapperProps {
  children: ReactNode;
  /** Render inside the wrapper, absolutely positioned bottom-end. Typically a CharCounter. */
  trailing?: ReactNode;
  /** Visual disabled state — does not propagate to the input itself. Pass disabled to the field too. */
  disabled?: boolean;
  className?: string;
}

/**
 * Canonical chrome for text inputs and textareas across the settings page.
 *
 * Wraps the field in a focus-aware ring and provides a fixed slot for a trailing
 * element (typically a character counter) at bottom-end.
 *
 * The field itself should be passed in as children with these properties:
 *   - bg-transparent border-none focus:outline-none focus:ring-0
 *   - p-3 pe-14 (reserve space for trailing content)
 *   - placeholder:text-muted-foreground placeholder:italic
 *   - resize-none for textareas
 */
export function InputFieldWrapper({ children, trailing, disabled, className }: InputFieldWrapperProps) {
  return (
    <div
      className={clsx(
        'relative rounded-2xl bg-background transition-[box-shadow,opacity] duration-200',
        'focus-within:ring-2 focus-within:ring-brand-500/40',
        disabled && 'opacity-50',
        className,
      )}
    >
      {children}
      {trailing && (
        // pointer-events-none so a click near the field's trailing edge always
        // lands on the input, never on the counter (we never want to "click" a counter).
        <div className="absolute bottom-2 end-3 pointer-events-none">
          {trailing}
        </div>
      )}
    </div>
  );
}
