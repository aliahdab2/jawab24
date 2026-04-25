import React, { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useModalBackHandler } from '@/hooks/useModalBackHandler';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /**
   * How the modal presents on mobile portrait. Desktop/landscape always render
   * as a centered card.
   * - 'sheet' (default): bottom sheet, max-height 85vh. Right for short content
   *   (confirmations, pickers, 1–3 fields).
   * - 'fullscreen': fills the viewport. Right for content-heavy forms where
   *   bottom-sheet height forces unnecessary scrolling.
   */
  mobilePresentation?: 'sheet' | 'fullscreen';
  /**
   * Sticky action bar pinned to the bottom of the modal — always visible,
   * never scrolls with the body. Use for primary actions (Save / Cancel /
   * Delete) so users don't have to scroll a long form to act.
   */
  footer?: React.ReactNode;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  mobilePresentation = 'sheet',
  footer,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const tc = useTranslations('common');
  const titleId = useId();
  const panelRef = useFocusTrap<HTMLDivElement>(isOpen);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reusable hooks
  useBodyScrollLock(isOpen);
  useEscapeKey(onClose, isOpen);
  useModalBackHandler(isOpen, onClose);

  // When an input/textarea inside the modal is focused, scroll it into view AFTER
  // the soft keyboard has opened and the overlay has shrunk. Without this, the
  // newly-focused textarea can remain below the keyboard until the user scrolls
  // the body manually. The 350ms delay is empirical — long enough for Android's
  // keyboardDidShow to fire and --keyboard-height + container shrink to settle.
  useEffect(() => {
    if (!isOpen) return;
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') return;
      window.setTimeout(() => {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 350);
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, [isOpen]);

  if (!isOpen || !mounted) return null;

  const isFullscreen = mobilePresentation === 'fullscreen';

  // Width caps. In fullscreen mode, drop the cap on mobile portrait so the
  // panel fills the viewport; restore it from the `sm:` breakpoint upward.
  const sizeClasses = isFullscreen
    ? {
        sm: 'sm:max-w-md landscape:max-w-lg',
        md: 'sm:max-w-xl landscape:max-w-2xl',
        lg: 'sm:max-w-2xl landscape:max-w-3xl',
        xl: 'sm:max-w-4xl landscape:max-w-5xl',
      }
    : {
        sm: 'max-w-md landscape:max-w-lg',
        md: 'max-w-xl landscape:max-w-2xl',
        lg: 'max-w-2xl landscape:max-w-3xl',
        xl: 'max-w-4xl landscape:max-w-5xl',
      };

  // Shrink the overlay so it ends above the soft keyboard. --keyboard-height is
  // set by keyboardSetup.ts (default 0px when no keyboard). Constrains BOTH the
  // backdrop and the panel — works for sheet (panel anchored bottom) and
  // fullscreen alike.
  const overlayBottom = "bottom-[var(--keyboard-height,0px)]";

  const modalContent = (
    <div className={clsx("fixed top-0 start-0 end-0 z-50 overflow-hidden", overlayBottom)}>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className={clsx(
          "fixed top-0 start-0 end-0 bg-black/50 backdrop-blur-sm transition-opacity animate-fade-in",
          overlayBottom
        )}
        onClick={onClose}
      />

      {/* Modal Container - Bottom sheet (default) or fullscreen on mobile portrait; centered on sm+/landscape */}
      <div className={clsx(
        "fixed top-0 start-0 end-0 flex justify-center p-0 sm:p-4 landscape:p-6",
        overlayBottom,
        isFullscreen
          ? "items-stretch sm:items-center landscape:items-center"
          : "items-end sm:items-center landscape:items-center"
      )}>
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={clsx(
            "relative w-full bg-card shadow-2xl dark:shadow-black/30 overflow-hidden animate-slide-up flex flex-col focus:outline-none",
            // Corner rounding: fullscreen has no rounded corners on mobile portrait
            isFullscreen
              ? "rounded-none sm:rounded-3xl landscape:rounded-3xl"
              : "rounded-t-3xl sm:rounded-3xl landscape:rounded-3xl",
            // Height: fullscreen fills the keyboard-aware overlay via items-stretch
            // (no explicit height — lets it shrink with --keyboard-height). Sheet
            // is capped at 85vh minus the keyboard so it never exceeds the
            // remaining viewport when the soft keyboard is open.
            isFullscreen
              ? "sm:h-auto sm:max-h-[85vh] landscape:max-h-[90vh]"
              : "max-h-[calc(85vh-var(--keyboard-height,0px))] sm:max-h-[85vh] landscape:max-h-[90vh]",
            // Safe area padding: fullscreen needs top safe area too (status bar); sheet only bottom
            isFullscreen
              ? "pt-safe pb-safe landscape:pt-0 landscape:pb-2 landscape:px-safe"
              : "pb-safe landscape:pb-2 landscape:px-safe",
            sizeClasses[size]
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 sm:p-6 border-b border-theme-border flex-shrink-0">
            <h3 id={titleId} className="text-xl font-bold text-foreground leading-tight">
              {title}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label={tc('close')}
              className="p-2 -me-2 sm:me-0 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-all flex-shrink-0"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          {/* Body - scrollable content */}
          <div className="p-5 sm:p-6 overflow-y-auto flex-1 min-h-0">
            {children}
          </div>

          {/* Footer - pinned action bar; always visible, never scrolls */}
          {footer && (
            <div className="px-5 py-4 sm:px-6 border-t border-theme-border flex-shrink-0 bg-card">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Return with portal
  const target = typeof document !== 'undefined' ? document.getElementById('modal-root') : null;
  return target ? createPortal(modalContent, target) : modalContent;
}
