import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';

/**
 * Accent colour of a row. Owns BOTH the icon container and the hover tint so a
 * caller can never pair one accent's icon with another's hover.
 *
 * `brand` deliberately has no `dark:` hover overrides: the brand scale is
 * CSS-variable-based (`globals.css` redefines --brand-* under .dark), so it
 * already inverts on its own and a manual dark: variant would double-flip it.
 * The blue/emerald scales are raw Tailwind palettes and do need theirs.
 */
export type ChoiceRowAccent = 'blue' | 'emerald' | 'brand' | 'violet';

const ACCENT_HOVER: Record<ChoiceRowAccent, string> = {
  blue: 'hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/40 dark:hover:bg-blue-950/20',
  emerald: 'hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20',
  brand: 'hover:border-brand-300 hover:bg-brand-50/40',
  violet: 'hover:border-violet-300 dark:hover:border-violet-700 hover:bg-violet-50/40 dark:hover:bg-violet-950/20',
};

const ACCENT_ICON: Record<ChoiceRowAccent, string> = {
  blue: 'icon-bg-blue',
  emerald: 'icon-bg-emerald',
  brand: 'icon-bg-brand',
  violet: 'icon-bg-violet',
};

interface ChoiceRowProps {
  /** Decorative — rendered inside an aria-hidden container, never announced */
  icon: React.ReactNode;
  accent: ChoiceRowAccent;
  title: React.ReactNode;
  description: React.ReactNode;
  /** Optional chip beside the title (e.g. "Beta", "Recommended") */
  badge?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * One tappable option in a "pick one of these" modal: icon, title (+ optional
 * badge), description, chevron.
 *
 * Extracted because the channel picker and the WhatsApp onboarding-path
 * question render the identical row, and a copy-pasted second version would
 * drift — the accent maps below are exactly the detail that gets it wrong (the
 * brand scale inverts in dark mode, the raw palettes do not).
 */
export function ChoiceRow({ icon, accent, title, description, badge, onClick, disabled }: ChoiceRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'flex items-center gap-3 p-4 rounded-2xl border border-theme-border bg-background transition-colors text-start',
        'disabled:opacity-60',
        ACCENT_HOVER[accent],
      )}
    >
      <span
        className={clsx('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', ACCENT_ICON[accent])}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        {badge ? (
          <span className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-foreground">{title}</span>
            {badge}
          </span>
        ) : (
          <span className="block text-sm font-bold text-foreground">{title}</span>
        )}
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="w-4 h-4 text-icon-muted flex-shrink-0 rtl:rotate-180" aria-hidden="true" />
    </button>
  );
}
