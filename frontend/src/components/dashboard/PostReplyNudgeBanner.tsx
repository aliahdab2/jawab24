import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { PostReplyIcon } from '@/utils/postReply';
import { useTimedDismiss } from '@/hooks/useTimedDismiss';
import { deriveSetupState } from '@/utils/setupChecklist';
import type { Page, UsageSummary } from '@jawab24/shared';

/**
 * "Try Post Reply" nudge — the discovery surface for Post Reply, which is otherwise
 * only reachable from inside the Comments inbox. Appears once the core setup checklist
 * is complete (so it takes the checklist's slot, never competes with it) and no post
 * yet has a trigger; disappears for good once the merchant configures their first one.
 *
 * One long dismiss (1 year): it's an FYI, not a task. Deliberately NOT a
 * setup-checklist step — Post Reply is optional, and an eternally-incomplete step
 * would keep the checklist nagging (same rationale as WhatsAppNudgeBanner).
 */
export function PostReplyNudgeBanner({
    pages,
    usage,
    isOwner,
    onTry,
}: {
    pages: Page[];
    usage: UsageSummary | null;
    isOwner: boolean;
    /** Open the post picker (owned by usePostReplySetup on the host page). */
    onTry: () => void;
}) {
    const t = useTranslations('dashboard');
    const { dismissed, dismiss } = useTimedDismiss({
        key: 'postReplyNudgeDismissedAt',
        durationMs: 365 * 24 * 60 * 60 * 1000,
    });

    const setup = deriveSetupState(pages, usage);
    const alreadyUsingPostReply = pages.some((p) => p.hasPostReplyTrigger);

    // Only once setup is finished, only if not already using Post Reply, owner-only.
    if (dismissed || !isOwner || !setup.allDone || alreadyUsingPostReply) return null;

    return (
        <div className="flex items-start gap-3 p-4 rounded-2xl border bg-indigo-50/60 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800 transition-all">
            <div className="w-9 h-9 rounded-xl bg-indigo-500 text-white flex items-center justify-center flex-shrink-0" aria-hidden="true">
                <PostReplyIcon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
                    {t('postReplyNudgeTitle')}
                </p>
                <p className="text-xs mt-0.5 text-indigo-700/80 dark:text-indigo-300/80">
                    {t('postReplyNudgeBody')}
                </p>
                <div className="flex items-center gap-3 mt-2">
                    <Button size="sm" variant="primary" className="text-xs" onClick={onTry}>
                        {t('postReplyNudgeCta')}
                    </Button>
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
