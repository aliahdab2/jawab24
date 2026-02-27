import { useState, useEffect, useCallback, type ReactElement } from 'react';
import clsx from 'clsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, PageHeader, PageSkeleton } from '@/components/ui';
import { ecommerceApi, sallaApi, pagesApi } from '@/lib/api';
import { toast } from 'sonner';
import {
  ShoppingBag,
  RefreshCw,
  Unlink,
  CheckCircle2,
  Store,
} from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useAuthStore } from '@/lib/store';
import type { Page, EcommerceStore } from '@jawab24/shared';
import type { NextPageWithLayout } from './_app';

/* ------------------------------------------------------------------ */
/*  Platform config — add new entries here to support more platforms   */
/* ------------------------------------------------------------------ */

interface PlatformConfig {
  id: string;
  nameKey: TranslationKey;
  descKey: TranslationKey;
  icon: React.ReactNode;
  accentBg: string;
  accentText: string;
  accentLight: string;
  getStore: () => Promise<EcommerceStore>;
  syncProducts: () => Promise<unknown>;
  disconnectStore: () => Promise<unknown>;
  linkPage: (pageId: string) => Promise<unknown>;
  disconnectConfirmKey: TranslationKey;
  syncSuccessKey: TranslationKey;
  syncErrorKey: TranslationKey;
  disconnectedKey: TranslationKey;
  disconnectErrorKey: TranslationKey;
  pageLinkedKey: TranslationKey;
  pageLinkErrorKey: TranslationKey;
  productsKey: TranslationKey;
  lastSyncKey: TranslationKey;
  syncNowKey: TranslationKey;
  syncingKey: TranslationKey;
  disconnectKey: TranslationKey;
  neverKey: TranslationKey;
  linkPageKey: TranslationKey;
  linkPageDescKey: TranslationKey;
}

const PLATFORMS: PlatformConfig[] = [
  {
    id: 'shopify',
    nameKey: 'shopify.title' as TranslationKey,
    descKey: 'integrations.shopifyDesc' as TranslationKey,
    icon: <ShoppingBag className="w-8 h-8" />,
    accentBg: 'bg-emerald-100',
    accentText: 'text-emerald-600',
    accentLight: 'bg-emerald-50',
    getStore: ecommerceApi.getStore,
    syncProducts: ecommerceApi.syncProducts,
    disconnectStore: ecommerceApi.disconnectStore,
    linkPage: ecommerceApi.linkPage,
    disconnectConfirmKey: 'shopify.disconnectConfirm' as TranslationKey,
    syncSuccessKey: 'shopify.syncSuccess' as TranslationKey,
    syncErrorKey: 'shopify.syncError' as TranslationKey,
    disconnectedKey: 'shopify.disconnected' as TranslationKey,
    disconnectErrorKey: 'shopify.disconnectError' as TranslationKey,
    pageLinkedKey: 'shopify.pageLinked' as TranslationKey,
    pageLinkErrorKey: 'shopify.pageLinkError' as TranslationKey,
    productsKey: 'shopify.products' as TranslationKey,
    lastSyncKey: 'shopify.lastSync' as TranslationKey,
    syncNowKey: 'shopify.syncNow' as TranslationKey,
    syncingKey: 'shopify.syncing' as TranslationKey,
    disconnectKey: 'shopify.disconnect' as TranslationKey,
    neverKey: 'shopify.never' as TranslationKey,
    linkPageKey: 'shopify.linkPage' as TranslationKey,
    linkPageDescKey: 'shopify.linkPageDesc' as TranslationKey,
  },
  {
    id: 'salla',
    nameKey: 'salla.title' as TranslationKey,
    descKey: 'integrations.sallaDesc' as TranslationKey,
    icon: <Store className="w-8 h-8" />,
    accentBg: 'bg-teal-100',
    accentText: 'text-teal-600',
    accentLight: 'bg-teal-50',
    getStore: sallaApi.getStore,
    syncProducts: sallaApi.syncProducts,
    disconnectStore: sallaApi.disconnectStore,
    linkPage: sallaApi.linkPage,
    disconnectConfirmKey: 'salla.disconnectConfirm' as TranslationKey,
    syncSuccessKey: 'salla.syncSuccess' as TranslationKey,
    syncErrorKey: 'salla.syncError' as TranslationKey,
    disconnectedKey: 'salla.disconnected' as TranslationKey,
    disconnectErrorKey: 'salla.disconnectError' as TranslationKey,
    pageLinkedKey: 'salla.pageLinked' as TranslationKey,
    pageLinkErrorKey: 'salla.pageLinkError' as TranslationKey,
    productsKey: 'salla.products' as TranslationKey,
    lastSyncKey: 'salla.lastSync' as TranslationKey,
    syncNowKey: 'salla.syncNow' as TranslationKey,
    syncingKey: 'salla.syncing' as TranslationKey,
    disconnectKey: 'salla.disconnect' as TranslationKey,
    neverKey: 'salla.never' as TranslationKey,
    linkPageKey: 'salla.linkPage' as TranslationKey,
    linkPageDescKey: 'salla.linkPageDesc' as TranslationKey,
  },
];

