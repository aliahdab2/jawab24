/**
 * Demo Login Button
 * 
 * Self-contained button for demo login.
 * Only renders when demo mode is enabled.
 */

import clsx from 'clsx';
import { Play } from 'lucide-react';
// Direct import, NOT the '@/components/ui' barrel — this renders on the
// public login page. See components/layout/DashboardLayout.tsx.
import { Button } from '@/components/ui/Button';
import { useTranslations } from 'next-intl';
import { useDemoMode } from './useDemoMode';

export function DemoLoginButton() {
  const t = useTranslations('auth');
  const { isEnabled, isChecking, isLoading, login } = useDemoMode();

  // Don't render if demo mode is not enabled (and we're done checking)
  if (!isChecking && !isEnabled) return null;

  // While checking, render an invisible placeholder to reserve space and prevent layout shift
  if (isChecking) {
    return <div className="w-full mt-3 py-5 sm:py-6" aria-hidden="true" />;
  }

  return (
    <>
      {/* Divider */}
      <div className="flex items-center gap-3 my-1">
        <div className="flex-1 h-px bg-theme-border" />
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{t('or')}</span>
        <div className="flex-1 h-px bg-theme-border" />
      </div>
      {/* Demo Button */}
      <Button
        onClick={login}
        disabled={isLoading}
        variant="secondary"
        size="lg"
        className={clsx(
          'w-full mt-1 py-3 sm:py-6 rounded-2xl border-2 border-dashed font-bold text-base lg:text-lg transition-all active:scale-95',
          isLoading
            ? 'animate-pulse border-brand-400 bg-brand-50 dark:bg-brand-900/30'
            : 'border-brand-300 hover:border-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/30'
        )}
      >
        <div className="flex items-center justify-center gap-3">
          <Play className="w-5 h-5 lg:w-6 lg:h-6 text-brand-600" />
          <span className="text-brand-700 dark:text-brand-400">{t('tryDemo')}</span>
        </div>
      </Button>
    </>
  );
}
