import { useState, useEffect, useCallback, useRef } from 'react';
import clsx from 'clsx';
import { Card, Button } from '@/components/ui';
import { ecommerceApi, pagesApi } from '@/lib/api';
import { toast } from 'sonner';
import {
  ShoppingBag,
  RefreshCw,
  Unlink,
  CheckCircle2,
} from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import type { Page, EcommerceStore } from '@jawab24/shared';

/** @deprecated Use EcommerceSection instead */
export function ShopifySection() {
  const { t } = useTranslation();
  const [store, setStore] = useState<EcommerceStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pages, setPages] = useState<Page[]>([]);

  const isMounted = useRef(true);
  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  const fetchStore = useCallback(async () => {
    try {
      const data = await ecommerceApi.getStore();
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

  const handleSync = async () => {
    setSyncing(true);
    try {
      await ecommerceApi.syncProducts();
      toast.success(t('shopify.syncSuccess' as TranslationKey));
      await fetchStore();
    } catch {
      toast.error(t('shopify.syncError' as TranslationKey));
    } finally {
      if (isMounted.current) setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm(t('shopify.disconnectConfirm' as TranslationKey))) return;
    try {
      await ecommerceApi.disconnectStore();
      if (isMounted.current) setStore(null);
      toast.warning(t('shopify.disconnected' as TranslationKey));
    } catch {
      toast.error(t('shopify.disconnectError' as TranslationKey));
    }
  };

  const handleLinkPage = async (pageId: string) => {
    try {
      await ecommerceApi.linkPage(pageId);
      toast.success(t('shopify.pageLinked' as TranslationKey));
    } catch {
      toast.error(t('shopify.pageLinkError' as TranslationKey));
    }
  };

  // Only show when a store is connected
  if (loading || !store) return null;

  return (
    <div className="mt-10 animate-slide-up" style={{ animationDelay: '0.15s' }}>
      <Card className="p-6 landscape:p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
            <ShoppingBag className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h3 className="font-bold text-lg">{t('shopify.title' as TranslationKey)}</h3>
            <p className="text-sm text-surface-500">{t('shopify.desc' as TranslationKey)}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-green-50 rounded-xl">
            <div>
              <p className="font-semibold text-green-800">{store.storeName || store.storeDomain}</p>
              <p className="text-xs text-green-600">
                {t('shopify.products' as TranslationKey)}: {store.productCount} &middot;{' '}
                {t('shopify.lastSync' as TranslationKey)}: {store.lastSyncAt ? new Date(store.lastSyncAt).toLocaleDateString() : t('shopify.never' as TranslationKey)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={handleSync} disabled={syncing}>
                <RefreshCw className={`w-4 h-4 me-1 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? t('shopify.syncing' as TranslationKey) : t('shopify.syncNow' as TranslationKey)}
              </Button>
              <Button variant="secondary" size="sm" onClick={handleDisconnect}>
                <Unlink className="w-4 h-4 me-1" />
                {t('shopify.disconnect' as TranslationKey)}
              </Button>
            </div>
          </div>

          {pages.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">{t('shopify.linkPage' as TranslationKey)}</p>
              <p className="text-xs text-surface-500 mb-2">{t('shopify.linkPageDesc' as TranslationKey)}</p>
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
