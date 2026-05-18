import { Info } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import clsx from 'clsx';
import type { ReactNode } from 'react';

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
  sm: 'w-[13rem]',
  md: 'w-[14rem]',
};

/**
 * Click-to-toggle info popover built on Radix Popover.
 * Renders in a portal with collision-aware positioning (flip + shift), so the
 * panel never gets clipped by overflow ancestors or pushed off-screen.
 */
export function InfoPopover({ label, children, panelWidth = 'md', triggerClassName }: InfoPopoverProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className={clsx(
            // p-2 -m-2 expands the tap area to 30×30 (≥ WCAG AA 24×24) without
            // affecting surrounding layout. Keep this paired — changing only one
            // breaks either accessibility or visual spacing.
            'inline-flex items-center justify-center p-2 -m-2 rounded-full text-icon-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
            triggerClassName,
          )}
        >
          <Info className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={6}
          collisionPadding={8}
          aria-label={label}
          className={clsx(
            'px-3 py-2.5 text-xs bg-surface-800 text-white dark:bg-surface-100 dark:text-surface-900 rounded-lg shadow-lg text-start z-50',
            'max-w-[calc(100vw-1rem)]',
            PANEL_WIDTHS[panelWidth],
          )}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
