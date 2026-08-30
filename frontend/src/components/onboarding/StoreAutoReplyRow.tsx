import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, BellRing, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { settingsApi, pagesApi } from '@/lib/api';
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
 * This row reads the REAL, EFFECTIVE state: the workspace masters (GET /settings
 * overlays the workspace store — the same store the reply gate reads) AND
 * whether at least one connected page is itself enabled. The masters alone
 * were not enough: on 2026-08-30 a Zid merchant pressed «تفعيل الآن», the
 * masters flipped on, and the row said «مفعّلة» while the one linked page stayed
 * `auto_reply_enabled=false` (its channel had used its free trial) — the D-026
 * class of defect, UI on while the pipeline is off. When off, it offers a
 * one-tap enable through the sanctioned PUT /settings path; when the page is
 * what is off, it says so and sends the merchant to Channels, where the page
 * toggle explains what it needs (a paid plan, when the trial is spent). It never
 * enables anything by itself: D-025's opt-in stands.
 */
type RowState = 'loading' | 'on' | 'off' | 'enabling' | 'pageOff';

/** At least one connected page will actually answer on some channel. */
export function anyPageReplying(pages: Page[]): boolean {
  return pages.some(
    (p) => Boolean(p.autoReplyEnabled) || Boolean(p.instagramAutoReplyEnabled) || Boolean(p.whatsappAutoReplyEnabled),
  );
}

/**
 * The effective row state from the two reads. A workspace with no page at all
 * has nothing to be "off" on the page side — the masters decide alone.
 */
export function deriveRowState(mastersOn: boolean, pages: Page[]): Exclude<RowState, 'loading' | 'enabling'> {
  if (!mastersOn) return 'off';
  if (pages.length > 0 && !anyPageReplying(pages)) return 'pageOff';
  return 'on';
}

export function StoreAutoReplyRow() {
  const t = useTranslations('onboarding');
  const [state, setState] = useState<RowState>('loading');

  const readState = useCallback(async (): Promise<void> => {
    const [settingsRes, pagesRes] = await Promise.all([
      settingsApi.get(),
      pagesApi.getAll().catch(() => null),
    ]);
    const d = settingsRes.data as { messagesAutoReply?: boolean; commentsAutoReply?: boolean } | undefined;
    const mastersOn = Boolean(d?.messagesAutoReply && d?.commentsAutoReply);
    const pages = (pagesRes?.data as Page[] | undefined) ?? [];
    setState(deriveRowState(mastersOn, pages));
  }, []);

  useEffect(() => {
    let cancelled = false;
    readState().catch(() => {
      // Unknown state must never render as "on" — offering the (idempotent)
      // enable button on a failed read is safe; claiming active is not.
      if (!cancelled) setState('off');
    });
    return () => {
      cancelled = true;
    };
  }, [readState]);

  const enable = async () => {
    setState('enabling');
    try {
      await settingsApi.update({ messagesAutoReply: true, commentsAutoReply: true });
      // Re-read rather than assume: the masters are on, but the PAGE may still
      // be off, and that is the state the merchant must be told about.
      await readState();
    } catch {
      setState('off');
      toast.error(t('storeAutoReplyEnableFailed'));
    }
  };

  if (state === 'loading') {
    // A brief neutral placeholder — never claim a state we have not read.
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border alert-success" aria-busy="true">
        <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" aria-hidden="true" />
      </div>
    );
  }

  if (state === 'on') {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border alert-success">
        <CheckCircle2 className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium">{t('storeAutoReplyActive')}</span>
      </div>
    );
  }

  if (state === 'pageOff') {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border alert-warning">
        <AlertTriangle className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium flex-1">{t('storeAutoReplyPageOff')}</span>
        <Link
          href="/pages"
          className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 flex-shrink-0 whitespace-nowrap"
        >
          {t('storeAutoReplyManageChannels')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border alert-warning">
      <BellRing className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
      <span className="text-sm font-medium flex-1">{t('storeAutoReplyOff')}</span>
      <button
        type="button"
        onClick={enable}
        disabled={state === 'enabling'}
        aria-busy={state === 'enabling'}
        className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60 flex-shrink-0"
      >
        {state === 'enabling' ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        ) : (
          t('storeAutoReplyEnable')
        )}
      </button>
    </div>
  );
}
