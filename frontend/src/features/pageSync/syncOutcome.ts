/**
 * Page-sync outcome reporting — the single place that turns a `POST /pages/sync`
 * response into merchant-visible messages.
 *
 * Why this is a module and not a block inside `pages.tsx`: the backend answers a
 * sync with several "we did NOT connect that page, and here is why" outcomes
 * (`skippedPages` / `takenPages` / `trialBlockedPages` / `alreadyMemberOf`). For
 * a long time only `pages.tsx` knew how to read them, so the SECOND caller — the
 * Facebook reconnect leg in `auth/callback.tsx` — discarded the whole body, and
 * the merchant was left with fewer pages than they granted and no reason given
 * (observed 2026-09-03: a Starter workspace at `max_pages = 1` reconnected, the
 * backend correctly refused the second page with `skipReason: 'page_limit'`, and
 * nothing was ever shown).
 *
 * Keeping the interpretation here means a caller gets the explanation by
 * construction rather than by remembering to write it again.
 */
import { toast } from 'sonner';
import type { NoPagesReason } from '@jawab24/shared';

export type PageSyncResponse = {
    reason?: NoPagesReason | null;
    takenCount?: number;
    takenPages?: { pageName: string }[];
    alreadyMemberOf?: { workspaceId: string; workspaceName: string; role: string; pageName: string }[];
    trialBlockedCount?: number;
    skippedCount?: number;
    skippedPages?: { pageName: string }[];
    skipReason?: 'subscription_inactive' | 'page_limit';
    pageLimit?: number | null;
};

type Translate = (key: string, values?: Record<string, string | number>) => string;

export type ReportPageSyncDeps = {
    /** `useTranslations('pages')` — callers must load the `pages` namespace. */
    t: Translate;
    /** Active locale, for `Intl.ListFormat` page-name joining. */
    locale: string;
    /**
     * Offered as a one-tap action when the conflicting pages sit in a workspace
     * the user already belongs to. Omit where switching isn't possible (e.g.
     * mid-auth, before the workspace store is usable) and the toast degrades to
     * a plain warning rather than offering an action that cannot work.
     */
    onSwitchWorkspace?: (workspaceId: string) => void;
};

const joinNames = (names: string[], locale: string): string =>
    new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names);

/**
 * Surface every "not connected" outcome carried by a sync response.
 *
 * Every message is `duration: Infinity` — each explains something the merchant
 * must act on (upgrade, subscribe, switch workspace), so it must not expire
 * before being read.
 */
export function reportPageSyncOutcome(data: PageSyncResponse | undefined, deps: ReportPageSyncDeps): void {
    if (!data) return;
    const { t, locale, onSwitchWorkspace } = deps;

    // If any of the conflicting pages live in workspaces the user is already
    // a member of, surface a one-tap switch instead of the generic "ask the
    // owner to invite you" warning. We use the first match — typically all
    // conflicts route to the same workspace anyway (a user only has one or
    // two workspace memberships in practice).
    const memberHit = data.alreadyMemberOf?.[0];
    if (memberHit) {
        toast.warning(t('pageTakenInWorkspace', {
            count: data.alreadyMemberOf!.length,
            workspaceName: memberHit.workspaceName,
        }), {
            duration: Infinity,
            ...(onSwitchWorkspace
                ? {
                    action: {
                        label: t('switchWorkspaceCta', { workspaceName: memberHit.workspaceName }),
                        onClick: () => onSwitchWorkspace(memberHit.workspaceId),
                    },
                }
                : {}),
        });
    } else if (data.takenCount && data.takenCount > 0) {
        // Held by a workspace the user is NOT in. Name the pages so the merchant
        // knows exactly what was withheld — never the holding account (D-039).
        const takenNames = (data.takenPages ?? []).map(p => p.pageName);
        toast.warning(t('pageTakenWarning', {
            count: data.takenCount,
            pageNames: joinNames(takenNames, locale),
        }), { duration: Infinity });
    }

    // Page(s) connected but auto-reply kept off because the channel already
    // used its free trial under another account. Prompt the user to subscribe.
    if (data.trialBlockedCount && data.trialBlockedCount > 0) {
        toast.warning(t('pageTrialUsedWarning', { count: data.trialBlockedCount }), { duration: Infinity });
    }

    // Page(s) REFUSED at connect because the plan's page limit was reached.
    // Named explicitly so the merchant knows exactly which pages were left
    // out — without this they'd just see fewer pages than they granted.
    if (data.skippedCount && data.skippedCount > 0) {
        const pageNames = joinNames((data.skippedPages ?? []).map(p => p.pageName), locale);
        if (data.skipReason === 'subscription_inactive') {
            // Trial already used (returning identity) — NOT a page-count limit, so
            // don't tell them to "upgrade for more pages"; they need to subscribe.
            toast.warning(t('trialUsedSkippedWarning', { count: data.skippedCount, pageNames }), { duration: Infinity });
        } else {
            toast.warning(t('pageLimitSkippedWarning', {
                count: data.skippedCount,
                pageNames,
                limit: data.pageLimit ?? 1,
            }), { duration: Infinity });
        }
    }
}
