import React from 'react';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SwipeDismissWrapper } from './SwipeDismissWrapper';
import { SwipeBothSidesLabel } from './SwipeBothSidesLabel';

interface SwipeableNotificationItemProps {
  children: React.ReactNode;
  onDismiss: () => void;
  enabled?: boolean;
  className?: string;
}

/**
 * Wraps a notification item with swipe-to-dismiss gesture support.
 * Reveals a brand-colored background with "Mark as read" label during swipe.
 * Handles slide-out + height-collapse animation on dismiss.
 */
export function SwipeableNotificationItem({
  children,
  onDismiss,
  enabled = true,
  className,
}: SwipeableNotificationItemProps) {
  const t = useTranslations('notifications');

  return (
    <SwipeDismissWrapper
      onDismiss={onDismiss}
      enabled={enabled}
      className={`border-b border-theme-border ${className ?? ''}`}
      foregroundClassName="bg-card"
      background={
        <SwipeBothSidesLabel
          icon={<Check className="w-4 h-4 text-brand-700 dark:text-brand-400" />}
          label={t('markAsRead')}
          className="bg-brand-50 text-brand-700 dark:text-brand-400"
        />
      }
    >
      {children}
    </SwipeDismissWrapper>
  );
}
