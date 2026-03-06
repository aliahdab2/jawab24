import { useRouter } from 'next/router';
import { useVersion } from '@/lib/useVersion';

const PUBLIC_PATHS = ['/', '/pricing', '/login', '/register', '/landing', '/terms', '/privacy'];

export function VersionBadge() {
  const { versionInfo, displayVersion, environment } = useVersion();
  const { pathname } = useRouter();

  // Hide badge on public-facing pages
  if (PUBLIC_PATHS.includes(pathname)) {
    return null;
  }

  // Hide badge in production builds
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  // Hide badge if no version info or if version is unknown
  if (!versionInfo || displayVersion === 'unknown' || environment === 'unknown') {
    return null;
  }

  const envColor = environment === 'green'
    ? 'text-green-500'
    : environment === 'blue'
      ? 'text-blue-500'
      : 'text-muted-foreground';

  return (
    <div className="fixed bottom-2 end-2 text-[10px] text-muted-foreground opacity-50 hover:opacity-100 transition-opacity z-10 hidden md:block">
      <span className="font-mono">v{displayVersion}</span>
      <span className="mx-1">•</span>
      <span className={envColor}>{environment}</span>
    </div>
  );
}


