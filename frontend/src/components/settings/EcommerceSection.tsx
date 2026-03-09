import { useState, useEffect, useCallback, useRef } from 'react';
import clsx from 'clsx';
import { Card, Button } from '@/components/ui';
import { ecommerceApi, sallaApi, pagesApi } from '@/lib/api';
import { toast } from 'sonner';
import {
  ShoppingBag,
  RefreshCw,
  Unlink,
  CheckCircle2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Page, EcommerceStore } from '@jawab24/shared';

export function EcommerceSection() {
  const t = useTranslations('shopify');
  const [store, setStore] = useState<EcommerceStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pages, setPages] = useState<Page[]>([]);

  const isMounted = useRef(true);
  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  const fetchStore = useCallback(async () => {
    // Try Shopify first, then Salla
    try {
      const data = await ecommerceApi.getStore();
      if (isMounted.current) setStore(data);
      return;
    } catch {
      // Not a Shopify store — try Salla
    }
    try {
      const data = await sallaApi.getStore();
      if (isMounted.current) setStore(data);
    } catch {
      if (isMounted.current) setStore(null);
    }
  }, []);

  const fetchPages = useCallback(async () => {
    try {
      const response = await pagesApi.getAll();
      if (isMounted.current) setPages(response.data || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      await Promise.all([fetchStore(), fetchPages()]);
      if (isMounted.current) setLoading(false);
    };
    init();
  }, [fetchStore, fetchPages]);

  const getApiForPlatform = (platform?: string) => {
    if (platform === 'salla') return sallaApi;
    return ecommerceApi;
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const storeApi = getApiForPlatform(store?.platform);
      await storeApi.syncProducts();
      toast.success(t('syncSuccess'));
      await fetchStore();
    } catch {
      toast.error(t('syncError'));
    } finally {
      if (isMounted.current) setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm(t('disconnectConfirm'))) return;
    try {
      const storeApi = getApiForPlatform(store?.platform);
      await storeApi.disconnectStore();
      if (isMounted.current) setStore(null);
      toast.warning(t('disconnected'));
    } catch {
      toast.error(t('disconnectError'));
    }
  };

  const handleLinkPage = async (pageId: string) => {
    try {
      const storeApi = getApiForPlatform(store?.platform);
      await storeApi.linkPage(pageId);
      toast.success(t('pageLinked'));
    } catch {
      toast.error(t('pageLinkError'));
    }
  };

  // Only show when a store is actually connected
  if (loading || !store) return null;

  return (
    <div className="mt-10 animate-slide-up" style={{ animationDelay: '0.15s' }}>
      <Card className="p-6 landscape:p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
            <ShoppingBag className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h3 className="font-bold text-lg">{t('title')}</h3>
            <p className="text-sm text-surface-500">{t('desc')}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-green-50 rounded-xl">
            <div>
              <p className="font-semibold text-green-800">{store.storeName || store.storeDomain}</p>
              <p className="text-xs text-green-600">
                {t('products')}: {store.productCount} &middot;{' '}
                {t('lastSync')}: {store.lastSyncAt ? new Date(store.lastSyncAt).toLocaleDateString() : t('never')}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={handleSync} disabled={syncing}>
                <RefreshCw className={`w-4 h-4 me-1 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? t('syncing') : t('syncNow')}
              </Button>
              <Button variant="secondary" size="sm" onClick={handleDisconnect}>
                <Unlink className="w-4 h-4 me-1" />
                {t('disconnect')}
              </Button>
            </div>
          </div>

          {pages.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">{t('linkPage')}</p>
              <p className="text-xs text-surface-500 mb-2">{t('linkPageDesc')}</p>
              <div className="flex flex-wrap gap-2">
                {pages.map((page) => (
                  <button
                    key={page.id}
                    onClick={() => handleLinkPage(page.id)}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-sm border transition-colors',
                      page.ecommerceStoreId === store.id
                        ? 'bg-green-100 border-green-300 text-green-800'
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
      </Card>
    </div>
  );
}
