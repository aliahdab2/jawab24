import type { ReactNode } from 'react';
import clsx from 'clsx';
// Direct import, NOT the '@/components/ui' barrel — reached from public
// /integrations. See components/layout/PublicLayout.tsx.
import { Card } from '@/components/ui/Card';

/**
 * Compact KPI tile for analytics dashboards.
 *
 * Reused across the e-commerce analytics page and (later) the integrations
 * summary widget. Channel-agnostic — same shape for SMS / WhatsApp / DM stats.
 */
export interface KpiCardProps {
    label: string;
    value: ReactNode;
    /** Optional secondary line under the value (e.g., currency, period). */
    subValue?: ReactNode;
    /** Optional icon node — caller controls the icon library. */
    icon?: ReactNode;
    /** Tooltip-style caveat shown when the metric has known limitations. */
    caveat?: string;
    /** Tailwind size variant — `sm` for the integrations widget, `md` (default) for the page. */
    size?: 'sm' | 'md';
}

export function KpiCard({ label, value, subValue, icon, caveat, size = 'md' }: KpiCardProps) {
    const isSmall = size === 'sm';
    return (
        <Card
            className={clsx(
                'border-none shadow-[0_4px_16px_rgba(0,0,0,0.04)]',
                isSmall ? 'p-3' : 'p-5 landscape:p-4',
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p
                        className={clsx(
                            'text-muted-foreground text-start',
                            isSmall ? 'text-xs' : 'text-sm',
                        )}
                    >
                        {label}
                    </p>
                    <p
                        className={clsx(
                            'font-bold text-foreground text-start tabular-nums truncate',
                            isSmall ? 'text-lg' : 'text-2xl landscape:text-xl',
                        )}
                        title={typeof value === 'string' ? value : undefined}
                    >
                        {value}
                    </p>
                    {subValue ? (
                        <p
                            className={clsx(
                                'text-muted-foreground text-start mt-0.5',
                                isSmall ? 'text-[11px]' : 'text-xs',
                            )}
                        >
                            {subValue}
                        </p>
                    ) : null}
                </div>
                {icon ? <div className="text-icon-muted shrink-0">{icon}</div> : null}
            </div>
            {caveat ? (
                <p className="text-[11px] text-muted-foreground mt-2 leading-snug" role="note">
                    {caveat}
                </p>
            ) : null}
        </Card>
    );
}
