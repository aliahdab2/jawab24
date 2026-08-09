import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Copy text to the clipboard and expose a transient `copied` flag (auto-resets
 * after `resetMs`) for "Copied!" affordances.
 *
 * Clipboard access can reject — insecure context, denied permission, or an
 * unavailable API — and that is benign for a copy-convenience button: the
 * source text is still visible/selectable, so a failed copy simply leaves
 * `copied` false rather than surfacing an error.
 *
 * Extracted so call sites stop hand-rolling `navigator.clipboard.writeText`
 * (TeamPanel, admin PaymentRequestModal, admin/playground each do today and
 * can adopt this).
 */
export function useCopyToClipboard(resetMs = 1500): { copied: boolean; copy: (text: string) => Promise<boolean> } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Resolves TRUE only when the clipboard write actually landed — callers that
  // record "copied" as a success signal (post-suggestion stamps) must await
  // this instead of assuming the write worked. Fire-and-forget callers can
  // keep ignoring the return value (additive change).
  const copy = useCallback(async (text: string): Promise<boolean> => {
    if (!text || !navigator.clipboard) return false;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard blocked (insecure context / denied permission) — benign.
      return false;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), resetMs);
    return true;
  }, [resetMs]);

  return { copied, copy };
}
