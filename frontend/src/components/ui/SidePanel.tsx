import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useModalBackHandler } from '@/hooks/useModalBackHandler';

interface SidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

/**
 * SidePanel — best-practice detail panel.
 *
 * Desktop (md+): slides in from the right edge, full viewport height.
 *   The table stays visible behind a light backdrop.
 *
 * Mobile (<md): full-screen sheet with:
 *   - dvh height so it tracks the real viewport (no jump when browser chrome hides)
 *   - safe-area padding so content never hides behind the notch or home indicator
 *   - swipe-down-to-dismiss: drag the handle or header downward to close
 *   - snap-back: releasing before the threshold animates the sheet back up
 *
 * Accessibility: Escape key, back-button handler, body scroll lock, aria-modal.
 */
export function SidePanel({ isOpen, onClose, title, subtitle, children }: SidePanelProps) {
  const tc = useTranslations('common');
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  // Swipe-to-dismiss state (mobile only)
  const dragStartY = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);
  const isDragging = useRef(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      // Paint first frame hidden, then transition in
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    } else {
      setVisible(false);
      setDragOffset(0);
      // Unmount after transition completes (300ms = duration-300)
      const id = setTimeout(() => setShouldRender(false), 320);
      return () => clearTimeout(id);
    }
  }, [isOpen]);

  useBodyScrollLock(isOpen);
  useEscapeKey(onClose, isOpen);
  useModalBackHandler(isOpen, onClose);

  // ── Swipe-to-dismiss handlers ──────────────────────────────────────────────

  const onTouchStart = (e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    isDragging.current = true;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const dy = e.touches[0].clientY - dragStartY.current;
    // Only allow dragging downward
    if (dy > 0) setDragOffset(dy);
  };

  const onTouchEnd = () => {
    isDragging.current = false;
    // Dismiss if dragged more than 120px, otherwise snap back
    if (dragOffset > 120) {
      onClose();
    } else {
      setDragOffset(0);
    }
  };

  if (!mounted || !shouldRender) return null;

  const content = (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className={clsx(
          'absolute inset-0 bg-black/30 backdrop-blur-[2px]',
          'transition-opacity duration-300',
          visible && dragOffset === 0 ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* ── Desktop: right-side panel ─────────────────────────── */}
      <div
        className={clsx(
          'hidden md:flex flex-col',
          'absolute inset-y-0 end-0 w-[440px] bg-card shadow-2xl',
          'transition-transform duration-300 ease-out',
          visible ? 'translate-x-0' : 'translate-x-full rtl:-translate-x-full',
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-theme-border flex-shrink-0">
          <div className="min-w-0 pe-4">
            <h2 className="text-lg font-bold text-foreground truncate">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-2 -me-2 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex-shrink-0"
            aria-label={tc('close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          {children}
        </div>
      </div>

      {/* ── Mobile: bottom sheet ──────────────────────────────── */}
      <div
        className={clsx(
          'flex md:hidden flex-col',
          // Full screen: detail content is dense (status, fields, conversation),
          // so use every pixel instead of a partial sheet with a peek gap.
          // bottom tracks --keyboard-height (same pattern as the shared Modal)
          // so the custom-field inputs stay above the soft keyboard on
          // overlay-mode WebViews.
          'absolute inset-x-0 top-0 bottom-[var(--keyboard-height,0px)] bg-card shadow-2xl',
          'pt-safe pb-safe',
          // Transition: no transition while dragging (instant follow), spring-back when released
          dragOffset > 0 ? '' : 'transition-transform duration-300 ease-out',
          visible ? 'translate-y-0' : 'translate-y-full',
        )}
        style={dragOffset > 0 ? { transform: `translateY(${dragOffset}px)` } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Drag handle — touch target for swipe-to-dismiss */}
        <div
          className="flex justify-center pt-3 pb-2 flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          aria-hidden="true"
        >
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header — also draggable */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b border-theme-border flex-shrink-0"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="min-w-0 pe-4">
            <h2 className="text-lg font-bold text-foreground truncate">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-2 -me-2 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex-shrink-0"
            aria-label={tc('close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {children}
        </div>
      </div>
    </div>
  );

  const target = typeof document !== 'undefined' ? document.getElementById('modal-root') : null;
  return target ? createPortal(content, target) : content;
}
