import React from 'react';
import clsx from 'clsx';
import { useSwipeToDismiss } from '@/hooks/useSwipeToDismiss';

interface SwipeDismissWrapperProps {
  children: React.ReactNode;
  onDismiss: () => void;
  enabled?: boolean;
  /** Content shown behind the foreground during swipe (positioned absolutely by wrapper) */
  background?: React.ReactNode;
  /** Classes for the outer container (e.g., rounded corners, borders, margins) */
  className?: string;
  /** Classes for the foreground layer holding children */
  foregroundClassName?: string;
}

/**
 * Generic swipe-to-dismiss wrapper.
 *
 * Structure: outer container → absolute background → relative foreground (swipeable).
 * Uses `useSwipeToDismiss` hook for pointer events, direction locking,
 * slide-out animation, and height collapse.
 *
 * Consumers provide the background content and foreground children;
 * this component owns the layout and gesture handling.
 */
export function SwipeDismissWrapper({
  children,
  onDismiss,
  enabled = true,
  background,
  className,
  foregroundClassName,
}: SwipeDismissWrapperProps) {
  const { ref, isDismissing, shouldSuppressClick } = useSwipeToDismiss({
    onDismiss,
    enabled,
  });

  const handleClickCapture = (e: React.MouseEvent) => {
    if (shouldSuppressClick()) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  return (
    <div
      className={clsx('relative overflow-hidden', className)}
      style={isDismissing ? { pointerEvents: 'none' } : undefined}
    >
      {enabled && background && (
        <div className="absolute inset-0">
          {background}
        </div>
      )}
      <div
        ref={ref}
        className={clsx('relative', foregroundClassName)}
        onClickCapture={handleClickCapture}
      >
        {children}
      </div>
    </div>
  );
}
