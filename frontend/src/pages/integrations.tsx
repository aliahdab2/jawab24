import { useState, useEffect, useCallback, type ReactElement } from 'react';
import clsx from 'clsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, PageHeader, PageSkeleton, ConfirmationModal } from '@/components/ui';
import { ecommerceApi, sallaApi, pagesApi } from '@/lib/api';
import { toast } from 'sonner';
import {
  ShoppingBag,
  RefreshCw,
  Unlink,
  CheckCircle2,
  Store,
  PlugZap,
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
  /**
   * Returns the backend path to initiate reconnect OAuth.
   * Shopify needs ?shop=domain; Salla needs no param.
   */
  getReconnectPath: (storeDomain: string) => string;
  getStore: () => Promise<EcommerceStore>;
  syncProducts: () => Promise<unknown>;
  disconnectStore: () => Promise<unknown>;
  linkPage: (pageId: string) => Promise<unknown>;
  unlinkPage: (pageId: string) => Promise<unknown>;
  disconnectConfirmKey: TranslationKey;
  syncSuccessKey: TranslationKey;
  syncErrorKey: TranslationKey;
  disconnectedKey: TranslationKey;
  disconnectErrorKey: TranslationKey;
  pageLinkedKey: TranslationKey;
  pageLinkErrorKey: TranslationKey;
  pageUnlinkedKey: TranslationKey;
  pageUnlinkErrorKey: TranslationKey;
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
    getReconnectPath: (domain) => `/shopify/auth?shop=${encodeURIComponent(domain)}`,
    getStore: ecommerceApi.getStore,
    syncProducts: ecommerceApi.syncProducts,
    disconnectStore: ecommerceApi.disconnectStore,
    linkPage: ecommerceApi.linkPage,
    unlinkPage: ecommerceApi.unlinkPage,
    disconnectConfirmKey: 'shopify.disconnectConfirm' as TranslationKey,
    syncSuccessKey: 'shopify.syncSuccess' as TranslationKey,
    syncErrorKey: 'shopify.syncError' as TranslationKey,
    disconnectedKey: 'shopify.disconnected' as TranslationKey,
    disconnectErrorKey: 'shopify.disconnectError' as TranslationKey,
    pageLinkedKey: 'shopify.pageLinked' as TranslationKey,
    pageLinkErrorKey: 'shopify.pageLinkError' as TranslationKey,
    pageUnlinkedKey: 'shopify.pageUnlinked' as TranslationKey,
    pageUnlinkErrorKey: 'shopify.pageUnlinkError' as TranslationKey,
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
    getReconnectPath: () => '/salla/auth',
    getStore: sallaApi.getStore,
    syncProducts: sallaApi.syncProducts,
    disconnectStore: sallaApi.disconnectStore,
    linkPage: sallaApi.linkPage,
    unlinkPage: sallaApi.unlinkPage,
    disconnectConfirmKey: 'salla.disconnectConfirm' as TranslationKey,
    syncSuccessKey: 'salla.syncSuccess' as TranslationKey,
    syncErrorKey: 'salla.syncError' as TranslationKey,
    disconnectedKey: 'salla.disconnected' as TranslationKey,
    disconnectErrorKey: 'salla.disconnectError' as TranslationKey,
    pageLinkedKey: 'salla.pageLinked' as TranslationKey,
    pageLinkErrorKey: 'salla.pageLinkError' as TranslationKey,
    pageUnlinkedKey: 'salla.pageUnlinked' as TranslationKey,
    pageUnlinkErrorKey: 'salla.pageUnlinkError' as TranslationKey,
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
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

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

  const handleConfirmDisconnect = async () => {
    setDisconnecting(true);
    try {
      await platform.disconnectStore();
      toast.warning(t(platform.disconnectedKey));
      setShowDisconnectModal(false);
      onDisconnect();
    } catch {
      toast.error(t(platform.disconnectErrorKey));
    } finally {
      setDisconnecting(false);
    }
  };

  const handleLinkPage = async (pageId: string) => {
    const alreadyLinked = pages.find((p) => p.id === pageId)?.ecommerceStoreId === store.id;

    try {
      if (alreadyLinked) {
        await platform.unlinkPage(pageId);
        toast.warning(t(platform.pageUnlinkedKey));
      } else {
        await platform.linkPage(pageId);
        toast.success(t(platform.pageLinkedKey));
      }
      onLinkPage(pageId);
    } catch {
      toast.error(t(alreadyLinked ? platform.pageUnlinkErrorKey : platform.pageLinkErrorKey));
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
          <p className="text-sm text-muted-foreground landscape:text-xs">{t(platform.descKey)}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className={clsx('flex items-center justify-between p-3 rounded-xl', platform.accentLight)}>
          <div>
            <p className="font-semibold text-foreground">{store.storeName || store.storeDomain}</p>
            <p className="text-xs text-muted-foreground">
              {t(platform.productsKey)}: {store.productCount} &middot;{' '}
              {t(platform.lastSyncKey)}: {store.lastSyncAt ? new Date(store.lastSyncAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : t(platform.neverKey)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={clsx('w-4 h-4 me-1', syncing && 'animate-spin')} />
              {syncing ? t(platform.syncingKey) : t(platform.syncNowKey)}
            </Button>
            <Button variant="danger" size="sm" onClick={() => setShowDisconnectModal(true)}>
              <Unlink className="w-4 h-4 me-1" />
              {t(platform.disconnectKey)}
            </Button>
          </div>
        </div>

        {pages.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-2">{t(platform.linkPageKey)}</p>
            <p className="text-xs text-muted-foreground mb-2">{t(platform.linkPageDescKey)}</p>
            <div className="flex flex-wrap gap-2">
              {pages.map((page) => (
                <button
                  key={page.id}
                  onClick={() => handleLinkPage(page.id)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-sm border transition-colors',
                    page.ecommerceStoreId === store.id
                      ? 'bg-green-100 border-green-300 text-green-800 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300'
                      : 'bg-card border-theme-border text-muted-foreground hover:border-green-300'
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

      <ConfirmationModal
        isOpen={showDisconnectModal}
        onClose={() => setShowDisconnectModal(false)}
        onConfirm={handleConfirmDisconnect}
        title={t(platform.nameKey)}
        message={t(platform.disconnectConfirmKey)}
        confirmText={t(platform.disconnectKey)}
        variant="warning"
        loading={disconnecting}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Disconnected store card — shown after disconnect, allows reconnect */
/* ------------------------------------------------------------------ */

function DisconnectedCard({ platform, store }: { platform: PlatformConfig; store: EcommerceStore }) {
  const { t } = useTranslation();
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

  const handleReconnect = () => {
    window.location.href = apiBase + platform.getReconnectPath(store.storeDomain);
  };

  return (
    <Card className="border-none shadow-[0_10px_30px_rgba(0,0,0,0.04)] p-6 landscape:p-4">
      <div className="flex items-center gap-3 mb-4">
        <div className={clsx('w-12 h-12 rounded-2xl flex items-center justify-center landscape:w-10 landscape:h-10 opacity-50', platform.accentBg, platform.accentText)}>
          {platform.icon}
        </div>
        <div className="text-start">
          <h3 className="font-bold text-lg landscape:text-base text-muted-foreground">{t(platform.nameKey)}</h3>
          <p className="text-sm text-muted-foreground landscape:text-xs">{store.storeName || store.storeDomain}</p>
        </div>
      </div>

      <div className="flex items-center justify-between p-3 rounded-xl bg-background border border-theme-border">
        <p className="text-sm text-muted-foreground">{t('integrations.disconnectedState' as TranslationKey)}</p>
        <Button variant="primary" size="sm" onClick={handleReconnect}>
          <PlugZap className="w-4 h-4 me-1" aria-hidden="true" />
          {t('integrations.reconnect' as TranslationKey)}
        </Button>
      </div>
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

  // After disconnect, flip isActive locally — no extra API call needed
  const handleStoreDisconnect = (platformId: string) => {
    setStores((prev) => {
      const existing = prev[platformId];
      if (!existing) return prev;
      return { ...prev, [platformId]: { ...existing, isActive: false } };
    });
  };

  if (loading) {
    return <PageSkeleton />;
  }

  // Only render platforms where the API returned a store record (active or inactive)
  const visiblePlatforms = PLATFORMS.filter((p) => stores[p.id] !== null);

  return (
    <>
      <PageHeader
        title={t('integrations.title' as TranslationKey)}
        description={t('integrations.subtitle' as TranslationKey)}
      />

      <div className="space-y-6 landscape:space-y-4">
        {visiblePlatforms.map((platform) => {
          const store = stores[platform.id]!;
          return store.isActive ? (
            <ConnectedStoreCard
              key={platform.id}
              platform={platform}
              store={store}
              pages={pages}
              onSync={fetchData}
              onDisconnect={() => handleStoreDisconnect(platform.id)}
              onLinkPage={() => fetchData()}
            />
          ) : (
            <DisconnectedCard key={platform.id} platform={platform} store={store} />
          );
        })}
      </div>
    </>
  );
};

IntegrationsPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Stores">{page}</DashboardLayout>
);

export default IntegrationsPage;
