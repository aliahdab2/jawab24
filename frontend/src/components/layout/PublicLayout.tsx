import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { useAuthStore } from '@/lib/store';
import { BrandLogo, Button, VersionBadge } from '@/components/ui';
import { BRAND_ASSETS } from '@/constants/brand';
import { getNextLocale } from '@/utils/locale';
// Direct import, not the '@/hooks' barrel — PublicLayout ships to every public
// visitor and the 53-re-export barrel drags app-only hooks into that chunk.
import { useIsEmbedded } from '@/hooks/useIsEmbedded';
import { isIOSNative } from '@/lib/capacitor';

/**
 * PublicLayout - Unified layout for all public-facing pages
 * 
 * This component provides:
 * - Consistent header height (h-16 on mobile, h-20 on larger screens)
 * - Automatic safe area handling for mobile devices
 * - Language toggle
 * - Login/Dashboard button based on auth state
 * 
 * Usage:
 * - Set `variant="landing"` for full landing pages with navigation
 * - Set `variant="minimal"` for login/auth pages with minimal header
 * - Set `variant="none"` for legal pages that handle their own layout
 */

interface PublicLayoutProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  variant?: 'landing' | 'minimal' | 'none';
  /** Show footer (only for landing variant) - reserved for future use */
  _showFooter?: boolean;
  /** Additional className for the main content area */
  contentClassName?: string;
}

export function PublicLayout({
  children,
  title,
  description,
  variant = 'landing',
  _showFooter = false,
  contentClassName = '',
}: PublicLayoutProps) {
  const tLanding = useTranslations('landing');
  const tc = useTranslations('common');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const { setLanguage } = useLanguage();
  const { isAuthenticated } = useAuthStore();
  const isEmbedded = useIsEmbedded();

  // Embedded mode: strip all site chrome. Used when the native app opens
  // a marketing/pricing URL inside Capacitor Browser — we don't want the
  // user to navigate to /landing, /blog, etc. from inside that browser.
  const effectiveVariant = isEmbedded ? 'none' : variant;

  const toggleLanguage = () => {
    setLanguage(getNextLocale(locale));
  };

  const pageTitle = title ? `${title} | ${BRAND_ASSETS.meta.appName}` : BRAND_ASSETS.meta.appTitle;

  // For 'none' variant, just render children with direction
  if (effectiveVariant === 'none') {
    return (
      <>
        <Head>
          <title>{pageTitle}</title>
          {description && <meta name="description" content={description} />}
        </Head>
        <div>
          {children}
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
        {description && <meta name="description" content={description} />}
      </Head>

      <div className="flex-1 overflow-y-auto bg-background">
        {/* Header - Consistent across all public pages */}
        {effectiveVariant === 'landing' && (
          <nav className="fixed top-0 w-full z-50 bg-card/80 backdrop-blur-md border-b border-theme-border pt-safe px-safe-landscape">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between h-16 sm:h-20">
                {/* Logo */}
                <Link href="/" className="flex items-center gap-2 sm:gap-3 group">
                  <BrandLogo
                    variant="main"
                    className="w-10 h-10 sm:w-12 sm:h-12 transition-transform group-hover:rotate-6 flex-shrink-0"
                  />
                  <span className="font-display font-bold text-xl sm:text-2xl text-foreground tracking-tight">
                    {BRAND_ASSETS.meta.appName}
                  </span>
                </Link>

                {/* Actions */}
                <div className="flex items-center gap-1 sm:gap-4">
                  <Link
                    href="/blog"
                    className="hidden md:block px-4 py-2 text-sm font-bold text-muted-foreground hover:text-brand-600 rounded-xl hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-all"
                  >
                    {tLanding('nav.blog')}
                  </Link>
                  {!isIOSNative() && (
                    <Link
                      href="/pricing"
                      className="hidden md:block px-4 py-2 text-sm font-bold text-muted-foreground hover:text-brand-600 rounded-xl hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-all"
                    >
                      {tLanding('nav.pricing')}
                    </Link>
                  )}
                  <button
                    onClick={toggleLanguage}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-bold text-muted-foreground hover:text-brand-600 rounded-lg sm:rounded-xl hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-all"
                  >
                    {tc('switchLanguage')}
                  </button>
                  {isAuthenticated ? (
                    <Link href="/dashboard">
                      <Button size="sm" className="font-bold shadow-xl shadow-brand-500/20 px-3 sm:px-6 text-xs sm:text-sm py-2 sm:py-2.5">
                        {tNav('dashboard') || 'Dashboard'}
                      </Button>
                    </Link>
                  ) : (
                    <Link href="/login?redirect=%2Fdashboard">
                      <Button variant="secondary" size="sm" className="font-bold border-none bg-surface-100">
                        {tLanding('nav.login')}
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </nav>
        )}

        {effectiveVariant === 'minimal' && (
          <div className="flex items-center justify-between px-6 lg:px-12 h-16 sm:h-20">
            <Link href="/" className="flex items-center gap-2 sm:gap-3 group">
              <BrandLogo
                variant="main"
                className="w-9 h-9 sm:w-12 sm:h-12 group-hover:rotate-6 transition-transform"
              />
              <span className="font-display font-bold text-lg sm:text-2xl text-foreground tracking-tight">
                {BRAND_ASSETS.meta.appName}
              </span>
            </Link>
            <button
              onClick={toggleLanguage}
              className="px-4 py-2 text-sm font-bold text-muted-foreground hover:text-brand-600 rounded-xl hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-all"
            >
              {tc('switchLanguage')}
            </button>
          </div>
        )}

        {/* Main Content */}
        <main
          className={`
            ${effectiveVariant === 'landing' ? 'pt-header' : ''}
            ${contentClassName}
          `}
        >
          {children}
        </main>

        {/* Version Badge */}
        <VersionBadge />
      </div>
    </>
  );
}

export default PublicLayout;
