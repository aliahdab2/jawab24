import { WifiOff } from 'lucide-react';
import { useUIStore } from '@/lib/store';
import { useTranslations } from 'next-intl';
import { isNativePlatform } from '@/lib/capacitor';

/**
 * Slim banner shown when the device loses network connectivity.
 * Only renders on native (Capacitor) where patchy mobile networks are common.
 */
export function OfflineBanner() {
  const isOffline = useUIStore((s) => s.isOffline);
  const tc = useTranslations('common');

  if (!isOffline || !isNativePlatform()) return null;

  return (
    <div className="flex items-center justify-center gap-2 py-2 bg-surface-800 text-white text-xs font-semibold z-50">
      <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
      <span>{tc('offline')}</span>
    </div>
  );
}
