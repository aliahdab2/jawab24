import React from 'react';
import clsx from 'clsx';
import type { NavBadgeColor } from '@/hooks/useNavBadgeCounts';

interface NavCountBadgeProps {
  count: number;
  color?: NavBadgeColor;
  /** Announced to screen readers, which never see the `aria-hidden` pill. */
  srLabel?: string;
  /** Render as a bare dot — for surfaces too narrow to fit the number. */
  dot?: boolean;
  /** Positioning and sizing; the colour and shape are owned here. */
  className?: string;
}

/**
 * The count pill worn by a nav destination.
 *
 * Positive assertion, not `count <= 0`: NaN/undefined slipping through a typed
 * boundary compares false to every `<=`, so the old guard let a non-number fall
 * through and render an EMPTY pill.
 */
export function NavCountBadge({ count, color = 'red', srLabel, dot = false, className }: NavCountBadgeProps) {
  if (!(count > 0)) return null;

  return (
    <>
      <span
        aria-hidden="true"
        className={clsx(
          'flex items-center justify-center text-white font-bold rounded-full flex-shrink-0',
          color === 'brand' ? 'bg-brand-500' : 'bg-red-500',
          className,
        )}
      >
        {dot ? '' : count > 99 ? '99+' : count}
      </span>
      {srLabel && <span className="sr-only">{srLabel}</span>}
    </>
  );
}
