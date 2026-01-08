import { useState, useEffect } from 'react';
import { useTranslation } from '@/i18n/hooks';
import { WifiOff } from 'lucide-react';

export default function OfflineBanner() {
  const { t } = useTranslation();
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    // Initial check
    setIsOffline(typeof navigator !== 'undefined' && !navigator.onLine);

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] bg-zinc-900 border-t border-zinc-800 p-3 shadow-lg safe-area-bottom">
      <div className="flex items-center justify-center gap-2 text-sm text-zinc-300">
        <WifiOff className="w-4 h-4 text-zinc-400" />
        <span>{t('common.offline') || 'No internet connection'}</span>
      </div>
    </div>
  );
}
