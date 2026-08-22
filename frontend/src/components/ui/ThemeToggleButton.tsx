import { Sun, Moon } from 'lucide-react';
// Direct import, NOT the '@/hooks' barrel: this button renders on the public
// landing/pricing pages, and the barrel drags api-consuming hooks with it.
import { useTheme } from '@/hooks/useTheme';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';

interface ThemeToggleButtonProps {
  variant?: 'nav' | 'sidebar' | 'compact';
  sidebarOpen?: boolean;
}

export function ThemeToggleButton({ variant = 'nav', sidebarOpen = true }: ThemeToggleButtonProps) {
  const { theme, setTheme } = useTheme();
  const tNav = useTranslations('nav');

  // When system, resolve against OS preference
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const handleToggle = () => setTheme(isDark ? 'light' : 'dark');

  // Show the icon for what you'll switch TO — the GitHub/Vercel standard
  const Icon = isDark ? Sun : Moon;
  const label = tNav('theme');

  if (variant === 'compact') {
    return (
      <button
        onClick={handleToggle}
        aria-label={label}
        className="ms-auto p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-all flex-shrink-0"
      >
        <Icon className="w-4 h-4" aria-hidden="true" />
      </button>
    );
  }

  if (variant === 'sidebar') {
    return (
      <button
        onClick={handleToggle}
        aria-label={label}
        className={clsx(
          'w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-zinc-400 hover:bg-white/5 hover:text-white transition-all duration-300 group/nav relative',
          !sidebarOpen && 'justify-center'
        )}
      >
        <Icon className="w-6 h-6 flex-shrink-0 transition-transform group-hover/nav:scale-110" />
        {sidebarOpen && (
          <span className="font-bold text-sm tracking-tight">{label}</span>
        )}
        {!sidebarOpen && (
          <span className="nav-tooltip">
            {label}
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={handleToggle}
      aria-label={label}
      className="p-2 text-muted-foreground hover:text-brand-600 rounded-lg sm:rounded-xl hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-all"
    >
      <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
    </button>
  );
}