/* ------------------------------------------------------------------ */
/*  Connected store card                                               */
/* ------------------------------------------------------------------ */

function ConnectedStoreCard({
  platform,
  store,
  pages,
  onSync,
  onDisconnect,
  onLinkPage,
}: {
  platform: PlatformConfig;
  store: EcommerceStore;
  pages: Page[];
  onSync: () => void;
  onDisconnect: () => void;
  onLinkPage: (pageId: string) => void;
}) {
  const { t } = useTranslation();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await platform.syncProducts();
      toast.success(t(platform.syncSuccessKey));
      onSync();
    } catch {
      toast.error(t(platform.syncErrorKey));
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm(t(platform.disconnectConfirmKey))) return;
    try {
      await platform.disconnectStore();
      toast.success(t(platform.disconnectedKey));
      onDisconnect();
    } catch {
      toast.error(t(platform.disconnectErrorKey));
    }
  };

  const handleLinkPage = async (pageId: string) => {
    try {
      await platform.linkPage(pageId);
      toast.success(t(platform.pageLinkedKey));
      onLinkPage(pageId);
    } catch {
      toast.error(t(platform.pageLinkErrorKey));
    }
  };

  return (
    <Card className="border-none shadow-[0_10px_30px_rgba(0,0,0,0.04)] p-6 landscape:p-4">
      <div className="flex items-center gap-3 mb-4">
        <div className={clsx('w-12 h-12 rounded-2xl flex items-center justify-center landscape:w-10 landscape:h-10', platform.accentBg, platform.accentText)}>
          {platform.icon}
        </div>
        <div className="text-start">
          <h3 className="font-bold text-lg landscape:text-base">{t(platform.nameKey)}</h3>
          <p className="text-sm text-surface-500 landscape:text-xs">{t(platform.descKey)}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className={clsx('flex items-center justify-between p-3 rounded-xl', platform.accentLight)}>
          <div>
            <p className="font-semibold text-surface-800">{store.storeName || store.storeDomain}</p>
            <p className="text-xs text-surface-600">
              {t(platform.productsKey)}: {store.productCount} &middot;{' '}
              {t(platform.lastSyncKey)}: {store.lastSyncAt ? new Date(store.lastSyncAt).toLocaleDateString() : t(platform.neverKey)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={clsx('w-4 h-4 me-1', syncing && 'animate-spin')} />
              {syncing ? t(platform.syncingKey) : t(platform.syncNowKey)}
            </Button>
            <Button variant="secondary" size="sm" onClick={handleDisconnect}>
              <Unlink className="w-4 h-4 me-1" />
              {t(platform.disconnectKey)}
            </Button>
          </div>
        </div>

        {pages.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-2">{t(platform.linkPageKey)}</p>
            <p className="text-xs text-surface-500 mb-2">{t(platform.linkPageDescKey)}</p>
            <div className="flex flex-wrap gap-2">
              {pages.map((page) => (
                <button
                  key={page.id}
                  onClick={() => handleLinkPage(page.id)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-sm border transition-colors',
                    page.ecommerceStoreId === store.id
                      ? 'bg-green-100 border-green-300 text-green-800'
                      : 'bg-white border-surface-200 text-surface-600 hover:border-green-300'
                  )}
                >
                  {page.name}
                  {page.ecommerceStoreId === store.id && <CheckCircle2 className="w-3 h-3 inline ms-1" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty connect card (not connected)                                 */
/* ------------------------------------------------------------------ */

function ConnectCard({ platform }: { platform: PlatformConfig }) {
  const { t } = useTranslation();

  return (
    <Card className="border-none shadow-[0_10px_30px_rgba(0,0,0,0.04)] p-6 landscape:p-4 flex flex-col items-center text-center">
      <div className={clsx('w-16 h-16 rounded-2xl flex items-center justify-center mb-4 landscape:w-12 landscape:h-12', platform.accentBg, platform.accentText)}>
        {platform.icon}
      </div>
      <h3 className="font-bold text-lg landscape:text-base mb-1">{t(platform.nameKey)}</h3>
      <p className="text-sm text-surface-500 mb-4 landscape:text-xs landscape:mb-3">{t(platform.descKey)}</p>
      <Button variant="primary" size="md">
        {t('integrations.connect' as TranslationKey)}
      </Button>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

const IntegrationsPage: NextPageWithLayout = () => {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthStore();

  const [stores, setStores] = useState<Record<string, EcommerceStore | null>>({});
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const storeResults: Record<string, EcommerceStore | null> = {};

    const fetchPromises = PLATFORMS.map(async (platform) => {
      try {
        const data = await platform.getStore();
        storeResults[platform.id] = data;
      } catch {
        storeResults[platform.id] = null;
      }
    });

    let fetchedPages: Page[] = [];
    try {
      const response = await pagesApi.getAll();
      const body = response.data;
      fetchedPages = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    } catch {
      // ignore
    }

    await Promise.all(fetchPromises);

    setStores(storeResults);
    setPages(fetchedPages);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
    }
  }, [isAuthenticated, fetchData]);

  const handleStoreDisconnect = (platformId: string) => {
    setStores((prev) => ({ ...prev, [platformId]: null }));
  };

  if (loading) {
    return <PageSkeleton />;
  }

  const connectedPlatforms = PLATFORMS.filter((p) => stores[p.id]);
  const unconnectedPlatforms = PLATFORMS.filter((p) => !stores[p.id]);

  return (
    <>
      <PageHeader
        title={t('integrations.title' as TranslationKey)}
        description={t('integrations.subtitle' as TranslationKey)}
      />

      <div className="space-y-6 landscape:space-y-4">
        {/* Connected integrations */}
        {connectedPlatforms.map((platform) => (
          <ConnectedStoreCard
            key={platform.id}
            platform={platform}
            store={stores[platform.id]!}
            pages={pages}
            onSync={fetchData}
            onDisconnect={() => handleStoreDisconnect(platform.id)}
            onLinkPage={() => fetchData()}
          />
        ))}

        {/* Divider between connected and unconnected */}
        {connectedPlatforms.length > 0 && unconnectedPlatforms.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-surface-200" />
            <span className="text-xs text-surface-400 font-medium">
              {t('integrations.addAnother' as TranslationKey)}
            </span>
            <div className="flex-1 border-t border-surface-200" />
          </div>
        )}

        {/* Unconnected integrations grid */}
        {unconnectedPlatforms.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 landscape:gap-3">
            {unconnectedPlatforms.map((platform) => (
              <ConnectCard key={platform.id} platform={platform} />
            ))}
          </div>
        )}
      </div>
    </>
  );
};

IntegrationsPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Integrations">{page}</DashboardLayout>
);

export default IntegrationsPage;
