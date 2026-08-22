import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, BellRing } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { settingsApi } from '@/lib/api';
import { Button } from '@/components/ui';
import { SETTINGS_QUERY_KEY, useSettingsQuery } from '@/hooks/useSettingsQuery';
import type { Page } from '@jawab24/shared';

/**
 * The auto-reply row of the marketplace onboarding "done" step
 * (zid / salla / shopify — all three render this).
 *
 * Every new signup's workspace is deliberately seeded with auto-reply OFF
 * (D-025: a merchant must not auto-reply publicly before reviewing their
 * Business Info). The previous done-step hardcoded an unconditional
 * «الردود التلقائية مفعّلة» checkmark — a claim that read nothing and enabled
 * nothing, so every marketplace merchant finished onboarding being told
 * replies were on while their customers got silence.
 *
 * ⚠️ WHAT "ON" MEANS HERE. `messagesAutoReply` / `commentsAutoReply` are **gate
 * 5** of a six-gate chain (backend/docs/SETTINGS.md, "The gate chain"), and two
 * other gates can silence every reply on their own:
 *
 *   - **Gate 1, `pages.auto_reply_enabled`** sits ABOVE gate 5 and is absolute —
 *     "Page OFF = Jawab24 invisible: no reply, no flag, no notification." A page
 *     whose channel already used its free trial under another account is
 *     connected with it OFF (`services/pages.ts`, `autoReplyDisabledReason:
 *     'trial_block'`), which is reachable from exactly this flow. So the row
 *     reads the linked page too, and when the page master is off it says so
 *     instead of flipping the workspace switches — which would change nothing —
 *     and does NOT offer to flip the page itself, because that switch is an
 *     abuse guard, not a preference.
 *   - **Business hours.** Gate 5 is `isAutoReplyEnabledFromSettings`, which folds
 *     the masters with `businessHoursOnly` + the schedule. When that is on, the
 *     row qualifies its claim rather than promising round-the-clock replies.
 *
 * Reads and writes go through {@link useSettingsQuery}'s single key so the
 * fetch is deduped and the dashboard cannot keep rendering the pre-save value
 * (that hook's docblock is the contract; `staleTime` is 5 minutes).
 *
 * It never enables anything by itself: D-025's opt-in stands; the tap is the
 * merchant's explicit choice, made at the moment of highest intent.
 */
interface StoreAutoReplyRowProps {
  /** The page the merchant linked in the previous step, when there is one.
   *  `null`/absent = no page in scope, so gate 1 cannot be judged and is not
   *  claimed either way. */
  page?: Page | null;
}

export function StoreAutoReplyRow({ page = null }: StoreAutoReplyRowProps) {
  const t = useTranslations('onboarding');
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useSettingsQuery();
  const [enabling, setEnabling] = useState(false);

  const enable = async () => {
    setEnabling(true);
    try {
      await settingsApi.update({ messagesAutoReply: true, commentsAutoReply: true });
      // Required of every settings write: without it the dashboard the merchant
      // lands on next renders the cached pre-save value for up to 5 minutes.
      await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
    } catch {
      toast.error(t('storeAutoReplyEnableFailed'));
    } finally {
      setEnabling(false);
    }
  };

  if (isPending) {
    // A neutral placeholder — never claim a state we have not read, in text OR
    // in colour. Success chrome here would be the same lie, one beat earlier.
    return (
      <div
        className="flex items-center gap-3 p-3 rounded-xl border border-theme-border bg-muted"
        aria-busy="true"
      >
        <Loader2 className="w-5 h-5 animate-spin text-icon-muted flex-shrink-0" aria-hidden="true" />
      </div>
    );
  }

  // Gate 1 first — it outranks everything below it, and flipping the workspace
  // masters while it is off would leave the merchant told "on" and still silent.
  if (page && page.autoReplyEnabled === false) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border alert-warning">
        <BellRing className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium">{t('storeAutoReplyPageOff', { name: page.name })}</span>
      </div>
    );
  }

  // A failed read must never render as "on": offering the (idempotent) enable
  // button on an unknown state is safe; claiming active is not.
  const on = !isError && !!data?.messagesAutoReply && !!data?.commentsAutoReply;

  if (on) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border alert-success">
        <CheckCircle2 className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium">
          {data?.businessHoursOnly ? t('storeAutoReplyActiveHours') : t('storeAutoReplyActive')}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border alert-warning">
      <BellRing className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
      <span className="text-sm font-medium flex-1">{t('storeAutoReplyOff')}</span>
      {/* The shared Button, not a hand-rolled one: `loading` keeps the label
          mounted (opacity-0, still in the accessibility tree) so the button
          never loses its accessible name mid-write, and `btn-warning` is the
          AA-contrast pair for this row in both themes. */}
      <Button
        variant="warning"
        size="sm"
        onClick={enable}
        loading={enabling}
        className="flex-shrink-0"
      >
        {t('storeAutoReplyEnable')}
      </Button>
    </div>
  );
}
