import clsx from 'clsx';
import { useTranslation } from '@/i18n';

interface ToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export function Toggle({ enabled, onChange, disabled = false, size = 'md' }: ToggleProps) {
  const { language } = useTranslation();
  const isRTL = language === 'ar';
  
  const sizeClasses = {
    sm: {
      track: 'w-8 h-4',
      thumb: 'w-3 h-3',
      translateDistance: 16, // 1rem in pixels
    },
    md: {
      track: 'w-11 h-6',
      thumb: 'w-5 h-5',
      translateDistance: 20, // 1.25rem in pixels
    },
  };

  // Toggle positioning:
  // LTR: OFF = thumb on left (0), ON = thumb on right (+distance)
  // RTL: OFF = thumb on right (+distance), ON = thumb on left (0)
  // This ensures visual consistency - OFF is always on the "start" side
  const getTransform = () => {
    const distance = sizeClasses[size].translateDistance;
    if (isRTL) {
      // RTL: start at right (flex-start), move to left (negative x) when enabled
      return enabled ? `translateX(-${distance}px)` : 'translateX(0)';
    } else {
      // LTR: start at left, move to right when enabled
      return enabled ? `translateX(${distance}px)` : 'translateX(0)';
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={clsx(
        'relative inline-flex flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-all duration-200 ease-in-out focus:outline-none focus:ring-4 focus:ring-brand-500/10',
        sizeClasses[size].track,
        size === 'md' && 'py-[9px]', // Expand tap target to ~42px height (24px + 18px padding)
        enabled ? 'bg-brand-600 shadow-lg shadow-brand-600/20' : 'bg-surface-200',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <span
        className={clsx(
          'pointer-events-none inline-block rounded-full bg-white shadow-md ring-0 transition-all duration-200 ease-in-out',
          sizeClasses[size].thumb
        )}
        style={{ transform: getTransform() }}
      />
    </button>
  );
}
