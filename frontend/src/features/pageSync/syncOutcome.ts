/**
 * Page-sync outcome reporting — the single place that turns a refusal-carrying
 * sync outcome into merchant-visible messages.
 *
 * The backend answers a sync with several "we did NOT connect that page, and
 * here is why" outcomes (`skippedPages` / `takenPages` / `trialBlockedPages` /
 * `alreadyMemberOf`). Two routes produce them — `POST /pages/sync` and, as a
 * side effect of linking, `POST /auth/facebook/link`.
 *
 * ⚠️ Reporting happens on ONE page: `/pages`. The Facebook reconnect legs in
 * `auth/callback.tsx` do NOT render these messages — they hand the outcome over
 * with `stashPageSyncOutcome` and `/pages` reports it on arrival. That is
 * deliberate and load-bearing:
 *
 *  - the callback redirects to `/pages` under `finalLocale` (the ACCOUNT's
 *    language), which can differ from the locale the callback itself rendered
 *    in — reporting there produced an Arabic toast on an English page, inside an
 *    LTR Toaster;
 *  - the workspace store is not usable mid-auth, so the "Switch to ‹X›" action
 *    could not be offered at all;
 *  - and it keeps the 15–21 kB `pages` namespace off `/auth/callback`, which
 *    every Facebook login passes through to render a skeleton.
 */
import { toast } from 'sonner';
import type { PageSyncOutcome } from '@jawab24/shared';

export type { PageSyncOutcome };

type Translate = (key: string, values?: Record<string, string | number>) => string;

export type ReportPageSyncDeps = {
    /** `useTranslations('pages')`. */
    t: Translate;
    /** Active locale, for `Intl.ListFormat` page-name joining. */
    locale: string;
    /** Offered as a one-tap action when the conflicting pages sit in a workspace the user already belongs to. */
    onSwitchWorkspace: (workspaceId: string) => void;
};

/**
 * Join page names for prose. Falls back to a plain comma list rather than
 * throwing: `Intl.ListFormat` raises `RangeError` on a locale tag it cannot
 * parse, and losing the whole explanation over a formatting detail is exactly
 * the silence this module exists to end.
 */
const joinNames = (names: string[], locale: string): string => {
    try {
        return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names);
    } catch {
        return names.join(', ');
    }
};

/**
 * Surface every "not connected" outcome carried by a sync.
 *
 * Every message is `duration: Infinity` — each explains something the merchant
 * must act on (upgrade, subscribe, switch workspace), so it must not expire
 * before being read.
 */
export function reportPageSyncOutcome(data: PageSyncOutcome | undefined, deps: ReportPageSyncDeps): void {
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
            action: {
                label: t('switchWorkspaceCta', { workspaceName: memberHit.workspaceName }),
                onClick: () => onSwitchWorkspace(memberHit.workspaceId),
            },
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
