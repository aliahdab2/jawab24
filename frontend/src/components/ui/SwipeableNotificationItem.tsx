import React from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { useSwipeToDismiss } from '@/hooks/useSwipeToDismiss';

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
  const { t } = useTranslation();
  const { ref, isDismissing, shouldSuppressClick } = useSwipeToDismiss({
    onDismiss,
    enabled,
  });

  const handleClick = (e: React.MouseEvent) => {
    if (shouldSuppressClick()) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  return (
    <div
      className={`relative overflow-hidden border-b border-theme-border ${className ?? ''}`}
      style={isDismissing ? { pointerEvents: 'none' } : undefined}
    >
      {/* Background revealed during swipe — both sides */}
      {enabled && (
        <div className="absolute inset-0 flex items-center justify-between bg-brand-50 px-5">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-brand-600" />
            <span className="text-sm font-medium text-brand-700">
              {t('notifications.markAsRead')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-brand-700">
              {t('notifications.markAsRead')}
            </span>
            <Check className="w-4 h-4 text-brand-600" />
          </div>
        </div>
      )}

      {/* Foreground — swipeable layer */}
      <div
        ref={ref}
        className="relative bg-card"
        onClickCapture={handleClick}
      >
        {children}
      </div>
    </div>
  );
}
