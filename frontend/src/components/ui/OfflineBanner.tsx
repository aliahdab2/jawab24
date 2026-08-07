import { WifiOff } from 'lucide-react';
import { useUIStore } from '@/lib/store';
import { useTranslations } from 'next-intl';
import { isNativePlatform } from '@/lib/capacitor';

/**
 * Slim banner shown when the device loses network connectivity.
 * Only renders on native (Capacitor) where patchy mobile networks are common.
 *
 * Placement contract: render this inside `<main>` in `DashboardLayout`, never as
 * a sibling in the scroll root. It carries no positioning of its own — a
 * `z-index` on a `position: static` element does nothing — so outside the
 * header-cleared area the fixed header simply painted over it, and the banner
 * was invisible to every user it was written for. Guarded by
 * `test/mobile/offlineBannerPlacement.test.ts`.
 */
export function OfflineBanner() {
  const isOffline = useUIStore((s) => s.isOffline);
  const tc = useTranslations('common');

  if (!isOffline || !isNativePlatform()) return null;

  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-2 bg-surface-800 text-white text-xs font-semibold">
      <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
      <span>{tc('offline')}</span>
    </div>
  );
}
