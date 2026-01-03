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
    const fetchVersion = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
        const response = await fetch(`${apiUrl}/version`);
        if (response.ok) {
          const data = await response.json();
          setVersionInfo(data);
        }
      } catch {
        // Silently fail - version info is not critical
      } finally {
        setLoading(false);
      }
    };

    fetchVersion();
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

