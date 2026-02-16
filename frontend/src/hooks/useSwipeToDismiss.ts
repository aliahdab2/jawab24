import { useRef, useState, useCallback, useEffect } from 'react';

interface UseSwipeToDismissOptions {
  /** Called when item is swiped past threshold */
  onDismiss: () => void;
  /** Fraction of element width to trigger dismiss (0-1). Default: 0.35 */
  threshold?: number;
  /** Whether swiping is enabled. Default: true */
  enabled?: boolean;
}

interface UseSwipeToDismissReturn {
  /** Ref to attach to the swipeable foreground element */
  ref: React.RefObject<HTMLDivElement | null>;
  /** Whether the item is currently animating out */
  isDismissing: boolean;
  /** Whether a click should be suppressed (swipe just happened) */
  shouldSuppressClick: () => boolean;
}

interface DragState {
  startX: number;
  startY: number;
  currentX: number;
  isDragging: boolean;
  directionLocked: 'horizontal' | 'vertical' | null;
  pointerId: number | null;
  elementWidth: number;
}

const DIRECTION_LOCK_THRESHOLD = 10;
const SNAP_BACK_MS = 250;
const SLIDE_OUT_MS = 200;
const COLLAPSE_MS = 200;

/**
 * useSwipeToDismiss — ref-based hook for smooth 60fps swipe-to-dismiss gestures.
 * Uses pointer events for unified touch + mouse support.
 * Direction-locks after ~10px to avoid fighting with vertical scroll.
 */
