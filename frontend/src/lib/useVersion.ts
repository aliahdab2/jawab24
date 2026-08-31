/**
 * Hook that fetches and exposes the application version.
 *
 * Priority: `NEXT_PUBLIC_APP_VERSION` env var (semantic version set at build)
 * → backend `/version` endpoint (git commit hash) → `"unknown"` fallback.
 *
 * @returns `{ displayVersion, environment, versionInfo, loading }`
 *
 * @example
 * ```tsx
 * const { displayVersion } = useVersion();
 * <span>v{displayVersion}</span>
 * ```
 */
import { useState, useEffect } from 'react';

export interface VersionInfo {
  version: string;
  shortVersion: string;
  deployedAt: string;
  environment: string;
}

// Fallback version when API is unavailable
const FALLBACK_VERSION = 'unknown';

export function useVersion() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Prioritize semantic version from build env, then API git commit, then fallback
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || FALLBACK_VERSION;

  useEffect(() => {
    /*
     * The request is aborted AND its state writes are gated on unmount.
     *
     * Both halves are needed. `abort()` stops the in-flight request, but the
     * `finally` still runs on the rejection path, so without `cancelled` it
     * would call setLoading on an unmounted component. In a browser React
     * swallows that; under vitest the JSDOM environment is already torn down
     * and the same write throws `ReferenceError: window is not defined` from
     * React's scheduler — an unhandled rejection that fails the whole run
     * while every individual test still passes.
     *
     * The leak was real outside tests too: navigating away while /version was
     * slow left this hook writing state for a component nobody was looking at.
     */
    const controller = new AbortController();
    let cancelled = false;

    const fetchVersion = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
        const response = await fetch(`${apiUrl}/version`, { signal: controller.signal });
        if (response.ok) {
          const data = await response.json();
          if (!cancelled) setVersionInfo(data);
        }
      } catch {
        // Silently fail — version info is not critical. Also swallows the
        // AbortError raised by the cleanup below, which is expected, not a fault.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchVersion();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  // If appVersion is not 'unknown', use it, otherwise use API's shortVersion or fallback
  const displayVersion = appVersion !== FALLBACK_VERSION ? appVersion : (versionInfo?.shortVersion || FALLBACK_VERSION);
  const environment = versionInfo?.environment || 'unknown';

  return {
    versionInfo,
    displayVersion,
    environment,
    loading,
  };
}

