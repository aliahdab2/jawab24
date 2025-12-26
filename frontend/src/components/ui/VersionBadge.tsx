import { useState, useEffect } from 'react';

interface VersionInfo {
  version: string;
  shortVersion: string;
  deployedAt: string;
  environment: string;
}

export function VersionBadge() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const response = await fetch('/api/version');
        if (response.ok) {
          const data = await response.json();
          setVersionInfo(data);
        }
      } catch {
        // Silently fail - version info is not critical
      }
    };

    fetchVersion();
  }, []);

  if (!versionInfo) return null;

  const envColor = versionInfo.environment === 'green' 
    ? 'text-green-500' 
    : versionInfo.environment === 'blue' 
    ? 'text-blue-500' 
    : 'text-surface-400';

  return (
    <div className="fixed bottom-2 end-2 text-[10px] text-surface-400 opacity-50 hover:opacity-100 transition-opacity z-10 hidden md:block">
      <span className="font-mono">v{versionInfo.shortVersion}</span>
      <span className="mx-1">•</span>
      <span className={envColor}>{versionInfo.environment}</span>
    </div>
  );
}

