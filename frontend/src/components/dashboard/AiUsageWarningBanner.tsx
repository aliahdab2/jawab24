import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import { AlertTriangle, Sparkles, MessageSquareOff } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { Card, Button, UpgradeCTA, InfoPopover } from '@/components/ui';
import { BuyTopUpCTA } from '@/components/billing/BuyTopUpCTA';
import { useTimedDismiss } from '@/hooks/useTimedDismiss';
import { formatQuotaResetDate } from '@/lib/formatDate';
import type { UsageSummary } from '@jawab24/shared';

interface AiUsageWarningBannerProps {
    aiReplies: UsageSummary['aiReplies'];
    /** ISO timestamp when the current period resets (usage.currentPeriod.end). */
    resetsAt?: string;
    /** Plan slug — used to hide the top-up CTA for Free users (must subscribe first). */
    planSlug?: string;
    /** Current user's email — pre-fills the WhatsApp message in the top-up modal. */
    userEmail?: string;
    /**
     * Non-expiring top-up reply balance (usage.topup.balance). When the plan
     * quota is exhausted but this is > 0, Smart Replies keep flowing from it —
     * so the banner shows a calm "on top-up" notice instead of the red wall.
     */
    topupBalance?: number;
}

/**
 * Proactive banner that warns users as they approach or hit their monthly
 * AI-reply limit. Shown on the dashboard above the plan card.
 *
 * - Hidden below 80% or for unlimited plans (limit === null).
 * - Violet warning at 80–99% — swipe to dismiss for 24h.
 * - Info banner at >=100% WITH a top-up balance — Smart Replies still send
 *   from top-up, so this is reassuring, not alarming, and swipe-dismissible for 24h.
 * - Red critical banner at >=100% with NO top-up balance — not dismissible
 *   (Smart Replies are genuinely paused).
 *
 * The warning/top-up states can be swipe-dismissed (drag horizontally past
 * ~100px). The critical state is pinned — there's no gesture to hide it.
 */
