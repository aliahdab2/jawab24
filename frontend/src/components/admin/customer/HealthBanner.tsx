import React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import clsx from 'clsx';
import { Card } from '@/components/ui';
import type { HealthFlag, FlagSeverity } from './types';

interface Props {
    flags: HealthFlag[];
}

/**
 * Top-of-page diagnostic summary for the support console. Turns the raw config
 * into "what's wrong / worth acting on" so an agent can help a merchant without
 * reading every field. Red = replies broken/silent, yellow = degrading, info =
 * context. No red/yellow → a single "healthy" chip.
 */
export function HealthBanner({ flags }: Props) {
    const t = useTranslations('admin');

    // Resolve a flag to its translated sentence. `merchant_dormant` with days=-1
    // means "never seen" — a distinct message rather than "inactive for -1 days".
    const flagText = (flag: HealthFlag): string => {
        if (flag.key === 'merchant_dormant' && flag.meta?.days === -1) {
            return t('customer.flag_merchant_never_seen');
        }
        const key = `customer.flag_${flag.key}` as Parameters<typeof t>[0];
        return t(key, flag.meta as Record<string, string | number>);
    };

    const red = flags.filter(f => f.severity === 'red');
    const yellow = flags.filter(f => f.severity === 'yellow');
    const info = flags.filter(f => f.severity === 'info');

    const ICONS: Record<FlagSeverity, typeof AlertCircle> = {
        red: AlertCircle,
        yellow: AlertTriangle,
        info: Info,
    };

    const renderRow = (flag: HealthFlag, idx: number) => {
        const Icon = ICONS[flag.severity];
        const tone =
            flag.severity === 'red' ? 'text-red-600 dark:text-red-400'
                : flag.severity === 'yellow' ? 'text-amber-600 dark:text-amber-400'
                    : 'text-muted-foreground';
        return (
            <li key={`${flag.key}-${flag.pageId ?? ''}-${idx}`} className="flex items-start gap-2">
                <Icon className={clsx('w-4 h-4 mt-0.5 shrink-0', tone)} aria-hidden="true" />
                <span className="text-sm text-foreground" dir="auto">
                    {flagText(flag)}
                    {flag.pageName && (
                        <span className="ms-2 inline-flex px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground align-middle" dir="auto">
                            {flag.pageName}
                        </span>
                    )}
                </span>
            </li>
        );
    };

    if (red.length === 0 && yellow.length === 0) {
        return (
            <div className="flex items-center gap-2 rounded-lg px-4 py-3 status-success border">
                <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span className="text-sm font-medium">{t('customer.healthHealthy')}</span>
            </div>
        );
    }

    return (
        <Card className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" aria-hidden="true" />
                {t('customer.healthTitle')}
            </h2>

            {red.length > 0 && (
                <ul className="space-y-2">{red.map(renderRow)}</ul>
            )}

            {yellow.length > 0 && (
                <ul className="space-y-2 pt-2 border-t border-theme-border">{yellow.map(renderRow)}</ul>
            )}

            {info.length > 0 && (
                <ul className="space-y-1.5 pt-2 border-t border-theme-border">
                    {info.map(renderRow)}
                </ul>
            )}
        </Card>
    );
}
