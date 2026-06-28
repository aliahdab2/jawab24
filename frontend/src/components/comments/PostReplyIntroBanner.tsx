import { useTranslations } from 'next-intl';
import { Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { useTimedDismiss } from '@/hooks/useTimedDismiss';

// Dismiss is temporary so the intro re-appears and gives repeat exposure until
// the merchant actually sets up a Post Reply (one impression is easy to miss).
// The caller stops rendering it once the first Post Reply exists (see
// showPostReplyNewBadge), so it never nags after the feature has been used — this
// window only governs how long a manual ✕ dismiss lasts before it surfaces again.
const DISMISS_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

interface PostReplyIntroBannerProps {
  /** Open Post Reply setup for the first eligible post. */
  onSetup: () => void;
}

/**
 * First-run callout on the Comments page that teaches the Post Reply feature
 * (keyword-triggered auto-DM). The feature's per-post button is easy to miss, so
 * this explains the value once. The caller decides when to render it (only before
 * the first trigger exists); here we add manual, persisted dismissal.
 */
export function PostReplyIntroBanner({ onSetup }: PostReplyIntroBannerProps) {
  const t = useTranslations('comments');
  const { dismissed, dismiss } = useTimedDismiss({
    key: 'postReplyIntroDismissedAt',
    durationMs: DISMISS_DURATION_MS,
  });

  if (dismissed) return null;

  return (
    <div
      role="status"
      className="mb-3 sm:mb-5 p-3 sm:p-4 rounded-xl flex items-start gap-3 bg-brand-50 dark:bg-brand-900/20 border border-brand-300 dark:border-brand-700"
    >
      <Sparkles className="w-5 h-5 flex-shrink-0 mt-0.5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{t('postReplyIntroTitle')}</p>
        <p className="mt-0.5 text-xs sm:text-sm text-muted-foreground">{t('postReplyIntroText')}</p>
        <Button size="sm" variant="primary" onClick={onSetup} className="mt-2 text-xs">
          {t('postReplyIntroCta')}
        </Button>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('postReplyIntroDismiss')}
        className="flex-shrink-0 p-1.5 -m-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
