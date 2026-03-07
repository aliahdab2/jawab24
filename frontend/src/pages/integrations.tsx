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
  Sparkles,
  ArrowRight,
  Check,
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
  iconClass: string;
  storeMetaClass: string;
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
  /** Whether connect flow requires a shop domain input (Shopify = true, Salla = false) */
  requiresDomain: boolean;
  /** Initiate the connect flow. Returns { authUrl } for redirect. */
  connectStore: (shopDomain?: string) => Promise<{ authUrl: string }>;
}

const PLATFORMS: PlatformConfig[] = [
  {
    id: 'shopify',
    nameKey: 'shopify.title' as TranslationKey,
    descKey: 'integrations.shopifyDesc' as TranslationKey,
    icon: <ShoppingBag className="w-8 h-8" />,
    iconClass: 'icon-bg-emerald',
    storeMetaClass: 'alert-success border',
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
    requiresDomain: true,
    connectStore: (shopDomain) => ecommerceApi.connectStore(shopDomain!),
  },
  {
    id: 'salla',
    nameKey: 'salla.title' as TranslationKey,
    descKey: 'integrations.sallaDesc' as TranslationKey,
    icon: <Store className="w-8 h-8" />,
    iconClass: 'icon-bg-brand',
    storeMetaClass: 'status-brand border',
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
    requiresDomain: false,
    connectStore: () => sallaApi.connectStore(),
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
        <div className={clsx('w-12 h-12 rounded-2xl flex items-center justify-center landscape:w-10 landscape:h-10', platform.iconClass)}>
          {platform.icon}
        </div>
        <div className="text-start">
          <h3 className="font-bold text-lg landscape:text-base">{t(platform.nameKey)}</h3>
          <p className="text-sm text-muted-foreground landscape:text-xs">{t(platform.descKey)}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className={clsx('flex items-center justify-between p-3 rounded-xl', platform.storeMetaClass)}>
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
                      ? 'status-success border'
                      : 'bg-card border-theme-border text-muted-foreground hover:border-brand-400'
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
        <div className={clsx('w-12 h-12 rounded-2xl flex items-center justify-center landscape:w-10 landscape:h-10 opacity-60', platform.iconClass)}>
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
/*  Not-connected card — compelling CTA to attract merchants           */
/* ------------------------------------------------------------------ */

function NotConnectedCard({ platform }: { platform: PlatformConfig }) {
  const { t } = useTranslation();
  const [shopDomain, setShopDomain] = useState('');
  const [connecting, setConnecting] = useState(false);

  const pid = platform.id; // 'shopify' | 'salla'
  const benefits = [
    t(`integrations.notConnected.${pid}.benefit1` as TranslationKey),
    t(`integrations.notConnected.${pid}.benefit2` as TranslationKey),
    t(`integrations.notConnected.${pid}.benefit3` as TranslationKey),
  ];

  const steps = [
    t('integrations.notConnected.step1' as TranslationKey),
    t('integrations.notConnected.step2' as TranslationKey),
    t('integrations.notConnected.step3' as TranslationKey),
  ];

  const handleConnect = async () => {
    if (platform.requiresDomain && !shopDomain.trim()) return;
    setConnecting(true);
    try {
      const { authUrl } = await platform.connectStore(
        platform.requiresDomain ? shopDomain.trim() : undefined,
      );
      window.location.href = authUrl;
    } catch {
      toast.error(t('common.error' as TranslationKey));
      setConnecting(false);
    }
  };

  return (
    <Card className="border-none shadow-[0_10px_30px_rgba(0,0,0,0.04)] overflow-hidden">
      <div className="p-6 landscape:p-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className={clsx(
            'w-12 h-12 rounded-2xl flex items-center justify-center landscape:w-10 landscape:h-10',
            platform.iconClass,
          )}>
            {platform.icon}
          </div>
          <div className="text-start">
            <h3 className="font-bold text-lg landscape:text-base">{t(platform.nameKey)}</h3>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400">
              <Sparkles className="w-3 h-3" aria-hidden="true" />
              {t('integrations.notConnected.freeLabel' as TranslationKey)}
            </span>
          </div>
        </div>

        {/* Headline */}
        <p className="text-sm font-semibold text-foreground mb-3">
          {t(`integrations.notConnected.${pid}.headline` as TranslationKey)}
        </p>

        {/* Benefits */}
        <ul className="space-y-2 mb-5">
          {benefits.map((benefit, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-brand-500" aria-hidden="true" />
              {benefit}
            </li>
          ))}
        </ul>

        {/* How it works — 3 simple steps */}
        <div className="mb-5 p-3 rounded-xl bg-muted/50">
          <p className="text-xs font-semibold text-muted-foreground mb-2">
            {t('integrations.notConnected.howItWorks' as TranslationKey)}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className={clsx(
                  'flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold',
                  'bg-brand-500 text-white',
                )}>
                  {i + 1}
                </span>
                <span>{step}</span>
                {i < steps.length - 1 && (
                  <ArrowRight className="w-3 h-3 flex-shrink-0 text-icon-muted" aria-hidden="true" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Connect action */}
        <div className="flex flex-col gap-2">
          {platform.requiresDomain && (
            <div>
              <label htmlFor={`domain-${pid}`} className="block text-xs font-medium text-muted-foreground mb-1">
                {t(`integrations.notConnected.${pid}.domainLabel` as TranslationKey)}
              </label>
              <input
                id={`domain-${pid}`}
                type="text"
                dir="ltr"
                value={shopDomain}
                onChange={(e) => setShopDomain(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                placeholder={t(`integrations.notConnected.${pid}.domainPlaceholder` as TranslationKey)}
                className={clsx(
                  'w-full px-3 py-2 rounded-lg text-sm border border-theme-border',
                  'bg-background text-foreground placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500',
                )}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {t(`integrations.notConnected.${pid}.domainHint` as TranslationKey)}
              </p>
            </div>
          )}
          <Button
            variant="primary"
            size="md"
            onClick={handleConnect}
            disabled={connecting || (platform.requiresDomain && !shopDomain.trim())}
            className="w-full sm:w-auto"
          >
            {connecting ? (
              <RefreshCw className="w-4 h-4 me-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowRight className="w-4 h-4 me-1.5" aria-hidden="true" />
            )}
            {t('integrations.notConnected.connectBtn' as TranslationKey)}
          </Button>
          {!platform.requiresDomain && (
            <p className="text-[11px] text-muted-foreground">
              {t(`integrations.notConnected.${pid}.connectHint` as TranslationKey)}
            </p>
          )}
        </div>
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

  return (
    <>
      <PageHeader
        title={t('integrations.title' as TranslationKey)}
        description={t('integrations.subtitle' as TranslationKey)}
      />

      <div className="space-y-6 landscape:space-y-4">
        {PLATFORMS.map((platform) => {
          const store = stores[platform.id];

          if (!store) {
            return <NotConnectedCard key={platform.id} platform={platform} />;
          }

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
