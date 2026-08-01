import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

interface DetailSheetProps {
  /** Extra panel classes — e.g. a fixed desktop height so nav arrows stay put. */
  panelClassName?: string;
  /** Forwarded to the panel element (role / aria-*) for labelled dialogs. */
  dialogProps?: React.AriaAttributes & { role?: React.AriaRole };
  /**
   * Size the sheet to its CONTENT instead of the viewport. The default
   * (`h-full` on mobile, and effectively fixed on desktop through the caller's
   * `max-h`) fits the comment/message detail modals, whose thread fills any
   * height — but a one-field editor inside it opens as ~650px of card around
   * 150px of content. With `fitContent` the panel hugs its content on every
   * viewport, still capped by the keyboard-aware max height.
   */
  fitContent?: boolean;
  /**
   * Renders a mobile drag handle that dismisses the sheet on a downward swipe.
   * Wire it to the sheet's GUARDED close (the same path as X/Cancel), never
   * raw `onClose` — a swipe must not bypass an unsaved-changes confirm.
   */
  onSwipeDismiss?: () => void;
  children: React.ReactNode;
}

/** Drag past this many px, then release, to dismiss. Under it snaps back. */
const SWIPE_DISMISS_PX = 72;

/**
 * Detail overlay shell shared by the comment + message detail modals and the
 * /business fact sheets: a bottom sheet on mobile (full-height by default,
 * content-height with `fitContent`) and a centered card on desktop. Renders
 * into a portal with a dimmed backdrop, blocks background scroll/overscroll
 * while letting the panel itself pan, and respects the on-screen keyboard
 * height. Keeping the overlay + sizing here means every consumer stays in sync
 * from one place instead of duplicating the wrapper.
 */
export const DetailSheet: React.FC<DetailSheetProps> = ({
  panelClassName,
  dialogProps,
  fitContent = false,
  onSwipeDismiss,
  children,
}) => {
  // Handle-only drag: the panel body scrolls, so a whole-sheet gesture would
  // fight the scroll direction lock. The handle is dead space by design —
  // pointer events there can own the vertical axis outright. The ref mirrors
  // the state so the release handler reads the LAST pointermove, not the
  // render-time value — on a fast flick those differ by an event.
  const [dragY, setDragY] = useState(0);
  const dragYRef = useRef(0);
  const dragStart = useRef<number | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStart.current === null) return;
    const dy = Math.max(0, e.clientY - dragStart.current);
    dragYRef.current = dy;
    setDragY(dy);
  };
  const onPointerEnd = () => {
    if (dragStart.current === null) return;
    const shouldDismiss = dragYRef.current > SWIPE_DISMISS_PX;
    dragStart.current = null;
    dragYRef.current = 0;
    setDragY(0);
    if (shouldDismiss) onSwipeDismiss?.();
  };

  return createPortal(
    <div
      className="modal-overlay fixed top-0 start-0 end-0 bottom-[var(--keyboard-height,0px)] bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 landscape:p-6 landscape:items-center animate-in fade-in duration-200 touch-none"
      onTouchMove={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
      onWheel={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
    >
      <div
        {...dialogProps}
        className={clsx(
          'bg-card rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-2xl sm:min-h-0 overflow-hidden flex flex-col landscape:pb-2 landscape:px-safe animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200 touch-pan-y',
          fitContent
            // Content height on every viewport. The mobile cap subtracts the
            // top safe-area inset so a tall sheet stops under the notch —
            // which is also why `pt-safe` is not needed here: the sheet never
            // reaches the area it pads against.
            ? 'h-auto max-h-[calc(100vh-var(--keyboard-height,0px)-var(--sai-top,0px)-12px)] sm:max-h-[90vh]'
            : 'h-full max-h-[calc(100vh-var(--keyboard-height,0px))] sm:max-h-[90vh] pt-safe sm:pt-0',
          panelClassName,
        )}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
        onTouchMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {onSwipeDismiss && (
          <div
            // py-3 for a usable swipe target; the bar needs real contrast —
            // theme-border on the card surface measured ~1.15:1 in dark mode,
            // an affordance that effectively didn't exist.
            className="sm:hidden flex-shrink-0 flex justify-center py-3 touch-none cursor-grab"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
          >
            <span aria-hidden="true" className="h-1 w-10 rounded-full bg-muted-foreground/40" />
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
};
