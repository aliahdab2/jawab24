/**
 * Demo Mode Banner
 *
 * Shows a banner when user is in demo mode.
 * Uses useIsDemoUser hook to determine visibility.
 * Dismissible per session (persisted in sessionStorage).
 */

import { useState, useEffect } from 'react';
import { Info, X } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { useIsDemoUser } from './useDemoMode';

const DISMISS_KEY = 'jawab24_demo_banner_dismissed';

interface DemoBannerProps {
  className?: string;
}

export function DemoBanner({ className = '' }: DemoBannerProps) {
  const { t } = useTranslation();
  const isDemoUser = useIsDemoUser();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem(DISMISS_KEY)) {
      setDismissed(true);
    }
  }, []);

  if (!isDemoUser || dismissed) return null;

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className={`alert-warning border-b px-3 py-1.5 ${className}`}>
      <div className="flex items-center justify-center gap-2">
        <Info className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="text-xs font-medium">{t('auth.demoBanner')}</span>
        <button
          onClick={handleDismiss}
          className="ms-auto p-0.5 rounded hover:bg-black/10 transition-colors flex-shrink-0"
          aria-label={t('common.close')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
