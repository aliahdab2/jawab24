import React from 'react';
import { CheckCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSwipeToDismiss } from '@/hooks/useSwipeToDismiss';
import { CommentCard, type CommentCardProps } from './CommentCard';

type SwipeableCommentCardProps = CommentCardProps;

/**
 * Wraps CommentCard with a swipe-to-handle gesture on mobile.
 * Swiping in either direction past the threshold calls onResolve and
 * collapses the card out — identical UX to SwipeableNotificationItem.
 *
 * Only active when onResolve is provided (unresolved comments only).
 * Disabled on sm+ screens where hover actions are available.
 */
export const SwipeableCommentCard = React.memo(function SwipeableCommentCard(
  props: SwipeableCommentCardProps
) {
  const t = useTranslations('comments');
  const swipeEnabled = !!props.onResolve;

  const { ref, isDismissing, shouldSuppressClick } = useSwipeToDismiss({
    onDismiss: () => props.onResolve?.(),
    enabled: swipeEnabled,
  });

  const handleClickCapture = (e: React.MouseEvent) => {
    if (shouldSuppressClick()) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={isDismissing ? { pointerEvents: 'none' } : undefined}
    >
      {/* Background revealed during swipe — shown on both sides, mobile only */}
      {swipeEnabled && (
        <div className="absolute inset-0 flex items-center justify-between px-5 bg-emerald-50 dark:bg-emerald-950/40 sm:hidden">
          <div className="flex items-center gap-2">
            <CheckCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              {t('resolve')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              {t('resolve')}
            </span>
            <CheckCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
        </div>
      )}

      {/* Foreground — swipeable layer; bg-card ensures semi-transparent attention
          cards don't show the swipe hint background at rest */}
      <div
        ref={ref}
        onClickCapture={handleClickCapture}
        className="relative z-10 rounded-2xl bg-card"
      >
        <CommentCard {...props} />
      </div>
    </div>
  );
});
