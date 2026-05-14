import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import clsx from 'clsx';
import { useEscapeKey, useClickOutside } from '@/hooks';

interface InfoPopoverProps {
  /** Accessible label for the trigger and panel. */
  label: string;
  /** Panel content. */
  children: ReactNode;
  /** Width of the panel; clamped so it never overflows narrow viewports. */
  panelWidth?: 'sm' | 'md';
  /** Optional className for the trigger button. */
  triggerClassName?: string;
}

const PANEL_WIDTHS: Record<'sm' | 'md', string> = {
  sm: 'w-[min(13rem,calc(100vw-2rem))]',
  md: 'w-[min(14rem,calc(100vw-2rem))]',
};

/**
 * Click-to-toggle info popover. Works on touch, mouse, and keyboard.
 *
 * Accessibility:
 * - Trigger is a real `<button>` with `aria-expanded` and `aria-controls`
 * - Panel is rendered only when open (screen readers ignore it when closed)
 * - ESC and outside-click both close
 * - `aria-haspopup="dialog"` is intentionally NOT used — this is a non-modal
 *   disclosure, not a dialog (no focus trap, no return focus on close).
 */
export function InfoPopover({ label, children, panelWidth = 'md', triggerClassName }: InfoPopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);
  useEscapeKey(close, open);
  useClickOutside(wrapperRef, close, open);

  return (
    <span ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={clsx(
          'inline-flex items-center justify-center rounded-full text-icon-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
          triggerClassName,
        )}
      >
        <Info className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {open && (
        <span
          id={panelId}
          role="group"
          aria-label={label}
          className={clsx(
            'absolute bottom-full ltr:end-0 rtl:start-0 mb-2 px-3 py-2.5 text-xs bg-surface-800 text-white dark:bg-surface-100 dark:text-surface-900 rounded-lg shadow-lg text-start z-20',
            PANEL_WIDTHS[panelWidth],
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
