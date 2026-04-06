import { useState, useEffect, useCallback, type ReactElement } from 'react';
import { ZidIcon } from '@/components/landing';
import { OrderNotificationsCard } from '@/components/settings';
import clsx from 'clsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, PageHeader, PageSkeleton, ConfirmationModal } from '@/components/ui';
import { ecommerceApi, sallaApi, zidApi, pagesApi } from '@/lib/api';
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
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/lib/store';
import type { Page, EcommerceStore } from '@jawab24/shared';
import { useWorkspaceRole } from '@/hooks';
import type { NextPageWithLayout } from './_app';

/** Routes namespace-prefixed keys (e.g. 'shopify.title') to the correct scoped translator. */
function usePlatformT() {
  const tShopify = useTranslations('shopify');
  const tSalla = useTranslations('salla');
  const tZid = useTranslations('zid');
  const tInt = useTranslations('integrations');
  const tCommon = useTranslations('common');
  return (key: string, params?: Record<string, string | number>): string => {
    const dot = key.indexOf('.');
    if (dot < 0) return key;
    const ns = key.slice(0, dot);
    const k = key.slice(dot + 1);
    if (ns === 'shopify') return params ? tShopify(k, params) : tShopify(k);
    if (ns === 'salla') return params ? tSalla(k, params) : tSalla(k);
    if (ns === 'zid') return params ? tZid(k, params) : tZid(k);
    if (ns === 'common') return params ? tCommon(k, params) : tCommon(k);
    return params ? tInt(k, params) : tInt(k);
  };
}

/* ------------------------------------------------------------------ */
/*  Platform config — add new entries here to support more platforms   */
/* ------------------------------------------------------------------ */

interface PlatformConfig {
  id: string;
  nameKey: string;
  descKey: string;
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
  disconnectConfirmKey: string;
  syncSuccessKey: string;
  syncErrorKey: string;
  disconnectedKey: string;
  disconnectErrorKey: string;
  pageLinkedKey: string;
  pageLinkErrorKey: string;
  pageUnlinkedKey: string;
  pageUnlinkErrorKey: string;
  productsKey: string;
  lastSyncKey: string;
  syncNowKey: string;
  syncingKey: string;
  disconnectKey: string;
  neverKey: string;
  linkPageKey: string;
  linkPageDescKey: string;
  /** Whether connect flow requires a shop domain input (Shopify = true, Salla = false) */
  requiresDomain: boolean;
  /** Initiate the connect flow. Returns { authUrl } for redirect. */
  connectStore: (shopDomain?: string) => Promise<{ authUrl: string }>;
}

