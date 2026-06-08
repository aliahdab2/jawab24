import React from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

interface DetailSheetProps {
  /** Extra panel classes — e.g. a fixed desktop height so nav arrows stay put. */
  panelClassName?: string;
  /** Forwarded to the panel element (role / aria-*) for labelled dialogs. */
  dialogProps?: React.AriaAttributes & { role?: React.AriaRole };
  children: React.ReactNode;
}

/**
 * Detail overlay shell shared by the comment + message detail modals:
 * a full-screen bottom sheet on mobile (h-full fills the overlay) and a centered
 * card on desktop. Renders into a portal with a dimmed backdrop, blocks background
 * scroll/overscroll while letting the panel itself pan, and respects the on-screen
 * keyboard height. Keeping the overlay + sizing here means both modals stay in sync
 * from one place instead of duplicating the wrapper.
 */
export const DetailSheet: React.FC<DetailSheetProps> = ({ panelClassName, dialogProps, children }) => {
  return createPortal(
    <div
      className="modal-overlay fixed top-0 start-0 end-0 bottom-[var(--keyboard-height,0px)] bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 landscape:p-6 landscape:items-center animate-in fade-in duration-200 touch-none"
      onTouchMove={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
      onWheel={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
    >
      <div
        {...dialogProps}
        className={clsx(
          'bg-card rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-2xl h-full sm:min-h-0 max-h-[calc(100vh-var(--keyboard-height,0px))] sm:max-h-[90vh] overflow-hidden flex flex-col pt-safe sm:pt-0 landscape:pb-2 landscape:px-safe animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200 touch-pan-y',
          panelClassName,
        )}
        onTouchMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};
