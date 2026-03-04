import { useEffect } from 'react';
import { useUIStore } from '@/lib/store';
import type { Theme } from '@/lib/store';

/**
 * Theme engine hook — applies/removes the `.dark` class on <html>
 * based on the user's persisted preference (light / dark / system).
 *
 * For 'system': listens to OS prefers-color-scheme changes in real-time.
 * Also syncs Capacitor StatusBar style on native platforms.
 */
export function useTheme() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  useEffect(() => {
    const root = document.documentElement;

    const applyTheme = (isDark: boolean) => {
      if (isDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }

      // Sync Capacitor StatusBar on native
      syncNativeStatusBar(isDark);
    };

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mq.matches);

      const handleChange = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mq.addEventListener('change', handleChange);
      return () => mq.removeEventListener('change', handleChange);
    } else {
      applyTheme(theme === 'dark');
    }
  }, [theme]);

  return { theme, setTheme };
}

/** Update native StatusBar style to match theme (non-blocking, fire-and-forget) */
function syncNativeStatusBar(isDark: boolean) {
  if (typeof window === 'undefined') return;

  import('@capacitor/core').then(({ Capacitor }) => {
    if (!Capacitor.isNativePlatform()) return;

    import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
      // Style.Dark = white icons (for dark backgrounds)
      // Style.Light = dark icons (for light backgrounds)
      StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => {});
    }).catch(() => {});
  }).catch(() => {});
}

export type { Theme };