const PLATFORMS: PlatformConfig[] = [
  {
    id: 'shopify',
    nameKey: 'shopify.title',
    descKey: 'integrations.shopifyDesc',
    icon: <ShoppingBag className="w-8 h-8" />,
    iconClass: 'icon-bg-emerald',
    storeMetaClass: 'alert-success border',
    getReconnectPath: (domain) => `/shopify/auth?shop=${encodeURIComponent(domain)}`,
    getStore: ecommerceApi.getStore,
    syncProducts: ecommerceApi.syncProducts,
    disconnectStore: ecommerceApi.disconnectStore,
    linkPage: ecommerceApi.linkPage,
    unlinkPage: ecommerceApi.unlinkPage,
    disconnectConfirmKey: 'shopify.disconnectConfirm',
    syncSuccessKey: 'shopify.syncSuccess',
    syncErrorKey: 'shopify.syncError',
    disconnectedKey: 'shopify.disconnected',
    disconnectErrorKey: 'shopify.disconnectError',
    pageLinkedKey: 'shopify.pageLinked',
    pageLinkErrorKey: 'shopify.pageLinkError',
    pageUnlinkedKey: 'shopify.pageUnlinked',
    pageUnlinkErrorKey: 'shopify.pageUnlinkError',
    productsKey: 'shopify.products',
    lastSyncKey: 'shopify.lastSync',
    syncNowKey: 'shopify.syncNow',
    syncingKey: 'shopify.syncing',
    disconnectKey: 'shopify.disconnect',
    neverKey: 'shopify.never',
    linkPageKey: 'shopify.linkPage',
    linkPageDescKey: 'shopify.linkPageDesc',
    requiresDomain: true,
    connectStore: (shopDomain) => ecommerceApi.connectStore(shopDomain!),
  },
  {
    id: 'salla',
    nameKey: 'salla.title',
    descKey: 'integrations.sallaDesc',
    icon: <Store className="w-8 h-8" />,
    iconClass: 'icon-bg-brand',
    storeMetaClass: 'status-brand border',
    getReconnectPath: () => '/salla/auth',
    getStore: sallaApi.getStore,
    syncProducts: sallaApi.syncProducts,
    disconnectStore: sallaApi.disconnectStore,
    linkPage: sallaApi.linkPage,
    unlinkPage: sallaApi.unlinkPage,
    disconnectConfirmKey: 'salla.disconnectConfirm',
    syncSuccessKey: 'salla.syncSuccess',
    syncErrorKey: 'salla.syncError',
    disconnectedKey: 'salla.disconnected',
    disconnectErrorKey: 'salla.disconnectError',
    pageLinkedKey: 'salla.pageLinked',
    pageLinkErrorKey: 'salla.pageLinkError',
    pageUnlinkedKey: 'salla.pageUnlinked',
    pageUnlinkErrorKey: 'salla.pageUnlinkError',
    productsKey: 'salla.products',
    lastSyncKey: 'salla.lastSync',
    syncNowKey: 'salla.syncNow',
    syncingKey: 'salla.syncing',
    disconnectKey: 'salla.disconnect',
    neverKey: 'salla.never',
    linkPageKey: 'salla.linkPage',
    linkPageDescKey: 'salla.linkPageDesc',
    requiresDomain: false,
    connectStore: () => sallaApi.connectStore(),
  },
  {
    id: 'zid',
    nameKey: 'zid.title',
    descKey: 'integrations.zidDesc',
    icon: <ZidIcon className="w-8 h-8" />,
    iconClass: 'icon-bg-orange',
    storeMetaClass: 'status-orange border',
    getReconnectPath: () => '/zid/auth',
    getStore: zidApi.getStore,
    syncProducts: zidApi.syncProducts,
    disconnectStore: zidApi.disconnectStore,
    linkPage: zidApi.linkPage,
    unlinkPage: zidApi.unlinkPage,
    disconnectConfirmKey: 'zid.disconnectConfirm',
    syncSuccessKey: 'zid.syncSuccess',
    syncErrorKey: 'zid.syncError',
    disconnectedKey: 'zid.disconnected',
    disconnectErrorKey: 'zid.disconnectError',
    pageLinkedKey: 'zid.pageLinked',
    pageLinkErrorKey: 'zid.pageLinkError',
    pageUnlinkedKey: 'zid.pageUnlinked',
    pageUnlinkErrorKey: 'zid.pageUnlinkError',
    productsKey: 'zid.products',
    lastSyncKey: 'zid.lastSync',
    syncNowKey: 'zid.syncNow',
    syncingKey: 'zid.syncing',
    disconnectKey: 'zid.disconnect',
    neverKey: 'zid.never',
    linkPageKey: 'zid.linkPage',
    linkPageDescKey: 'zid.linkPageDesc',
    requiresDomain: false,
    connectStore: () => zidApi.connectStore(),
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
  const t = usePlatformT();
  const { canEdit } = useWorkspaceRole();
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
            {canEdit && <>
              <Button variant="secondary" size="sm" onClick={handleSync} disabled={syncing}>
                <RefreshCw className={clsx('w-4 h-4 me-1', syncing && 'animate-spin')} />
                {syncing ? t(platform.syncingKey) : t(platform.syncNowKey)}
              </Button>
              <Button variant="danger" size="sm" onClick={() => setShowDisconnectModal(true)}>
                <Unlink className="w-4 h-4 me-1" />
                {t(platform.disconnectKey)}
              </Button>
            </>}
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
                  onClick={canEdit ? () => handleLinkPage(page.id) : undefined}
                  disabled={!canEdit}
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
  const t = usePlatformT();
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
        <p className="text-sm text-muted-foreground">{t('integrations.disconnectedState')}</p>
        <Button variant="primary" size="sm" onClick={handleReconnect}>
          <PlugZap className="w-4 h-4 me-1" aria-hidden="true" />
          {t('integrations.reconnect')}
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Not-connected card — compelling CTA to attract merchants           */
/* ------------------------------------------------------------------ */

function NotConnectedCard({ platform }: { platform: PlatformConfig }) {
  const t = usePlatformT();
  const { canEdit } = useWorkspaceRole();
  const [shopDomain, setShopDomain] = useState('');
  const [connecting, setConnecting] = useState(false);

  const pid = platform.id; // 'shopify' | 'salla'
  const benefits = [
    t(`integrations.notConnected.${pid}Benefit1`),
    t(`integrations.notConnected.${pid}Benefit2`),
    t(`integrations.notConnected.${pid}Benefit3`),
  ];

  const steps = [
    t('integrations.notConnected.step1'),
    t('integrations.notConnected.step2'),
    t('integrations.notConnected.step3'),
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
      toast.error(t('common.error'));
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
              {t('integrations.notConnected.freeLabel')}
            </span>
          </div>
        </div>

        {/* Headline */}
        <p className="text-sm font-semibold text-foreground mb-3">
          {t(`integrations.notConnected.${pid}Headline`)}
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
            {t('integrations.notConnected.howItWorks')}
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
                {t(`integrations.notConnected.${pid}DomainLabel`)}
              </label>
              <input
                id={`domain-${pid}`}
                type="text"
                dir="ltr"
                value={shopDomain}
                onChange={(e) => setShopDomain(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                placeholder={t(`integrations.notConnected.${pid}DomainPlaceholder`)}
                className={clsx(
                  'w-full px-3 py-2 rounded-lg text-sm border border-theme-border',
                  'bg-background text-foreground placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500',
                )}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {t(`integrations.notConnected.${pid}DomainHint`)}
              </p>
            </div>
          )}
          <Button
            variant="primary"
            size="md"
            onClick={handleConnect}
            disabled={!canEdit || connecting || (platform.requiresDomain && !shopDomain.trim())}
            className="w-full sm:w-auto"
          >
            {connecting ? (
              <RefreshCw className="w-4 h-4 me-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowRight className="w-4 h-4 me-1.5" aria-hidden="true" />
            )}
            {t('integrations.notConnected.connectBtn')}
          </Button>
          {!platform.requiresDomain && (
            <p className="text-[11px] text-muted-foreground">
              {t(`integrations.notConnected.${pid}ConnectHint`)}
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
  const t = usePlatformT();
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
        title={t('integrations.title')}
        description={t('integrations.subtitle')}
      />

      <div className="space-y-6 landscape:space-y-4">
        {PLATFORMS.map((platform) => {
          const store = stores[platform.id];

          if (!store) {
            return <NotConnectedCard key={platform.id} platform={platform} />;
          }

          return store.isActive ? (
            <div key={platform.id} className="space-y-4">
              <ConnectedStoreCard
                platform={platform}
                store={store}
                pages={pages}
                onSync={fetchData}
                onDisconnect={() => handleStoreDisconnect(platform.id)}
                onLinkPage={() => fetchData()}
              />
              <OrderNotificationsCard storeId={store.id} />
            </div>
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

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.integrations]);
