import clsx from 'clsx';

/**
 * Lightweight CSS-only horizontal bar for proportional metrics.
 * Used for notification funnel + by-type breakdowns. Chosen over a chart
 * library to keep the bundle small; matches the pattern in admin/observability.
 *
 * `value` and `max` are raw counts; the bar fills `(value/max) * 100%` capped at 100.
 * `variant` maps to a semantic CSS class (defined in globals.css) so it works
 * in both light and dark mode without per-component overrides.
 */
export interface HorizontalBarProps {
    label: string;
    value: number;
    max: number;
    variant?: 'success' | 'danger' | 'muted' | 'brand';
    /** Optional right-side hint (e.g., percentage, channel name). */
    hint?: string;
}

const VARIANT_CLASS: Record<NonNullable<HorizontalBarProps['variant']>, string> = {
    success: 'bg-status-success',
    danger: 'bg-status-danger',
    muted: 'bg-muted-foreground/40',
    brand: 'bg-brand-500',
};

export function HorizontalBar({ label, value, max, variant = 'brand', hint }: HorizontalBarProps) {
    const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
    return (
        <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-foreground/80 truncate">{label}</span>
                <span className="text-muted-foreground tabular-nums shrink-0">
                    <span className="text-foreground font-semibold">{value.toLocaleString()}</span>
                    {hint ? <span className="ms-2 text-xs">{hint}</span> : null}
                </span>
            </div>
            <div
                className="h-2 bg-muted rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={value}
                aria-valuemin={0}
                aria-valuemax={max}
                aria-label={label}
            >
                <div
                    className={clsx('h-full rounded-full transition-[width] duration-300', VARIANT_CLASS[variant])}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
}
