import { useVersion } from '@/lib/useVersion';

export function VersionBadge() {
  const { versionInfo, displayVersion, environment } = useVersion();

  if (!versionInfo) return null;

  const envColor = environment === 'green' 
    ? 'text-green-500' 
    : environment === 'blue' 
    ? 'text-blue-500' 
    : 'text-surface-400';

  return (
    <div className="fixed bottom-2 end-2 text-[10px] text-surface-400 opacity-50 hover:opacity-100 transition-opacity z-10 hidden md:block">
      <span className="font-mono">v{displayVersion}</span>
      <span className="mx-1">•</span>
      <span className={envColor}>{environment}</span>
    </div>
  );
}

