import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { Button } from '@/components/ui';
import { PostReplyIcon, postReplyIconClass } from '@/utils/postReply';

// Educational intro shown on the Comments page until the merchant adopts Post Reply.
// Strategy: show it up to MAX_SHOWS times (one impression is easy to miss) so we're
// confident they've seen it; if they still haven't used the feature, postpone for
// ~6 months, then run another round. A manual ✕ also postpones ~6 months.
// (Once a Post Reply actually exists, the caller stops rendering this entirely —
// see showPostReplyNewBadge in comments.tsx — so success also stops the intro.)
const STORAGE_KEY = 'postReplyIntro';
const MAX_SHOWS = 3;
const POSTPONE_MS = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 months

interface IntroState {
  /** Impressions in the current cycle (0..MAX_SHOWS). */
  count: number;
  /** Epoch ms before which the intro stays hidden; null when not postponed. */
  postponedUntil: number | null;
}

function readState(): IntroState {
  if (typeof window === 'undefined') return { count: 0, postponedUntil: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { count: 0, postponedUntil: null };
    const s = JSON.parse(raw) as Partial<IntroState>;
    return {
      count: typeof s.count === 'number' && s.count > 0 ? s.count : 0,
      postponedUntil: typeof s.postponedUntil === 'number' ? s.postponedUntil : null,
    };
  } catch {
    return { count: 0, postponedUntil: null };
  }
}

function writeState(state: IntroState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* localStorage unavailable — degrade silently (just don't persist) */
  }
}

interface PostReplyIntroBannerProps {
  /** Open Post Reply setup for the first eligible post. */
  onSetup: () => void;
}

/**
 * First-run callout on the Comments page that teaches the Post Reply feature
 * (keyword-triggered auto-reply). The per-post button is easy to miss, so this
 * explains the value a few times, then backs off. The caller decides WHEN to
 * render it (only before the first trigger exists); here we cap the impressions
 * and handle the ~6-month re-engagement window + manual dismissal.
 */
export function PostReplyIntroBanner({ onSetup }: PostReplyIntroBannerProps) {
  const t = useTranslations('comments');
  // Resolve visibility once at mount so counting this view can't hide it mid-render.
  const [visibleAtMount] = useState(() => {
    const { count, postponedUntil } = readState();
    // Postponed: show only once the cooldown has elapsed (then it's a fresh cycle).
    if (postponedUntil !== null) return Date.now() >= postponedUntil;
    return count < MAX_SHOWS;
  });
  const [dismissed, setDismissed] = useState(false);

  // Count this impression at most once per browser session, so re-renders or quick
  // re-navigation within a single visit don't burn through the cap.
  useEffect(() => {
    if (!visibleAtMount) return;
    try {
      if (sessionStorage.getItem(STORAGE_KEY)) return;
      sessionStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* sessionStorage unavailable — fall through and still count the impression */
    }
    const { count, postponedUntil } = readState();
    // A lapsed cooldown starts a fresh cycle.
    const base = postponedUntil !== null && Date.now() >= postponedUntil ? 0 : count;
    const nextCount = base + 1;
    writeState({
      count: nextCount,
      // After the final allowed show, postpone the next round by ~6 months.
      postponedUntil: nextCount >= MAX_SHOWS ? Date.now() + POSTPONE_MS : null,
    });
  }, [visibleAtMount]);

  if (dismissed || !visibleAtMount) return null;

  const handleDismiss = () => {
    // A manual dismiss postpones the next round by ~6 months.
    writeState({ count: MAX_SHOWS, postponedUntil: Date.now() + POSTPONE_MS });
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className="mb-3 sm:mb-5 p-3 sm:p-4 rounded-xl flex items-start gap-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-300 dark:border-indigo-700"
    >
      <PostReplyIcon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${postReplyIconClass}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{t('postReplyIntroTitle')}</p>
        <p className="mt-0.5 text-xs sm:text-sm text-muted-foreground">{t('postReplyIntroText')}</p>
        <Button size="sm" variant="primary" onClick={onSetup} className="mt-2 text-xs">
          {t('postReplyIntroCta')}
        </Button>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t('postReplyIntroDismiss')}
        className="flex-shrink-0 p-1.5 -m-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
