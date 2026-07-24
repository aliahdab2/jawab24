import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Skeleton } from '@/components/ui';
import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';

/**
 * Legacy route — the catalog now lives on /business (B1). CLIENT-side redirect
 * because `next.config` redirects do not run under `output:'export'`
 * (Capacitor static build). Preserves the deep-link params both existing
 * entry points rely on: `?page=<id>` (page picker) and `import=1`
 * (sessionStorage import-draft hand-off from the Business Info editor).
 */
function CatalogRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    const { page, import: importFlag } = router.query;
    const params = new URLSearchParams();
    if (typeof page === 'string' && page) params.set('page', page);
    if (importFlag === '1') params.set('import', '1');
    const qs = params.toString();
    router.replace(qs ? `/business?${qs}` : '/business');
  }, [router, router.isReady]);

  return (
    <div className="space-y-3 mt-4" aria-busy="true">
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
    </div>
  );
}

export default function CatalogPage() {
  return (
    <DashboardLayout title="Products & Services">
      <CatalogRedirect />
    </DashboardLayout>
  );
}

export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.catalog]);
