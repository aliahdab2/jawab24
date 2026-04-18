import Link from 'next/link';
import React from 'react';
import { useTranslations } from 'next-intl';
import { isNativePlatform } from '@/lib/capacitor';

interface UpgradeCTAProps {
  children: React.ReactNode;
  className?: string;
  /**
   * How the CTA collapses on native (iOS/Android), where in-app purchases
   * happen on the web, not in the app:
   * - 'block' (default): replace children with a full-width info card
   *   telling the user to upgrade at jawab24.com.
   * - 'inline': keep the provided visual but render it non-interactively
   *   (e.g. a "Business+" badge stays visible but no longer links out).
   */
  nativeVariant?: 'block' | 'inline';
}

/**
 * Single source of truth for routing users to pricing.
 * - Web: renders a Next.js Link to `/pricing`.
 * - Native: renders a non-interactive fallback — B2B SaaS best practice
 *   (Slack, Notion, HubSpot) is to not surface purchase flows inside the
 *   mobile app. Prevents users from being trapped inside the Capacitor
 *   in-app browser after tapping an upgrade button.
 */
export function UpgradeCTA({
  children,
  className,
  nativeVariant = 'block',
}: UpgradeCTAProps) {
  const t = useTranslations('subscription');

  if (isNativePlatform()) {
    if (nativeVariant === 'inline') {
      return (
        <span
          className={className}
          role="note"
          aria-label={t('availableOnHigherPlan')}
          title={t('availableOnHigherPlan')}
        >
          {children}
        </span>
      );
    }
    return (
      <div className="mt-5 p-4 rounded-xl bg-surface-100 dark:bg-surface-900/50 text-sm text-muted-foreground text-center leading-relaxed">
        {t('upgradeOnWeb')}
      </div>
    );
  }

  return (
    <Link href="/pricing" className={className}>
      {children}
    </Link>
  );
}
