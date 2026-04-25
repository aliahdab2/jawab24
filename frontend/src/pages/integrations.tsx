import { useState, useEffect, useCallback, type ReactElement } from 'react';
import { ZidIcon, ShopifyIcon, SallaIcon } from '@/components/landing';
import { OrderNotificationsCard } from '@/components/settings';
import { StoreAnalyticsSummary } from '@/components/analytics';
import clsx from 'clsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, PageHeader, PageSkeleton, ConfirmationModal } from '@/components/ui';
import { ecommerceApi, sallaApi, zidApi, pagesApi } from '@/lib/api';
import { toast } from 'sonner';
import {
  RefreshCw,
  Unlink,
  CheckCircle2,
  PlugZap,
  Sparkles,
  ArrowRight,
  Check,
  AlertTriangle,
  Loader2,
  Plus,
  ChevronDown,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/lib/store';
import { useIsDemoUser } from '@/features/demo';
import type { Page, EcommerceStore } from '@jawab24/shared';
import { useWorkspaceRole } from '@/hooks';
import type { NextPageWithLayout } from './_app';

/* ------------------------------------------------------------------ */
/*  Platform config — add new entries here to support more platforms   */
/* ------------------------------------------------------------------ */

type PlatformId = 'shopify' | 'salla' | 'zid';

/**
 * Public-facing readiness gate for an integration. Independent of whether
 * the code works — this controls *what we tell merchants*.
 *   live        — Connect flow open, no badge.
 *   comingSoon  — Card visible with badge, Connect disabled until launch.
 *                  Used while public listing is in App Review.
 *   hidden      — Not rendered at all in the integrations UI. Routes still
 *                  exist for early-access merchants who hit the URL directly,
 *                  but the platform doesn't appear on the page.
 *
 * Roll-out plan: each platform progresses hidden → comingSoon → live as
 * its public marketplace listing matures. Today: Shopify=comingSoon
 * (App Store listing pending), Salla + Zid hidden until Shopify ships.
 */
type PlatformStatus = 'live' | 'comingSoon' | 'hidden';

interface PlatformConfig {
  id: PlatformId;
  status: PlatformStatus;
  icon: React.ReactNode;
  iconClass: string;
  storeMetaClass: string;
  /** Returns the backend path to initiate reconnect OAuth. */
  getReconnectPath: (storeDomain: string) => string;
  getStore: () => Promise<EcommerceStore>;
  syncProducts: () => Promise<unknown>;
  disconnectStore: () => Promise<unknown>;
  linkPage: (pageId: string) => Promise<unknown>;
  unlinkPage: (pageId: string) => Promise<unknown>;
  /** Whether connect flow requires a shop domain input (Shopify only) */
  requiresDomain: boolean;
  connectStore: (shopDomain?: string) => Promise<{ authUrl: string }>;
  /** Manual recovery: re-trigger webhook registration after a connection issue.
   *  Optional — only platforms that surface webhookHealth currently support it.
   */
  reregisterWebhooks?: () => Promise<unknown>;
}

const PLATFORMS: PlatformConfig[] = [
  {
    id: 'shopify',
    status: 'comingSoon',
    icon: <ShopifyIcon className="w-8 h-8" />,
    iconClass: 'icon-bg-emerald',
    storeMetaClass: 'alert-success border',
    getReconnectPath: (domain) => `/shopify/auth?shop=${encodeURIComponent(domain)}`,
    getStore: ecommerceApi.getStore,
    syncProducts: ecommerceApi.syncProducts,
    disconnectStore: ecommerceApi.disconnectStore,
    linkPage: ecommerceApi.linkPage,
    unlinkPage: ecommerceApi.unlinkPage,
    requiresDomain: true,
    connectStore: (shopDomain) => ecommerceApi.connectStore(shopDomain!),
    reregisterWebhooks: ecommerceApi.reregisterWebhooks,
  },
  {
    id: 'salla',
    status: 'hidden',
    icon: <SallaIcon className="w-8 h-8" />,
    iconClass: 'icon-bg-brand',
    storeMetaClass: 'status-brand border',
    getReconnectPath: () => '/salla/auth',
    getStore: sallaApi.getStore,
    syncProducts: sallaApi.syncProducts,
    disconnectStore: sallaApi.disconnectStore,
    linkPage: sallaApi.linkPage,
    unlinkPage: sallaApi.unlinkPage,
    requiresDomain: false,
    connectStore: () => sallaApi.connectStore(),
  },
  {
    id: 'zid',
    status: 'hidden',
    icon: <ZidIcon className="w-8 h-8" />,
    iconClass: 'icon-bg-orange',
    storeMetaClass: 'status-orange border',
    getReconnectPath: () => '/zid/auth',
    getStore: zidApi.getStore,
    syncProducts: zidApi.syncProducts,
    disconnectStore: zidApi.disconnectStore,
    linkPage: zidApi.linkPage,
    unlinkPage: zidApi.unlinkPage,
    requiresDomain: false,
    connectStore: () => zidApi.connectStore(),
  },
];

/** Platforms that should appear in any UI surface (sidebar count badges,
 *  empty-state cards, page-link selectors). Hidden platforms still have
 *  routes for early-access merchants but stay off the public surface. */
const VISIBLE_PLATFORMS = PLATFORMS.filter((p) => p.status !== 'hidden');

/**
 * Returns the scoped translator for a platform's own namespace.
 * All three platform JSON files share identical key names (title, desc,
 * syncSuccess, etc.) so components just call t('title') — no compound keys.
 */
function usePlatformT(id: PlatformId) {
  const tShopify = useTranslations('shopify');
  const tSalla = useTranslations('salla');
  const tZid = useTranslations('zid');
  if (id === 'salla') return tSalla;
  if (id === 'zid') return tZid;
  return tShopify;
}

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
  const t = usePlatformT(platform.id);
  const tInt = useTranslations('integrations');
  const { canEdit } = useWorkspaceRole();
  const isDemoUser = useIsDemoUser();
  const [syncing, setSyncing] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const [reregistering, setReregistering] = useState(false);

  // In demo mode the seeded store has placeholder credentials, so any action
  // that hits the real platform API (sync, re-register, disconnect) will fail
  // with a cryptic error. Disable those CTAs and explain why on hover instead.
  const demoLockMessage = isDemoUser ? tInt('demoLockedAction') : undefined;
  const actionsDisabled = isDemoUser;

  const handleSync = async () => {
    setSyncing(true);
    try {
      await platform.syncProducts();
      toast.success(t('syncSuccess'));
      onSync();
    } catch {
      toast.error(t('syncError'));
    } finally {
      setSyncing(false);
    }
  };

  const handleReregister = async () => {
    if (!platform.reregisterWebhooks) return;
    setReregistering(true);
    try {
      await platform.reregisterWebhooks();
      toast.success(tInt('webhookHealth.reregisterSuccess'));
      onSync(); // refetch — health flips to 'ok' and banner disappears
    } catch {
      toast.error(tInt('webhookHealth.reregisterError'));
    } finally {
      setReregistering(false);
    }
  };

  const handleConfirmDisconnect = async () => {
    setDisconnecting(true);
    try {
      await platform.disconnectStore();
      toast.warning(t('disconnected'));
      setShowDisconnectModal(false);
      onDisconnect();
    } catch {
      toast.error(t('disconnectError'));
    } finally {
      setDisconnecting(false);
    }
  };

  const handleLinkPage = async (pageId: string) => {
    const alreadyLinked = pages.find((p) => p.id === pageId)?.ecommerceStoreId === store.id;
    try {
      if (alreadyLinked) {
        await platform.unlinkPage(pageId);
        toast.warning(t('pageUnlinked'));
      } else {
        await platform.linkPage(pageId);
        toast.success(t('pageLinked'));
      }
      onLinkPage(pageId);
    } catch {
      toast.error(t(alreadyLinked ? 'pageUnlinkError' : 'pageLinkError'));
    }
  };

  return (
    <Card className="border-none shadow-[0_10px_30px_rgba(0,0,0,0.04)] p-6 landscape:p-4">
      <div className="flex items-center gap-3 mb-4">
        <div className={clsx('w-12 h-12 rounded-2xl flex items-center justify-center landscape:w-10 landscape:h-10', platform.iconClass)}>
          {platform.icon}
        </div>
        <div className="text-start">
          <h3 className="font-bold text-lg landscape:text-base">{t('title')}</h3>
          <p className="text-sm text-muted-foreground landscape:text-xs">{tInt(`${platform.id}Desc`)}</p>
        </div>
      </div>

      <div className="space-y-4">
        {store.webhookHealth === 'pending' && (
          <div className="flex items-start gap-3 p-3 rounded-xl alert-warning border" role="status">
            <Loader2 className="w-5 h-5 mt-0.5 shrink-0 animate-spin" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-semibold">{tInt('webhookHealth.pendingTitle')}</p>
              <p className="text-muted-foreground">{tInt('webhookHealth.pendingBody')}</p>
            </div>
          </div>
        )}
        {store.webhookHealth === 'failed' && (
          <div className="flex items-start gap-3 p-3 rounded-xl alert-danger border" role="alert">
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1 text-sm">
              <p className="font-semibold">{tInt('webhookHealth.failedTitle')}</p>
              <p className="text-muted-foreground mb-2">{tInt('webhookHealth.failedBody')}</p>
              {canEdit && platform.reregisterWebhooks && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleReregister}
                  disabled={reregistering || actionsDisabled}
                  title={demoLockMessage}
                >
                  {reregistering ? (
                    <>
                      <Loader2 className="w-4 h-4 me-1 animate-spin" />
                      {tInt('webhookHealth.reregistering')}
                    </>
                  ) : tInt('webhookHealth.reregisterBtn')}
                </Button>
              )}
            </div>
          </div>
        )}
        <div className={clsx('flex items-center justify-between p-3 rounded-xl', platform.storeMetaClass)}>
          <div>
            <p className="font-semibold text-foreground">{store.storeName || store.storeDomain}</p>
            <p className="text-xs text-muted-foreground">
              {t('products')}: {store.productCount} &middot;{' '}
              {t('lastSync')}: {store.lastSyncAt ? new Date(store.lastSyncAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : t('never')}
            </p>
          </div>
          <div className="flex gap-2">
            {canEdit && <>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSync}
                disabled={syncing || actionsDisabled}
                title={demoLockMessage}
              >
                <RefreshCw className={clsx('w-4 h-4 me-1', syncing && 'animate-spin')} />
                {syncing ? t('syncing') : t('syncNow')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setShowDisconnectModal(true)}
                disabled={actionsDisabled}
                title={demoLockMessage}
              >
                <Unlink className="w-4 h-4 me-1" />
                {t('disconnect')}
              </Button>
            </>}
          </div>
        </div>

        <StoreAnalyticsSummary storeId={store.id} />

        {pages.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-2">{t('linkPage')}</p>
            <p className="text-xs text-muted-foreground mb-2">{t('linkPageDesc')}</p>
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
        title={t('title')}
        message={t('disconnectConfirm')}
        confirmText={t('disconnect')}
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
  const t = usePlatformT(platform.id);
  const tInt = useTranslations('integrations');
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
          <h3 className="font-bold text-lg landscape:text-base text-muted-foreground">{t('title')}</h3>
          <p className="text-sm text-muted-foreground landscape:text-xs">{store.storeName || store.storeDomain}</p>
        </div>
      </div>

      <div className="flex items-center justify-between p-3 rounded-xl bg-background border border-theme-border">
        <p className="text-sm text-muted-foreground">{tInt('disconnectedState')}</p>
        <Button variant="primary" size="sm" onClick={handleReconnect}>
          <PlugZap className="w-4 h-4 me-1" aria-hidden="true" />
          {tInt('reconnect')}
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Not-connected card — compelling CTA to attract merchants           */
/* ------------------------------------------------------------------ */

function NotConnectedCard({ platform }: { platform: PlatformConfig }) {
  const t = usePlatformT(platform.id);
  const tInt = useTranslations('integrations');
  const tCommon = useTranslations('common');
  const { canEdit } = useWorkspaceRole();
  const [shopDomain, setShopDomain] = useState('');
  const [connecting, setConnecting] = useState(false);

  const pid = platform.id;
  const benefits = [
    tInt(`notConnected.${pid}Benefit1`),
    tInt(`notConnected.${pid}Benefit2`),
    tInt(`notConnected.${pid}Benefit3`),
  ];

  const steps = [
    tInt('notConnected.step1'),
    tInt('notConnected.step2'),
    tInt('notConnected.step3'),
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
      toast.error(tCommon('error'));
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
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-lg landscape:text-base">{t('title')}</h3>
              {platform.status === 'comingSoon' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  {tInt('comingSoonBadge')}
                </span>
              )}
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400">
              <Sparkles className="w-3 h-3" aria-hidden="true" />
              {tInt('notConnected.freeLabel')}
            </span>
          </div>
        </div>

        {/* Headline */}
        <p className="text-sm font-semibold text-foreground mb-3">
          {tInt(`notConnected.${pid}Headline`)}
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

        {/* How it works */}
        <div className="mb-5 p-3 rounded-xl bg-muted/50">
          <p className="text-xs font-semibold text-muted-foreground mb-2">
            {tInt('notConnected.howItWorks')}
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

        {/* Connect action.
            comingSoon → swap the live OAuth flow for an honest "we're not
            ready for the public yet" message + disabled CTA. The route still
            exists for early-access merchants who land on it directly.   */}
        {platform.status === 'comingSoon' ? (
          <div className="flex flex-col gap-2 p-4 rounded-xl bg-muted/40 border border-dashed border-theme-border">
            <p className="text-sm text-muted-foreground">
              {tInt('comingSoonHelp')}
            </p>
            <Button variant="secondary" size="md" disabled className="w-full sm:w-auto">
              {tInt('comingSoonCta')}
            </Button>
          </div>
        ) : (
        <div className="flex flex-col gap-2">
          {platform.requiresDomain && (
            <div>
              <label htmlFor={`domain-${pid}`} className="block text-xs font-medium text-muted-foreground mb-1">
                {tInt(`notConnected.${pid}DomainLabel`)}
              </label>
              <input
                id={`domain-${pid}`}
                type="text"
                dir="auto"
                value={shopDomain}
                onChange={(e) => setShopDomain(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                placeholder={tInt(`notConnected.${pid}DomainPlaceholder`)}
                className={clsx(
                  'w-full px-3 py-2 rounded-lg text-sm border border-theme-border',
                  'bg-background text-foreground placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500',
                )}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {tInt(`notConnected.${pid}DomainHint`)}
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
            <span className="flex items-center gap-1.5">
              {tInt('notConnected.connectBtn')}
              {connecting ? (
                <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowRight className="w-4 h-4 transition-transform rtl:rotate-180" aria-hidden="true" />
              )}
            </span>
          </Button>
          {!platform.requiresDomain && (
            <p className="text-[11px] text-muted-foreground">
              {tInt(`notConnected.${pid}ConnectHint`)}
            </p>
          )}
        </div>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

const IntegrationsPage: NextPageWithLayout = () => {
  const tInt = useTranslations('integrations');
  const { isAuthenticated } = useAuthStore();

  const [stores, setStores] = useState<Record<string, EcommerceStore | null>>({});
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddAnother, setShowAddAnother] = useState(false);

  // Empty-state platform tab. Defaults to Shopify; manual override via the
  // tab strip is always one click away. Kept deterministic — locale-based
  // defaults sound clever but break the project's "no locale conditionals
  // in business logic" rule, and a wrong guess is worse than a click.
  const [pickerTab, setPickerTab] = useState<PlatformId>('shopify');

  // Short labels for the tab strip — platform brand names only.
  // Deliberately not reusing `t('title')` ("Shopify Integration") because
  // it duplicates the card heading and makes the tab strip look like three
  // mini-cards.
  const platformLabels: Record<PlatformId, string> = {
    shopify: tInt('platformPicker.shopify'),
    salla: tInt('platformPicker.salla'),
    zid: tInt('platformPicker.zid'),
  };

  const fetchData = useCallback(async () => {
    const storeResults: Record<string, EcommerceStore | null> = {};

    // Skip hidden platforms — no point fetching data we won't render.
    // Early-access merchants who hit a hidden-platform route directly bypass
    // this page entirely.
    const fetchPromises = VISIBLE_PLATFORMS.map(async (platform) => {
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
        title={tInt('title')}
        description={tInt('subtitle')}
      />

      <div className="space-y-6 landscape:space-y-4">
        {(() => {
          // Split platforms by current connection state so we can prioritize
          // visual hierarchy: a connected store takes the spotlight, and the
          // marketing CTAs for platforms the merchant hasn't picked are
          // demoted behind an "Add another store" toggle. When zero stores
          // are connected we keep the original three-card picker since the
          // merchant genuinely needs to choose.
          const platformsByState = VISIBLE_PLATFORMS.reduce(
            (acc, p) => {
              const store = stores[p.id];
              if (store?.isActive) acc.connected.push({ platform: p, store });
              else if (store) acc.disconnected.push({ platform: p, store });
              else acc.unconnected.push(p);
              return acc;
            },
            { connected: [] as Array<{ platform: PlatformConfig; store: EcommerceStore }>,
              disconnected: [] as Array<{ platform: PlatformConfig; store: EcommerceStore }>,
              unconnected: [] as PlatformConfig[] },
          );

          const hasAnyStore = platformsByState.connected.length > 0 || platformsByState.disconnected.length > 0;

          return (
            <>
              {platformsByState.connected.map(({ platform, store }) => (
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
              ))}

              {platformsByState.disconnected.map(({ platform, store }) => (
                <DisconnectedCard key={platform.id} platform={platform} store={store} />
              ))}

              {/* Unconnected platforms.
                  - Zero stores anywhere → tab strip + ONE platform's card.
                    Most merchants only ever connect one platform, so showing
                    three competing pitches is noise. Tabs let them pick once
                    and see the full pitch for that platform only.
                  - At least one store exists → collapse the rest behind a
                    single "Add another store" toggle.                        */}
              {!hasAnyStore && (() => {
                const selected = platformsByState.unconnected.find(p => p.id === pickerTab)
                  ?? platformsByState.unconnected[0];
                if (!selected) return null;
                // Single visible platform → no tab strip needed; just render the card.
                if (platformsByState.unconnected.length === 1) {
                  return <NotConnectedCard platform={selected} />;
                }
                return (
                  <div className="space-y-3">
                    <div
                      className="flex items-center gap-2 overflow-x-auto"
                      role="tablist"
                      aria-label={tInt('platformPickerLabel')}
                    >
                      {platformsByState.unconnected.map((platform) => {
                        const isActive = platform.id === selected.id;
                        return (
                          <button
                            key={platform.id}
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => setPickerTab(platform.id)}
                            className={clsx(
                              'flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors border',
                              isActive
                                ? 'bg-card text-foreground border-brand-400 shadow-sm'
                                : 'bg-muted/50 text-muted-foreground border-transparent hover:text-foreground hover:bg-muted',
                            )}
                          >
                            <span className={clsx('w-5 h-5 flex items-center justify-center rounded', platform.iconClass)}>
                              {platform.icon}
                            </span>
                            <span>{platformLabels[platform.id]}</span>
                          </button>
                        );
                      })}
                    </div>
                    <NotConnectedCard platform={selected} />
                  </div>
                );
              })()}

              {hasAnyStore && platformsByState.unconnected.length > 0 && (
                showAddAnother ? (
                  <div className="space-y-6 landscape:space-y-4">
                    {platformsByState.unconnected.map((platform) => (
                      <NotConnectedCard key={platform.id} platform={platform} />
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAddAnother(true)}
                    className={clsx(
                      'w-full flex items-center justify-center gap-2 p-4 rounded-2xl',
                      'border border-dashed border-theme-border',
                      'text-sm text-muted-foreground hover:text-foreground hover:border-brand-400',
                      'transition-colors',
                    )}
                    aria-expanded={false}
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    <span className="font-medium">{tInt('addAnotherStore')}</span>
                    <span className="text-xs hidden sm:inline">— {tInt('addAnotherStoreSubtitle')}</span>
                    <ChevronDown className="w-4 h-4 ms-1" aria-hidden="true" />
                  </button>
                )
              )}
            </>
          );
        })()}
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
