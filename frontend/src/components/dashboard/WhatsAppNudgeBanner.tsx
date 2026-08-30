import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, WhatsAppIcon } from '@/components/ui';
import { useTimedDismiss } from '@/hooks/useTimedDismiss';
import { isWhatsAppVisible } from '@/lib/featureFlags';
import type { Page } from '@jawab24/shared';

/**
 * WhatsApp launch announcement — appears only once Embedded Signup is
 * configured (env-gated, same check as the Connect button on /pages),
 * for owners who have a connected page but no WhatsApp yet.
 *
 * One long dismiss (1 year): it's an FYI, not a task. Deliberately NOT a
 * setup-checklist step — WhatsApp is optional, and an eternally-incomplete
 * step would keep the checklist nagging.
 */
export function WhatsAppNudgeBanner({ pages, isOwner, isAdmin, whatsappEntitled, unavailable }: { pages: Page[]; isOwner: boolean; isAdmin: boolean; whatsappEntitled: boolean; unavailable?: boolean }) {
    const t = useTranslations('dashboard');
    const { dismissed, dismiss } = useTimedDismiss({
        key: 'whatsappNudgeDismissedAt',
        durationMs: 365 * 24 * 60 * 60 * 1000,
    });

    const hasConnectedPage = pages.some(p => p.isConnected !== false);
    const hasWhatsApp = pages.some(p => p.whatsappConnected);

    // Canary-aware: during admin-only rollout the CTA (which deep-links to the
    // connect flow) must not show to non-admins. Plan-aware: don't announce a
    // launch to plans that can't use it (WhatsApp is Starter+; Basic excluded).
    // `unavailable`: a Zid account can never connect WhatsApp (D-117) — never
    // announce a launch for a channel the account cannot use.
    if (dismissed || !isOwner || !isWhatsAppVisible(isAdmin) || !whatsappEntitled || unavailable || !hasConnectedPage || hasWhatsApp) return null;

    return (
        <div className="flex items-start gap-3 p-4 rounded-2xl border bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 transition-all">
            <div className="w-9 h-9 rounded-xl bg-[#25D366] text-white flex items-center justify-center flex-shrink-0" aria-hidden="true">
                <WhatsAppIcon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                    {t('whatsappNudgeTitle')}
                </p>
                <p className="text-xs mt-0.5 text-emerald-700/80 dark:text-emerald-300/80">
                    {t('whatsappNudgeBody')}
                </p>
                <div className="flex items-center gap-3 mt-2">
                    <Link href="/pages">
                        <Button size="sm" variant="primary" className="text-xs">
                            {t('whatsappNudgeCta')}
                        </Button>
                    </Link>
                    <button
                        type="button"
                        onClick={dismiss}
                        className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                        {t('kbNudgeLater')}
                    </button>
                </div>
            </div>
        </div>
    );
}
