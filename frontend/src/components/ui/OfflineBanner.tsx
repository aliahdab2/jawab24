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
 * was invisible to every user it was written for.
 *
 * The live region is the OUTER element and is mounted on native whether or not
 * the device is offline. Assistive technology announces *changes* to a region
 * already in the accessibility tree; a region that appears already populated is
 * routinely dropped by TalkBack and VoiceOver. So the wrapper stays (empty and
 * zero-height while online) and only its contents come and go. All colour and
 * spacing live on the inner element — an empty wrapper must not reserve space.
 *
 * Guarded by `test/mobile/offlineBannerPlacement.test.ts`.
 */
export function OfflineBanner() {
  const isOffline = useUIStore((s) => s.isOffline);
  const tc = useTranslations('common');

  if (!isNativePlatform()) return null;

  return (
    <div role="status" aria-live="polite">
      {isOffline && (
        <div className="offline-banner flex items-center justify-center gap-2 py-2 text-xs font-semibold">
          <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{tc('offline')}</span>
        </div>
      )}
    </div>
  );
}
