import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useAuthStore } from '@/lib/store';
import LandingPageContent from '@/components/landing/LandingPageContent';

/**
 * Root page (/) — the canonical landing page.
 *
 * Server renders full landing content for SEO (crawlers see real HTML).
 * Client-side: authenticated users are redirected to /dashboard.
 */
export default function Home() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const redirectedRef = useRef(false);

  const { isAuthenticated, _hasHydrated } = useAuthStore();

  useEffect(() => {
    if (_hasHydrated && !redirectedRef.current && isAuthenticated) {
      redirectedRef.current = true;
      routerRef.current.replace('/dashboard');
    }
  }, [isAuthenticated, _hasHydrated]);

  return <LandingPageContent />;
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.landing]);
