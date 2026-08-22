import React from 'react';
import clsx from 'clsx';

interface SwipeBothSidesLabelProps {
  /** Icon rendered on both sides (mirrored) */
  icon: React.ReactNode;
  /** Label text shown on both sides */
  label: string;
  /** Background + text color classes (e.g., "bg-brand-50 text-brand-700 dark:text-brand-400" — the scales invert,
   *  so a scale background needs a dark: foreground; see CONVENTIONS.md) */
  className?: string;
}

/**
 * Symmetric swipe background label shown on both sides of a swipeable item.
 * Left side: icon → label. Right side: label → icon.
 * Used as the `background` prop for `SwipeDismissWrapper`.
 */
export function SwipeBothSidesLabel({
  icon,
  label,
  className,
}: SwipeBothSidesLabelProps) {
  return (
    <div className={clsx('flex items-center justify-between px-5 h-full', className)}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{label}</span>
        {icon}
      </div>
    </div>
  );
}
