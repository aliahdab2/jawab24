/**
 * Demo Login Button
 * 
 * Self-contained button for demo login.
 * Only renders when demo mode is enabled.
 */

import { Play } from 'lucide-react';
import { Button } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { useDemoMode } from './useDemoMode';

export function DemoLoginButton() {
  const { t } = useTranslation();
  const { isEnabled, isLoading, login } = useDemoMode();

  // Don't render if demo mode is not enabled
  if (!isEnabled) return null;

  return (
    <>
      {/* Demo Button */}
      <Button
        onClick={login}
        loading={isLoading}
        variant="secondary"
        size="lg"
        className="w-full mt-3 py-5 sm:py-6 rounded-2xl border-2 border-dashed border-brand-300 hover:border-brand-500 hover:bg-brand-50 font-bold text-base lg:text-lg transition-all"
      >
        <div className="flex items-center justify-center gap-3">
          <Play className="w-5 h-5 lg:w-6 lg:h-6 text-brand-600" />
          <span className="text-brand-700">{t('auth.tryDemo')}</span>
        </div>
      </Button>
    </>
  );
}
