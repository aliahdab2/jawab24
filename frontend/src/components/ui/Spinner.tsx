import { PremiumSpinner } from './PremiumSpinner';
import { BRAND_ASSETS } from '@/constants/brand';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <PremiumSpinner size={size} className={className} />
  );
}

export function PageSpinner() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-6 animate-fade-in">
      <div className="relative">
        <div className="absolute inset-0 bg-brand-500/20 rounded-full blur-3xl animate-pulse"></div>
        <PremiumSpinner size="lg" color="var(--brand-600)" />
      </div>
      <p className="text-sm font-bold text-surface-400 uppercase tracking-[0.2em] animate-pulse">
        Loading {BRAND_ASSETS.meta.appName}
      </p>
    </div>
  );
}
