import React from 'react';
import clsx from 'clsx';
import { Clock } from 'lucide-react';
import type { NotificationStyle } from '@/components/ui/notificationUtils';

/**
 * Shared presentational primitives used by both the single notification row
 * (NotificationBell) and the collapsed group header (NotificationGroup). These
 * lived as copy-pasted JSX in both places and had already drifted (clock color,
 * missing aria-hidden) — keep them here so the two surfaces stay identical.
 */

/** Left accent bar marking an unread row. The parent element must be `relative`. */
export function UnreadAccentBar() {
    return (
        <div
            className="absolute inset-y-0 start-0 w-[3px] bg-brand-500 rounded-e-full"
            aria-hidden="true"
        />
    );
}

/** Rounded icon avatar shown at the start of every notification row and group header. */
export function NotificationAvatar({ style, muted }: { style: NotificationStyle; muted: boolean }) {
    const Icon = style.icon;
    return (
        <div
            className={clsx(
                'w-10 h-10 rounded-xl ring-1 flex items-center justify-center flex-shrink-0',
                style.bgColor,
                style.ringColor,
                muted && 'opacity-50',
            )}
        >
            <Icon className={clsx('w-5 h-5', style.iconColor)} aria-hidden="true" />
        </div>
    );
}

/** Relative-time line with a clock glyph. */
export function NotificationTimestamp({
    time,
    getRelativeTime,
    className,
}: {
    time: string;
    getRelativeTime: (dateString: string) => string;
    className?: string;
}) {
    return (
        <div className={clsx('flex items-center gap-1', className)}>
            <Clock className="w-3 h-3 text-icon-muted" aria-hidden="true" />
            <p className="text-[11px] text-muted-foreground">{getRelativeTime(time)}</p>
        </div>
    );
}
