import Link from 'next/link';
import React from 'react';
import { useLocale } from 'next-intl';
import { isNativePlatform } from '@/lib/capacitor';
import { openExternalUrl } from '@/lib/openExternalUrl';
import { buildWebUrl } from '@/lib/webUrl';

interface UpgradeCTAProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Single source of truth for routing users to pricing.
 *
 * - Web: renders a Next.js Link to `/pricing`.
 * - Native (iOS/Android): opens the web pricing page in Capacitor
 *   Browser with `?embedded=1`. Jawab24's layouts honor that flag and
 *   strip their chrome (nav, sidebar, bottom bar), so the user sees
 *   only the pricing → checkout funnel and can't wander out of the
 *   in-app browser. Google Play / App Store policy requires the
 *   actual purchase to happen on the web anyway.
 *
 * We render a `<div role="button">` on native rather than a `<button>`
 * because callers usually pass a styled `<Button>` child — nesting a
 * `<button>` inside a `<button>` is invalid HTML. Keyboard handling
 * (Enter / Space) is preserved.
 */
export function UpgradeCTA({ children, className }: UpgradeCTAProps) {
  const locale = useLocale();

  if (isNativePlatform()) {
    const handleActivate = () => {
      // Forward the in-app theme so the web pricing page matches — otherwise
      // a light-mode user would see jawab24.com render in dark (no shared
      // localStorage between the native web view and Capacitor Browser).
      const isDark = document.documentElement.classList.contains('dark');
      const theme = isDark ? 'dark' : 'light';
      void openExternalUrl(
        buildWebUrl(`/pricing?embedded=1&theme=${theme}`, locale),
      );
    };
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleActivate();
          }
        }}
        className={className}
      >
        {children}
      </div>
    );
  }

  return (
    <Link href="/pricing" className={className}>
      {children}
    </Link>
  );
}