export function AiUsageWarningBanner({ aiReplies, resetsAt, planSlug, userEmail, topupBalance }: AiUsageWarningBannerProps) {
    const tSub = useTranslations('subscription');
    const locale = useLocale();

    const { used, limit, percentUsed } = aiReplies;
    const limitReached = limit !== null && percentUsed >= 100;
    // Top-up balance keeps Smart Replies running past the plan wall — a positive
    // balance turns the "limit reached" state into a calm informational one.
    const onTopup = limitReached && (topupBalance ?? 0) > 0;
    const isCritical = limitReached && !onTopup;
    const isWarning = limit !== null && percentUsed >= 80 && percentUsed < 100;
    // Pro is the top public tier, and Scale plans sit above it — both should be
    // pointed at the hidden high-volume plans rather than the public /pricing grid.
    const atTopPublicTier = planSlug === 'pro' || (planSlug?.startsWith('scale-') ?? false);

    // Separate dismiss keys per state so each re-shows independently: hitting the
    // limit re-shows even if the 80% warning was dismissed, and the top-up notice
    // (no action needed) can be dismissed without affecting the warning.
    const warning = useTimedDismiss({ key: 'aiUsageWarning80DismissedAt', durationMs: 24 * 60 * 60 * 1000 });
    const topupNotice = useTimedDismiss({ key: 'aiUsageOnTopupDismissedAt', durationMs: 24 * 60 * 60 * 1000 });

    // Swipe-to-dismiss replaces the old dismiss button. Only the non-critical
    // states are dismissible — the critical banner stays pinned because Smart
    // Replies are genuinely paused and the merchant must see it.
    const swipeable = isWarning || onTopup;
    const dismiss = isWarning ? warning.dismiss : topupNotice.dismiss;

    const startXRef = useRef(0);
    const [dragX, setDragX] = useState(0);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        if (!isDragging) return;
        const handleMove = (e: PointerEvent) => setDragX(e.clientX - startXRef.current);
        const handleUp = (e: PointerEvent) => {
            const dx = e.clientX - startXRef.current;
            setIsDragging(false);
            if (Math.abs(dx) > 100) {
                // Past the threshold: slide fully off-screen in the drag direction,
                // then persist the 24h dismissal once the 0.3s exit animation has
                // played (calling dismiss() immediately would unmount mid-animation).
                setDragX(dx > 0 ? window.innerWidth : -window.innerWidth);
                window.setTimeout(dismiss, 300);
            } else {
                // Released short of the threshold: snap back to rest.
                setDragX(0);
            }
        };
        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
        window.addEventListener('pointercancel', handleUp);
        return () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            window.removeEventListener('pointercancel', handleUp);
        };
    }, [isDragging, dismiss]);

    if (limit === null || (!isWarning && !limitReached)) return null;
    if (isWarning && warning.dismissed) return null;
    if (onTopup && topupNotice.dismissed) return null;

    const resetDate = formatQuotaResetDate(resetsAt, locale);

    const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!swipeable) return;
        startXRef.current = e.clientX;
        setIsDragging(true);
    };

    // Fade proportionally to the drag distance; fully transparent by the time
    // it has slid out (clamped at 250px so the snap-back range fades gently).
    const dragOpacity = 1 - Math.min(Math.abs(dragX) / 250, 1);
    // Inline style is now purely the swipe transform — colors live in themed
    // semantic classes (palette/iconBg) so they adapt to light vs dark.
    const cardStyle: CSSProperties | undefined = swipeable
        ? {
            transform: `translateX(${dragX}px)`,
            opacity: dragOpacity,
            // Drives snap-back / slide-out; suppressed mid-drag so the banner
            // tracks the pointer 1:1 instead of lagging behind by 0.3s.
            transition: isDragging ? 'none' : 'transform 0.3s ease, opacity 0.3s ease',
            cursor: isDragging ? 'grabbing' : 'grab',
            // Let the page scroll vertically; we own horizontal gestures.
            touchAction: 'pan-y',
        }
        : undefined;

    // Warning (80–99%) is amber in light / soft violet in dark — see the
    // `.alert-usage-warning` / `.icon-bg-usage-warning` classes in globals.css.
    const palette = isCritical
        ? 'bg-rose-50 text-rose-900 border-rose-200 border-s-rose-500 dark:bg-rose-900 dark:text-rose-200 dark:border-rose-700/60'
        : onTopup
            ? 'bg-sky-50 text-sky-900 border-sky-200 border-s-sky-500 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-700/60'
            : 'alert-usage-warning';

    const iconBg = isCritical
        ? 'bg-rose-200/50 text-rose-600 dark:bg-rose-800/40 dark:text-rose-400'
        : onTopup
            ? 'bg-sky-200/50 text-sky-700 dark:bg-sky-800/40 dark:text-sky-400'
            : 'icon-bg-usage-warning';

    const StateIcon = onTopup ? Sparkles : AlertTriangle;

    return (
        <Card
            className={clsx(
                'mb-6 overflow-hidden border border-s-4',
                palette,
            )}
            style={cardStyle}
            padding="none"
            data-testid="ai-usage-warning-banner"
            data-severity={isCritical ? 'critical' : onTopup ? 'topup' : 'warning'}
            onPointerDown={swipeable ? handlePointerDown : undefined}
        >
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 sm:p-5">
                <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center shrink-0', iconBg)}>
                    <StateIcon className="w-5 h-5" aria-hidden="true" />
                </div>

                <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm sm:text-base leading-tight">
                        {onTopup
                            ? tSub('limitBanner.onTopupTitle')
                            : isCritical
                                ? tSub('limitBanner.reachedTitle')
                                : tSub('limitBanner.warningTitle')}
                    </p>
                    <p className="text-xs sm:text-sm opacity-80 mt-1">
                        <span className="inline-flex items-center gap-1 flex-wrap">
                            <span>
                                {onTopup
                                    ? tSub('limitBanner.onTopupUsage', { balance: (topupBalance ?? 0).toLocaleString(locale) })
                                    : tSub('limitBanner.usage', {
                                        used: used.toLocaleString(locale),
                                        limit: limit.toLocaleString(locale),
                                    })}
                            </span>
                            <InfoPopover
                                label={tSub('limitBanner.scopeTooltip')}
                                panelWidth="md"
                                triggerClassName="opacity-70"
                            >
                                {tSub('limitBanner.scopeTooltip')}
                            </InfoPopover>
                        </span>
                        {/* Reset date on its own line — no separator dot (reads cleaner). */}
                        {resetDate && (
                            <span className="block">
                                {tSub('limitBanner.resetsOn', { date: resetDate })}
                            </span>
                        )}
                    </p>
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {/* Customize-fallback shortcut surfaces only when Smart Replies are
                        genuinely paused (no top-up). On top-up the fallback never fires,
                        so prompting the merchant to configure it would mislead. Visible on
                        iOS too (informational, not a billing action). */}
                    {isCritical && (
                        <Link href="/settings#limit-fallback-message">
                            <Button
                                variant="secondary"
                                size="sm"
                                icon={<MessageSquareOff className="w-4 h-4" aria-hidden="true" />}
                            >
                                {tSub('limitBanner.customizeFallback')}
                            </Button>
                        </Link>
                    )}
                    {/* Top-up CTA appears first — smaller commitment, direct answer
                        to "I hit my limit, how do I keep going?". Plan upgrade comes
                        second for users who need a structural change. Both CTAs
                        self-gate on iOS (App Store Guideline 3.1.1), so we don't
                        wrap them in an outer isIOSNative() check here. */}
                    <BuyTopUpCTA
                        planSlug={planSlug}
                        userEmail={userEmail}
                        variant="primary"
                        size="sm"
                    />
                    {/* On top-up the merchant is covered — no upsell pressure; the plan
                        upgrade only shows when approaching or genuinely past the wall.
                        Pro (and Scale) customers are already at the top of the public
                        grid, so they're routed to the hidden high-volume plans instead
                        of the regular /pricing page. */}
                    {!onTopup && (
                        <UpgradeCTA href={atTopPublicTier ? '/pricing/scale' : '/pricing'} className="block">
                            <Button
                                variant="secondary"
                                size="sm"
                                icon={<Sparkles className="w-4 h-4" />}
                            >
                                {tSub(atTopPublicTier ? 'limitBanner.highVolumeLink' : 'upgradePlan')}
                            </Button>
                        </UpgradeCTA>
                    )}
                </div>
            </div>
        </Card>
    );
}
