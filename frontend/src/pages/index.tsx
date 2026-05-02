import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuthStore } from '@/lib/store';
import { isIOSNative } from '@/lib/capacitor';
import LandingPageContent from '@/components/landing/LandingPageContent';

/**
 * Root page (/) — the canonical landing page.
 *
 * Server renders full landing content for SEO (crawlers see real HTML).
 * Client-side: authenticated users are redirected to /dashboard.
 * iOS native (App Store Guideline 3.1.1 reader-app): unauthenticated users
 * are redirected to /login — landing has pricing CTAs that Apple forbids.
 */
export default function Home() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const redirectedRef = useRef(false);
  const [iosBlock, setIosBlock] = useState(false);

  const { isAuthenticated, _hasHydrated } = useAuthStore();

  useEffect(() => {
    if (redirectedRef.current) return;
    if (isIOSNative() && !isAuthenticated) {
      setIosBlock(true);
      redirectedRef.current = true;
      routerRef.current.replace('/login');
      return;
    }
    if (_hasHydrated && isAuthenticated) {
      redirectedRef.current = true;
      routerRef.current.replace('/dashboard');
    }
  }, [isAuthenticated, _hasHydrated]);

  if (iosBlock) return null;

  return <LandingPageContent />;
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.landing]);
