import React from 'react';
import { CheckCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SwipeDismissWrapper } from '@/components/ui/SwipeDismissWrapper';
import { SwipeBothSidesLabel } from '@/components/ui/SwipeBothSidesLabel';
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

  return (
    <SwipeDismissWrapper
      onDismiss={() => props.onResolve?.()}
      enabled={swipeEnabled}
      className="rounded-2xl"
      foregroundClassName="z-10 rounded-2xl bg-card"
      background={
        <SwipeBothSidesLabel
          icon={<CheckCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
          label={t('resolve')}
          className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 sm:hidden"
        />
      }
    >
      <CommentCard {...props} />
    </SwipeDismissWrapper>
  );
});
