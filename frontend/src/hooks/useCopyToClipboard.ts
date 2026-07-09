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
export function useCopyToClipboard(resetMs = 1500): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback((text: string) => {
    if (!text || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), resetMs);
    }).catch(() => {
      // Clipboard blocked (insecure context / denied permission) — benign.
    });
  }, [resetMs]);

  return { copied, copy };
}
