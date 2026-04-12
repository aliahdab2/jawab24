import { useState, useCallback, useRef } from 'react';

/**
 * Displays a transient hint string for `duration` ms then clears it.
 * Shared by VoiceRecordButton and FileUploadButton.
 */
export function useHintDisplay(duration = 5000) {
  const [hint, setHint] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHint = useCallback((text: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setHint(text);
    timerRef.current = setTimeout(() => setHint(null), duration);
  }, [duration]);

  return { hint, showHint };
}
