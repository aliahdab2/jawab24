import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, BellRing } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { settingsApi } from '@/lib/api';

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
 * This row reads the REAL state (GET /settings overlays the workspace store —
 * the same store the reply gate reads) and, when off, offers a one-tap enable
 * through the sanctioned PUT /settings path (dual-store write + cache
 * invalidation). It never enables anything by itself: D-025's opt-in stands;
 * the tap is the merchant's explicit choice, made at the moment of highest
 * intent.
 */
type RowState = 'loading' | 'on' | 'off' | 'enabling';

export function StoreAutoReplyRow() {
  const t = useTranslations('onboarding');
  const [state, setState] = useState<RowState>('loading');

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .get()
      .then((res) => {
        if (cancelled) return;
        const d = res.data as { messagesAutoReply?: boolean; commentsAutoReply?: boolean } | undefined;
        setState(d?.messagesAutoReply && d?.commentsAutoReply ? 'on' : 'off');
      })
      .catch(() => {
        // Unknown state must never render as "on" — offering the (idempotent)
        // enable button on a failed read is safe; claiming active is not.
        if (!cancelled) setState('off');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    setState('enabling');
    try {
      await settingsApi.update({ messagesAutoReply: true, commentsAutoReply: true });
      setState('on');
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
