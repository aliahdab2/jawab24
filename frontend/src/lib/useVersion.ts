import { useState, useEffect } from 'react';

export interface VersionInfo {
  version: string;
  shortVersion: string;
  deployedAt: string;
  environment: string;
}

// Fallback version when API is unavailable
const FALLBACK_VERSION = '2.4.0';

export function useVersion() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);

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

  // Return shortVersion or fallback
  const displayVersion = versionInfo?.shortVersion || FALLBACK_VERSION;
  const environment = versionInfo?.environment || 'unknown';

  return {
    versionInfo,
    displayVersion,
    environment,
    loading,
  };
}

