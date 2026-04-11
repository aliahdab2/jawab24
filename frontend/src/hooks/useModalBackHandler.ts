import { useEffect } from 'react';

/**
 * Module-level stack of close callbacks for open modals/overlays.
 * When the Android hardware back button fires, _app.tsx pops the top
 * entry first. Only if the stack is empty does it fall through to
 * router.back() / App.exitApp().
 *
 * Usage — call inside any modal component:
 *   useModalBackHandler(isOpen, onClose);
 */
const modalStack: Array<() => void> = [];

/** Called by _app.tsx back-button handler. Returns true if a modal was closed. */
export function dismissTopModal(): boolean {
  if (modalStack.length === 0) return false;
  const close = modalStack[modalStack.length - 1];
  close();
  return true;
}

export function useModalBackHandler(isOpen: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!isOpen) return;

    modalStack.push(onClose);

    return () => {
      const idx = modalStack.lastIndexOf(onClose);
      if (idx !== -1) modalStack.splice(idx, 1);
    };
  }, [isOpen, onClose]);
}
