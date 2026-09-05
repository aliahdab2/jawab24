import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import { AlertTriangle, Sparkles, MessageSquareOff, RefreshCw } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { Card, Button, UpgradeCTA, InfoPopover } from '@/components/ui';
import { BuyTopUpCTA } from '@/components/billing/BuyTopUpCTA';
import { useTimedDismiss } from '@/hooks/useTimedDismiss';
import { iosOr } from '@/lib/iosCopy';
import { formatQuotaResetDate } from '@/lib/formatDate';
import { resolveAiQuotaStatus, type UsageSummary } from '@jawab24/shared';

interface AiUsageWarningBannerProps {
    aiReplies: UsageSummary['aiReplies'];
    /** ISO timestamp when the current period resets (usage.currentPeriod.end). */
    resetsAt?: string;
    /** Plan slug — used to hide the top-up CTA for Free users (must subscribe first). */
    planSlug?: string;
    /** Billing rail — 'shopify' hides the Stripe top-up CTA (D-G). */
    paymentMethod?: string;
    /** A marketplace owns this account's paid plans (D-073) — hides the Stripe top-up CTA. */
    marketplaceBilled?: boolean;
    /** Current user's email — pre-fills the WhatsApp message in the top-up modal. */
    userEmail?: string;
    /**
     * Non-expiring top-up reply balance (usage.topup.balance). When the plan
     * quota is exhausted but this is > 0, Smart Replies keep flowing from it —
     * so the banner shows a calm "on top-up" notice instead of the red wall.
     */
    topupBalance?: number;
    /**
     * The reply gate's verdict (`usage.subscription.autoReply`) — the SAME
     * predicate the backend blocks on. When it refuses, no quota number can
     * describe the account correctly and this banner must say so.
     */
    autoReply?: UsageSummary['subscription']['autoReply'];
    /**
     * ISO instant coverage actually ended (`usage.subscription.entitlementEndsAt`).
     * Snapped for manual plans, so it can be ~24h earlier than `renewsAt` — which
     * is the whole reason the merchant read the cut-off as a day later than it was.
     */
    entitlementEndsAt?: string;
    /**
     * Customer messages and comments that arrived after coverage lapsed and were
     * never answered (`usage.subscription.autoReply.unansweredSinceBlock`).
     * Backend-computed, present only while the gate refuses.
     */
    unansweredSinceBlock?: number;
    /**
     * Why the gate refused (`usage.subscription.autoReply.cause`). An expired
     * trial is told "your free trial ended — choose a plan"; telling someone who
     * never subscribed to "renew" is the copy 19 of 20 blocked accounts on prod
     * were reading (2026-08-22).
     */
    cause?: 'trial_expired';
}

/**
 * Proactive banner that warns users as they approach or hit their monthly
 * AI-reply limit. Shown on the dashboard above the plan card.
 *
 * Quota states are derived from the shared plan+top-up runway policy
 * (`resolveAiQuotaStatus`), never from percent-of-plan-cap — the cap is a billing
 * boundary, and top-up carries replies past it.
 *
 * BILLING-PAUSED outranks every quota state, because when the subscription gate
 * refuses, the quota numbers stop describing reality: a lapsed manual plan closes
 * its usage window, `used` falls back to 0, and a quota-only banner reads that as
 * "healthy" and hides — which is exactly how a merchant sat on a green dashboard
 * with every reply frozen (2026-08-14). It is therefore driven by the gate verdict
 * the backend itself enforces, not by anything re-derived here.
 *
 * - Hidden for unlimited plans, below the near-wall threshold, AND for a near-cap
 *   merchant whose top-up balance comfortably absorbs the overflow (nothing stops).
 * - Violet warning approaching the real wall — swipe to dismiss for 24h.
 * - Info banner past the cap with a healthy balance — Smart Replies still send
 *   from top-up, so this is reassuring, not alarming, and swipe-dismissible for 24h.
 * - Violet warning past the cap with a nearly-drained balance — replies are about
 *   to stop, so it must NOT wear the calm styling.
 * - Red critical banner once plan and balance are both spent — not dismissible
 *   (Smart Replies are genuinely paused).
 *
 * The warning/top-up states can be swipe-dismissed (drag horizontally past
 * ~100px). The critical state is pinned — there's no gesture to hide it.
 */
