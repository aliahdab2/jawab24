import React from 'react';
import { CheckCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SwipeDismissWrapper } from '@/components/ui/SwipeDismissWrapper';
import { SwipeBothSidesLabel } from '@/components/ui/SwipeBothSidesLabel';
import { MessageCard, type MessageCardProps } from './MessageCard';

type SwipeableMessageCardProps = MessageCardProps;

export const SwipeableMessageCard = React.memo(function SwipeableMessageCard(
  props: SwipeableMessageCardProps
) {
  const t = useTranslations('messages');
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
      <MessageCard {...props} />
    </SwipeDismissWrapper>
  );
});