export function useSwipeToDismiss({
  onDismiss,
  threshold = 0.35,
  enabled = true,
}: UseSwipeToDismissOptions): UseSwipeToDismissReturn {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isDismissing, setIsDismissing] = useState(false);
  const dragRef = useRef<DragState>({
    startX: 0,
    startY: 0,
    currentX: 0,
    isDragging: false,
    directionLocked: null,
    pointerId: null,
    elementWidth: 0,
  });
  const clickSuppressedRef = useRef(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const shouldSuppressClick = useCallback(() => {
    return clickSuppressedRef.current;
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    // Set touch-action so browser handles vertical scroll, we handle horizontal
    element.style.touchAction = 'pan-y';

    const handlePointerDown = (e: PointerEvent) => {
      if (isDismissing) return;
      // Only handle primary button (left mouse / single touch)
      if (e.button !== 0) return;

      const drag = dragRef.current;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.currentX = 0;
      drag.isDragging = true;
      drag.directionLocked = null;
      drag.pointerId = e.pointerId;
      drag.elementWidth = element.getBoundingClientRect().width;

      // Remove any lingering transition from previous snap-back
      element.style.transition = '';
    };

    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag.isDragging || drag.pointerId !== e.pointerId) return;

      const deltaX = e.clientX - drag.startX;
      const deltaY = e.clientY - drag.startY;

      // Direction lock: decide on first ~10px of movement
      if (!drag.directionLocked) {
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        if (absX < DIRECTION_LOCK_THRESHOLD && absY < DIRECTION_LOCK_THRESHOLD) {
          return; // Not enough movement yet
        }

        if (absY > absX) {
          // Vertical — bail out, let scroll handle it
          drag.directionLocked = 'vertical';
          drag.isDragging = false;
          return;
        }

        // Horizontal — capture pointer and start tracking
        drag.directionLocked = 'horizontal';
        try {
          element.setPointerCapture(e.pointerId);
        } catch {
          // setPointerCapture can fail if pointer is already released
        }
      }

      if (drag.directionLocked !== 'horizontal') return;

      e.preventDefault();
      drag.currentX = deltaX;

      // Calculate opacity: fade as it moves further
      const progress = Math.abs(deltaX) / drag.elementWidth;
      const opacity = Math.max(0.3, 1 - progress * 0.7);

      element.style.transform = `translateX(${deltaX}px)`;
      element.style.opacity = String(opacity);
    };

    const handlePointerUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag.isDragging && drag.directionLocked !== 'horizontal') {
        // Reset state for next gesture
        drag.isDragging = false;
        drag.directionLocked = null;
        drag.pointerId = null;
        return;
      }
      if (drag.pointerId !== null && drag.pointerId !== e.pointerId) return;

      drag.isDragging = false;
      const wasDraggingHorizontally = drag.directionLocked === 'horizontal';
      drag.directionLocked = null;
      drag.pointerId = null;

      try {
        element.releasePointerCapture(e.pointerId);
      } catch {
        // May already be released
      }

      if (!wasDraggingHorizontally) return;

      const deltaX = drag.currentX;
      const progress = Math.abs(deltaX) / drag.elementWidth;

      // Suppress the click that would fire after pointer-up
      if (Math.abs(deltaX) > DIRECTION_LOCK_THRESHOLD) {
        clickSuppressedRef.current = true;
        setTimeout(() => {
          clickSuppressedRef.current = false;
        }, 50);
      }

      if (progress >= threshold) {
        // Dismiss: slide out in the swipe direction, then collapse
        setIsDismissing(true);
        const direction = deltaX > 0 ? 1 : -1;
        const targetX = direction * drag.elementWidth;

        element.style.transition = `transform ${SLIDE_OUT_MS}ms ease-out, opacity ${SLIDE_OUT_MS}ms ease-out`;
        element.style.transform = `translateX(${targetX}px)`;
        element.style.opacity = '0';

        // Guard: ensure onDismiss fires exactly once
        let dismissed = false;
        let collapsed = false;

        const collapseAfterSlide = () => {
          if (collapsed) return;
          collapsed = true;
          element.removeEventListener('transitionend', collapseAfterSlide);

          // Collapse height
          const outer = element.parentElement;
          if (!outer) {
            if (!dismissed) { dismissed = true; onDismissRef.current(); }
            return;
          }

          const height = outer.getBoundingClientRect().height;
          outer.style.height = `${height}px`;
          outer.style.overflow = 'hidden';

          // Force reflow
          void outer.offsetHeight;

          outer.style.transition = `height ${COLLAPSE_MS}ms ease-out, padding ${COLLAPSE_MS}ms ease-out, border ${COLLAPSE_MS}ms ease-out`;
          outer.style.height = '0px';
          outer.style.paddingTop = '0px';
          outer.style.paddingBottom = '0px';
          outer.style.borderWidth = '0px';

          const finalize = () => {
            outer.removeEventListener('transitionend', finalize);
            if (!dismissed) { dismissed = true; onDismissRef.current(); }
          };
          outer.addEventListener('transitionend', finalize, { once: true });
          // Safety fallback
          setTimeout(finalize, COLLAPSE_MS + 50);
        };

        element.addEventListener('transitionend', collapseAfterSlide, { once: true });
        // Safety fallback
        setTimeout(collapseAfterSlide, SLIDE_OUT_MS + 50);
      } else {
        // Snap back
        element.style.transition = `transform ${SNAP_BACK_MS}ms ease-out, opacity ${SNAP_BACK_MS}ms ease-out`;
        element.style.transform = 'translateX(0px)';
        element.style.opacity = '1';

        const clearTransition = () => {
          element.removeEventListener('transitionend', clearTransition);
          element.style.transition = '';
        };
        element.addEventListener('transitionend', clearTransition, { once: true });
        setTimeout(clearTransition, SNAP_BACK_MS + 50);
      }
    };

    const handlePointerCancel = (e: PointerEvent) => {
      const drag = dragRef.current;
      drag.isDragging = false;
      drag.directionLocked = null;
      drag.pointerId = null;

      // Snap back on cancel
      element.style.transition = `transform ${SNAP_BACK_MS}ms ease-out, opacity ${SNAP_BACK_MS}ms ease-out`;
      element.style.transform = 'translateX(0px)';
      element.style.opacity = '1';

      try {
        element.releasePointerCapture(e.pointerId);
      } catch {
        // Already released
      }
    };

    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('pointermove', handlePointerMove);
    element.addEventListener('pointerup', handlePointerUp);
    element.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerup', handlePointerUp);
      element.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [enabled, isDismissing, threshold]);

  return { ref, isDismissing, shouldSuppressClick };
}