export function AiUsageWarningBanner({ aiReplies, resetsAt, planSlug, paymentMethod, marketplaceBilled, userEmail, topupBalance, autoReply, entitlementEndsAt, unansweredSinceBlock, cause }: AiUsageWarningBannerProps) {
    const tSub = useTranslations('subscription');
    const locale = useLocale();

    // The gate has refused: replies are frozen for a BILLING reason, whatever the
    // quota says. Explicit `=== false` so an older API response (field absent)
    // leaves the banner on its pre-existing quota behaviour rather than alarming.
    const isBillingPaused = autoReply?.allowed === false;
    // Same block, different story: a trial that ran out has nothing to "renew".
    const isTrialEnded = isBillingPaused && cause === 'trial_expired';

    const { used, limit } = aiReplies;
    // The plan cap is a billing boundary, not the wall: canUseAiReplies falls
    // through to the top-up balance, so every state here is derived from the
    // shared runway policy (plan + top-up) instead of percent-of-cap. Without it
    // this banner alarmed a merchant at 87% of a 10,000 plan who had 9,417 top-up
    // replies banked — nothing was going to stop.
    const quota = resolveAiQuotaStatus({ used, limit, topupBalance: topupBalance ?? 0 });
    // Every quota state is suppressed while billing is paused. Not cosmetic: with
    // the usage window closed `used` reads 0, so the quota policy would classify a
    // frozen account as healthy and this banner would render nothing at all.
    // Plan quota AND balance both spent — Smart Replies really have paused.
    const isCritical = !isBillingPaused && quota.state === 'exhausted';
    // Past the cap with a real runway behind it: reassuring, not alarming.
    const onTopup = !isBillingPaused && quota.state === 'on_topup' && !quota.nearWall;
    // Past the cap but the balance is nearly gone. NOT the calm notice — promising
    // "no interruption" to a merchant with a handful of replies left is a lie.
    const isTopupLow = !isBillingPaused && quota.state === 'on_topup' && quota.nearWall;
    // Approaching the wall. A near-cap merchant whose balance covers the overflow
    // is deliberately NOT warned; one whose balance is too thin to change the
    // outcome (`nearWall`) still is.
    const isWarning = !isBillingPaused && (quota.state === 'near_cap'
        || (quota.state === 'near_cap_on_topup' && quota.nearWall));
    // Red styling covers both "replies have stopped" causes — quota spent, or
    // billing lapsed. They differ in copy and CTA, never in urgency.
    const isStopped = isBillingPaused || isCritical;
    // Pro is the top public tier, and Scale plans sit above it — both should be
    // pointed at the hidden high-volume plans rather than the public /pricing grid.
    const atTopPublicTier = planSlug === 'pro' || (planSlug?.startsWith('scale-') ?? false);

    // Separate dismiss keys per state so each re-shows independently: hitting the
    // limit re-shows even if the 80% warning was dismissed, the top-up notice
    // (no action needed) can be dismissed without affecting the warning, and the
    // balance running low re-shows even if the calm notice was dismissed earlier.
    const warning = useTimedDismiss({ key: 'aiUsageWarning80DismissedAt', durationMs: 24 * 60 * 60 * 1000 });
    const topupNotice = useTimedDismiss({ key: 'aiUsageOnTopupDismissedAt', durationMs: 24 * 60 * 60 * 1000 });
    const topupLowNotice = useTimedDismiss({ key: 'aiUsageTopupLowDismissedAt', durationMs: 24 * 60 * 60 * 1000 });

    // Swipe-to-dismiss replaces the old dismiss button. Only the non-critical
    // states are dismissible — the critical banner stays pinned because Smart
    // Replies are genuinely paused and the merchant must see it.
    const swipeable = isWarning || onTopup || isTopupLow;
    const dismiss = isWarning
        ? warning.dismiss
        : isTopupLow ? topupLowNotice.dismiss : topupNotice.dismiss;

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

    // Billing-paused bypasses the unlimited-plan exemption: an unmetered plan
    // still stops replying when the subscription lapses, and `limit === null`
    // must not swallow that.
    if (!isBillingPaused && (limit === null || (!isWarning && !isTopupLow && !onTopup && !isCritical))) return null;
    if (isWarning && warning.dismissed) return null;
    if (onTopup && topupNotice.dismissed) return null;
    if (isTopupLow && topupLowNotice.dismissed) return null;

    // With time: a merchant staring at a paused-replies banner needs to know
    // WHEN today/tomorrow it un-pauses, not just the calendar date.
    const resetDate = formatQuotaResetDate(resetsAt, locale, { withTime: true });
    // When billing lapsed, the honest date is when COVERAGE ended, not when the
    // quota window rolls. They are the same instant for a manual plan, and
    // printing it without a time is what let "14 August" read as all of the 14th.
    const coverageEndedDate = formatQuotaResetDate(entitlementEndsAt, locale, { withTime: true });

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

    // Three states, three semantic pairs in globals.css: stopped → rose
    // (`alert-critical`), on top-up → calm sky (`alert-on-topup`), and both
    // warning states (approaching the wall, nearly-drained balance) → amber in
    // light / soft violet in dark (`alert-usage-warning`). No raw palette
    // here: a hue lives in ONE place, and the lint rule holds that line.
    const palette = isStopped
        ? 'alert-critical'
        : onTopup
            ? 'alert-on-topup'
            : 'alert-usage-warning';

    const iconBg = isStopped
        ? 'icon-bg-critical'
        : onTopup
            ? 'icon-bg-on-topup'
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
            data-severity={isBillingPaused ? 'billing-paused' : isCritical ? 'critical' : onTopup ? 'topup' : isTopupLow ? 'topup-low' : 'warning'}
            role={isStopped ? 'alert' : undefined}
            onPointerDown={swipeable ? handlePointerDown : undefined}
        >
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 sm:p-5">
                <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center shrink-0', iconBg)}>
                    <StateIcon className="w-5 h-5" aria-hidden="true" />
                </div>

                <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm sm:text-base leading-tight">
                        {isBillingPaused
                            ? tSub(isTrialEnded ? 'limitBanner.trialEndedTitle' : 'limitBanner.billingPausedTitle')
                            : onTopup
                                ? tSub('limitBanner.onTopupTitle')
                                : isTopupLow
                                    ? tSub('limitBanner.topupLowTitle')
                                    : isCritical
                                        ? tSub('limitBanner.reachedTitle')
                                        : tSub('limitBanner.warningTitle')}
                    </p>
                    {/* Billing-paused gets its own body: the quota line would be a
                        lie here (the closed window reports 0 used), and `limit` is
                        null on unmetered plans, which this state no longer skips. */}
                    {isBillingPaused ? (
                        <p className="text-xs sm:text-sm opacity-80 mt-1">
                            <span className="block">
                                {/* iOS gets the same fact with the last clause removed: "until you
                                    choose a plan / renew" is a call to action for a purchase outside
                                    the app (App Store Guideline 3.1.1). One iOS key for both states —
                                    a trial that ran out and a subscription that ended say the same
                                    thing there, and there is nothing they may tell the merchant to do. */}
                                {tSub(isTrialEnded
                                    ? iosOr('limitBanner.pausedBodyIOS', 'limitBanner.trialEndedBody')
                                    : iosOr('limitBanner.pausedBodyIOS', 'limitBanner.billingPausedBody'))}
                            </span>
                            {coverageEndedDate && (
                                <span className="block">
                                    {tSub('limitBanner.coverageEndedOn', { date: coverageEndedDate })}
                                </span>
                            )}
                            {/* What the block has actually cost — in bold, because it is
                                the only line here the merchant cannot defer. `> 0` and not
                                just presence: "0 messages have gone unanswered" argues
                                FOR waiting, which is the opposite of the point. */}
                            {typeof unansweredSinceBlock === 'number' && unansweredSinceBlock > 0 && (
                                <span className="block font-semibold mt-1">
                                    {tSub('limitBanner.unansweredSinceBlock', { count: unansweredSinceBlock })}
                                </span>
                            )}
                        </p>
                    ) : (
                        <p className="text-xs sm:text-sm opacity-80 mt-1">
                            <span className="inline-flex items-center gap-1 flex-wrap">
                                <span>
                                    {onTopup
                                        ? tSub('limitBanner.onTopupUsage', { balance: (topupBalance ?? 0).toLocaleString(locale) })
                                        : isTopupLow
                                            ? tSub('limitBanner.topupLowUsage', { balance: (topupBalance ?? 0).toLocaleString(locale) })
                                            // `limit` is non-null here: the early
                                            // return above only lets a null limit
                                            // through in the billing-paused state,
                                            // which renders the other branch. No
                                            // `?? 0` — a silent "of 0" would hide a
                                            // broken narrowing instead of failing.
                                            : tSub('limitBanner.usage', {
                                                used: used.toLocaleString(locale),
                                                limit: Number(limit).toLocaleString(locale),
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
                    )}
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {/* iOS renders NO billing control and NO pointer to one: UpgradeCTA
                        returns null under App Store Guideline 3.1.1, and a text hint
                        naming the website was itself a call to action for a purchase
                        outside the app — the guideline forbids "explicit directions",
                        not just buttons. The title, body, coverage date and unanswered
                        count above state the fact; on iOS that is where it ends. */}
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
                        wrap them in an outer isIOSNative() check here.

                        Suppressed while billing is paused: the subscription gate runs
                        BEFORE any quota or balance is consulted, so a top-up buys a
                        merchant nothing here — it would take their money and leave the
                        replies just as frozen. Renewing is the only thing that lifts it. */}
                    {!isBillingPaused && (
                        <BuyTopUpCTA
                            planSlug={planSlug}
                            paymentMethod={paymentMethod}
                            marketplaceBilled={marketplaceBilled}
                            userEmail={userEmail}
                            variant="primary"
                            size="sm"
                        />
                    )}
                    {/* On top-up the merchant is covered — no upsell pressure; the plan
                        upgrade only shows when approaching or genuinely past the wall.
                        Pro (and Scale) customers are already at the top of the public
                        grid, so they're routed to the hidden high-volume plans instead
                        of the regular /pricing page.

                        When billing is paused this is the ONLY and PRIMARY action, and
                        it says "renew" rather than "upgrade": the merchant does not need
                        a bigger plan, they need the one they had back. */}
                    {!onTopup && (
                        <UpgradeCTA href={atTopPublicTier ? '/pricing/scale' : '/pricing'} className="block">
                            <Button
                                variant={isBillingPaused ? 'primary' : 'secondary'}
                                size="sm"
                                // Sparkles reads as an upsell; renewing after a freeze
                                // is a restore, not a celebration.
                                icon={isBillingPaused
                                    ? <RefreshCw className="w-4 h-4" aria-hidden="true" />
                                    : <Sparkles className="w-4 h-4" aria-hidden="true" />}
                            >
                                {isBillingPaused
                                    ? tSub(isTrialEnded ? 'limitBanner.subscribeNow' : 'limitBanner.renewNow')
                                    : tSub(atTopPublicTier ? 'limitBanner.highVolumeLink' : 'upgradePlan')}
                            </Button>
                        </UpgradeCTA>
                    )}
                </div>
            </div>
        </Card>
    );
}
