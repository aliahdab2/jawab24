import clsx from 'clsx';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';

interface CollapsibleSectionHeaderProps {
    expanded: boolean;
    onToggle: () => void;
    /** Icon container — caller controls color/background (e.g. icon-bg-brand vs bg-muted). */
    icon: ReactNode;
    /** Title row + optional subtitle/badges. Composed by the caller for layout flexibility. */
    children: ReactNode;
    /** id on the *body* the header controls — used for aria-controls. */
    controlsId?: string;
    /** Extra classes for the outer button (e.g. mb-6 spacing the page wants). */
    className?: string;
}

/**
 * Shared collapsible-section toggle button. Used by both the Advanced and
 * Team sections on the settings page so the visual + interaction model is
 * consistent (same hover/expanded treatment, same chevron flip, same
 * icon+text+chevron layout).
 */
export function CollapsibleSectionHeader({
    expanded,
    onToggle,
    icon,
    children,
    controlsId,
    className,
}: CollapsibleSectionHeaderProps) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={controlsId}
            className={clsx(
                'w-full flex items-center justify-between p-4 landscape:p-3 rounded-xl border transition-all duration-300',
                expanded
                    ? 'bg-background border-theme-border shadow-sm'
                    : 'bg-card border-theme-border hover:border-theme-border hover:bg-background',
                className
            )}
        >
            <div className="flex items-center gap-4 min-w-0">
                {icon}
                <div className="text-start min-w-0">{children}</div>
            </div>
            {expanded ? (
                <ChevronUp className="w-5 h-5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
            ) : (
                <ChevronDown className="w-5 h-5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
            )}
        </button>
    );
}
