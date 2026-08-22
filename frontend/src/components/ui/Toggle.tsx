import clsx from 'clsx';
import { useLocale } from 'next-intl';
import { isRTLLocale } from '@/utils/locale';

interface ToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  'aria-label'?: string;
}

export function Toggle({ enabled, onChange, disabled = false, size = 'md', 'aria-label': ariaLabel }: ToggleProps) {
  const locale = useLocale();
  const isRTL = isRTLLocale(locale);
  
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
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={clsx(
        'relative inline-flex items-center flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-all duration-200 ease-in-out focus:outline-none focus:ring-4 focus:ring-brand-500/10',
        'before:content-[""] before:absolute before:inset-x-0 before:-inset-y-[10px] before:z-0', // Expand tap target without affecting layout
        sizeClasses[size].track,
        // The OFF track needs its own dark value: the surface scale INVERTS in dark mode,
        // so `surface-200` lands on rgb(14 22 38) — all but identical to `--card`
        // rgb(14 24 42) at 1.02:1. The track vanished and the white knob read as a lone
        // dot, leaving no way to tell the control was a toggle, let alone that it was off.
        // `surface-500` measures 2.01:1 against the card. Deliberately not pushed to the
        // 3:1 of WCAG 1.4.11: the knob carries the identification at 8.81:1 against the
        // track, and the state is read from knob POSITION plus the grey/teal hue change,
        // not from track luminance. 2:1 is also where iOS and Material land their dark
        // off-tracks — going lighter makes "off" read as active, which is worse.
        enabled ? 'bg-brand-600 shadow-lg shadow-brand-600/20' : 'bg-surface-200 dark:bg-surface-500',
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
