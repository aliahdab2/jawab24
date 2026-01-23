/**
 * Demo Mode Banner
 * 
 * Shows a banner when user is in demo mode.
 * Uses useIsDemoUser hook to determine visibility.
 */

import { Info } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { useIsDemoUser } from './useDemoMode';

interface DemoBannerProps {
  className?: string;
}

export function DemoBanner({ className = '' }: DemoBannerProps) {
  const { t } = useTranslation();
  const isDemoUser = useIsDemoUser();

  // Don't render if not in demo mode
  if (!isDemoUser) return null;

  return (
    <div className={`bg-amber-50 border-b border-amber-200 px-4 py-2 ${className}`}>
      <div className="flex items-center justify-center gap-2 text-amber-800">
        <Info className="w-4 h-4 flex-shrink-0" />
        <span className="text-sm font-medium">{t('auth.demoBanner')}</span>
      </div>
    </div>
  );
}
