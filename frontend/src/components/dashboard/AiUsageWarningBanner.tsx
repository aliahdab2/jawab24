import clsx from 'clsx';
import Link from 'next/link';
import { AlertTriangle, Sparkles, Info, MessageSquareOff } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { Card, Button, UpgradeCTA } from '@/components/ui';
import { useTimedDismiss } from '@/hooks/useTimedDismiss';
import { isIOSNative } from '@/lib/capacitor';
import type { UsageSummary } from '@jawab24/shared';

interface AiUsageWarningBannerProps {
    aiReplies: UsageSummary['aiReplies'];
    /** ISO timestamp when the current period resets (usage.currentPeriod.end). */
    resetsAt?: string;
}

/**
 * Proactive banner that warns users as they approach or hit their monthly
 * AI-reply limit. Shown on the dashboard above the plan card.
 *
 * - Hidden below 80% or for unlimited plans (limit === null).
 * - Amber warning at 80–99% — dismissible for 24h.
 * - Red critical banner at >=100% — not dismissible (auto-reply is paused).
 */
export function AiUsageWarningBanner({ aiReplies, resetsAt }: AiUsageWarningBannerProps) {
    const tSub = useTranslations('subscription');
    const locale = useLocale();

    const { used, limit, percentUsed } = aiReplies;
    const isLimitReached = limit !== null && percentUsed >= 100;
    const isWarning = limit !== null && percentUsed >= 80 && percentUsed < 100;

    // Separate dismiss key per severity so hitting the limit re-shows even if
    // the user dismissed the 80% warning earlier in the period.
    const { dismissed, dismiss } = useTimedDismiss({
        key: 'aiUsageWarning80DismissedAt',
        durationMs: 24 * 60 * 60 * 1000,
    });

    if (limit === null || (!isWarning && !isLimitReached)) return null;
    if (isWarning && dismissed) return null;

    const resetDate = resetsAt
        ? new Date(resetsAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
        : null;

    const palette = isLimitReached
        ? 'bg-rose-50 text-rose-900 border-rose-200 border-s-rose-500 dark:bg-rose-900 dark:text-rose-200 dark:border-rose-700/60'
        : 'bg-amber-50 text-amber-900 border-amber-200 border-s-amber-500 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700/60';

    const iconBg = isLimitReached
        ? 'bg-rose-200/50 text-rose-600 dark:bg-rose-800/40 dark:text-rose-400'
        : 'bg-amber-200/50 text-amber-700 dark:bg-amber-800/40 dark:text-amber-400';

    return (
        <Card
            className={clsx(
                'mb-6 overflow-hidden border border-s-4',
                palette,
            )}
            padding="none"
            data-testid="ai-usage-warning-banner"
            data-severity={isLimitReached ? 'critical' : 'warning'}
        >
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 sm:p-5">
                <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center shrink-0', iconBg)}>
                    <AlertTriangle className="w-5 h-5" aria-hidden="true" />
                </div>

                <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm sm:text-base leading-tight">
                        {isLimitReached ? tSub('limitBanner.reachedTitle') : tSub('limitBanner.warningTitle')}
                    </p>
                    <p className="text-xs sm:text-sm opacity-80 mt-1 inline-flex items-center gap-1 flex-wrap">
                        <span>
                            {tSub('limitBanner.usage', {
                                used: used.toLocaleString(locale),
                                limit: limit.toLocaleString(locale),
                            })}
                            {resetDate && (
                                <>
                                    {' · '}
                                    {tSub('limitBanner.resetsOn', { date: resetDate })}
                                </>
                            )}
                        </span>
                        <span className="relative group inline-flex">
                            <Info className="w-3.5 h-3.5 opacity-70 cursor-help" aria-label={tSub('limitBanner.scopeTooltip')} />
                            <span className="absolute bottom-full start-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 text-[11px] font-normal text-white bg-surface-800 dark:bg-surface-200 dark:text-surface-900 rounded-md shadow-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none w-56 text-center z-10 leading-snug">
                                {tSub('limitBanner.scopeTooltip')}
                            </span>
                        </span>
                    </p>
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {/* Customize-fallback shortcut surfaces only at the wall — at 80% the merchant
                        should still upgrade rather than configure the post-limit message. Visible on
                        iOS too (informational, not a billing action). */}
                    {/* Custom-styled to harmonize with the rose alert palette —
                        the default Button secondary variant uses bg-card which clashes
                        on this red banner. Inherits the banner's rose tone instead. */}
                    {isLimitReached && (
                        <Link
                            href="/settings#limit-fallback-message"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap bg-rose-100 text-rose-800 hover:bg-rose-200 dark:bg-rose-900/40 dark:text-rose-200 dark:hover:bg-rose-900/60 transition-colors"
                        >
                            <MessageSquareOff className="w-3.5 h-3.5" aria-hidden="true" />
                            {tSub('limitBanner.customizeFallback')}
                        </Link>
                    )}
                    {/* Upgrade CTA hidden on iOS native (App Store Guideline 3.1.1). */}
                    {!isIOSNative() && (
                        <>
                            <UpgradeCTA className="block">
                                <Button
                                    variant="primary"
                                    size="sm"
                                    icon={<Sparkles className="w-4 h-4" />}
                                >
                                    {tSub('upgradePlan')}
                                </Button>
                            </UpgradeCTA>
                            {isWarning && (
                                <button
                                    type="button"
                                    onClick={dismiss}
                                    className="text-xs font-semibold opacity-70 hover:opacity-100 underline px-2 py-1"
                                    aria-label={tSub('limitBanner.dismissLabel')}
                                >
                                    {tSub('limitBanner.dismiss')}
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </Card>
    );
}
