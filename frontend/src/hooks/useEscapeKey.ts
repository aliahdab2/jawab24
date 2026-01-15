import { useEffect } from 'react';

/**
 * Custom hook to handle ESC key press
 * 
 * @param onEscape - Callback function to execute when ESC is pressed
 * @param enabled - Whether the hook should listen for ESC (default: true)
 * 
 * @example
 * // Close modal on ESC
 * useEscapeKey(() => setIsOpen(false), isOpen);
 * 
 * // Always listen
 * useEscapeKey(handleClose);
 */
export function useEscapeKey(onEscape: () => void, enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onEscape, enabled]);
}
