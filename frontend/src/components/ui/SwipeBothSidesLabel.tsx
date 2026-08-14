import React from 'react';
import clsx from 'clsx';

interface SwipeBothSidesLabelProps {
  /** Icon rendered on both sides (mirrored) */
  icon: React.ReactNode;
  /** Label text shown on both sides */
  label: string;
  /** Background + text color classes (e.g., "bg-brand-50 text-brand-700") */
  className?: string;
}

/**
 * Symmetric swipe background label shown on both sides of a swipeable item.
 * Left side: icon → label. Right side: label → icon.
 * Used as the `background` prop for `SwipeDismissWrapper`.
 *
 * ⭐ `aria-hidden`: this is DECORATION revealed by a drag, and it is rendered
 * TWICE by design (once per side, so the gesture reads the same in either
 * direction and under RTL). Without this, both copies land in the accessibility
 * tree ahead of the item they sit behind — a screen-reader user on the
 * dashboard heard «إخفاء لليوم إخفاء لليوم إنشاء منشور…», and the same doubling
 * affected notifications, messages and comments, since all four share this
 * component. Caught by reading the live a11y tree, 2026-08-14.
 *
 * The gesture itself is not lost to assistive tech: it was never keyboard- or
 * screen-reader-operable to begin with, and every consumer exposes the same
 * action through a real control (the notification/message/comment rows) or a
 * documented alternative. Announcing an undraggable label twice added noise,
 * not access.
 */
export function SwipeBothSidesLabel({
  icon,
  label,
  className,
}: SwipeBothSidesLabelProps) {
  return (
    <div aria-hidden="true" className={clsx('flex items-center justify-between px-5 h-full', className)}>
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
