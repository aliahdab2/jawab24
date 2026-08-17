import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Displays a transient hint string for `duration` ms then clears it.
 * Shared by VoiceRecordButton, FileUploadButton and ReplyStyleCard.
 *
 * `clearHint` exists because a transient message can be made WRONG by something
 * other than time: ReplyStyleCard's «saved for this page ✓» must die the moment
 * the merchant switches to another page, or it describes a save that never
 * happened for the page now on screen. Letting the timer run it out is not the
 * same thing — 4s of a confirmation pointing at the wrong target is the defect.
 *
 * The unmount cleanup is not decoration: without it the pending timeout calls
 * setHint on a dead component (React logs an act(...) warning in tests, and a
 * remount — e.g. the /en ↔ /ar locale route — can let the OLD mount's timer
 * clear the NEW mount's message).
 */
export function useHintDisplay(duration = 5000) {
  const [hint, setHint] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHint = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setHint(null);
  }, []);

  const showHint = useCallback((text: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setHint(text);
    timerRef.current = setTimeout(() => setHint(null), duration);
  }, [duration]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { hint, showHint, clearHint };
}
