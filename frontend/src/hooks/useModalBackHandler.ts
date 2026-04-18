import { useEffect } from 'react';

/**
 * Module-level stack of close callbacks for open modals/overlays.
 * When the Android hardware back button fires, _app.tsx pops the top
 * entry first. Only if the stack is empty does it fall through to
 * router.back() / App.exitApp().
 *
 * For "view-like" modals that represent a piece of content (conversation,
 * comment), prefer URL-based routing (e.g. `?conversation=<id>`) over this
 * hook — back navigation, deep-linking, and bfcache all work naturally.
 * This hook is for transient dialogs that don't belong in the URL.
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
