import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import {
  CheckCircle2,
  Loader2,
  ShoppingBag,
  ArrowRight,
  Globe,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';
import { shopifyApi, pagesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { Page } from '@jawab24/shared';

type TFunc = (key: TranslationKey | string, params?: Record<string, string | number>) => string;

export default function ShopifyOnboarding() {
  const router = useRouter();
  const { t, language } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isRTL = language === 'ar';

  const [step, setStep] = useState(0);
  const [store, setStore] = useState<any>(null);
  const [storeLoading, setStoreLoading] = useState(true);
  const [storeError, setStoreError] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');
  const [syncResult, setSyncResult] = useState<{ synced?: number }>({});
  const [pages, setPages] = useState<Page[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, router]);

  // Fetch store info on mount
  useEffect(() => {
    async function fetchStore() {
      try {
        const res = await shopifyApi.getStore();
        setStore(res.data);
        setStoreLoading(false);
        // Auto-trigger sync
        setSyncStatus('syncing');
        try {
          const syncRes = await shopifyApi.syncProducts();
          setSyncResult(syncRes.data);
          setSyncStatus('done');
        } catch {
          setSyncStatus('error');
        }
      } catch {
        setStoreError(true);
        setStoreLoading(false);
      }
    }
    if (isAuthenticated) {
      fetchStore();
    }
  }, [isAuthenticated]);

  // Fetch pages when advancing to step 1
  const fetchPages = useCallback(async () => {
    setPagesLoading(true);
    try {
      const res = await pagesApi.getAll();
      setPages(res.data || []);
    } catch {
      setPages([]);
    }
    setPagesLoading(false);
  }, []);

  useEffect(() => {
    if (step === 1) {
      fetchPages();
    }
  }, [step, fetchPages]);

  // Link page to store
  const handleLinkPage = async () => {
    if (!selectedPageId) return;
    setLinking(true);
    try {
      await shopifyApi.linkPage(selectedPageId);
      setStep(2);
    } catch {
      // Show error but don't block
    }
    setLinking(false);
  };

  if (!isAuthenticated) return null;

  return (
    <>
      <Head>
        <title>{(t as TFunc)('shopify.onboarding.title')} | Jawab24</title>
      </Head>
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-brand-50 flex items-center justify-center p-4" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="w-full max-w-lg">
          {/* Progress indicator */}
          <div className="flex gap-2 mb-8 justify-center">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i <= step ? 'bg-emerald-500 w-12' : 'bg-surface-200 w-8'
                }`}
              />
            ))}
          </div>

          <div className="bg-white rounded-3xl shadow-xl border border-surface-200 overflow-hidden">
            <div className="p-8">
              {/* Step 0: Store Connected + Product Sync */}
              {step === 0 && (
                <div className="text-center space-y-6">
                  <div className="w-16 h-16 mx-auto bg-emerald-100 rounded-2xl flex items-center justify-center">
                    <ShoppingBag className="w-8 h-8 text-emerald-600" />
                  </div>

                  <div>
                    <h2 className="text-2xl font-bold text-surface-900 mb-2">
                      {(t as TFunc)('shopify.onboarding.storeConnected')}
                    </h2>
                    {storeLoading ? (
                      <div className="flex items-center justify-center gap-2 text-surface-500">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">{(t as TFunc)('common.loading')}</span>
                      </div>
                    ) : storeError ? (
                      <p className="text-red-500 text-sm">
                        {(t as TFunc)('shopify.onboarding.storeNotFound')}
                      </p>
                    ) : (
                      <p className="text-surface-500 font-mono text-sm">
                        {store?.shopDomain}
                      </p>
                    )}
                  </div>

                  {/* Sync status */}
                  <div className="p-4 rounded-2xl bg-surface-50 border border-surface-100">
                    {syncStatus === 'syncing' && (
                      <div className="flex items-center justify-center gap-2 text-surface-600">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm font-medium">{(t as TFunc)('shopify.onboarding.syncingProducts')}</span>
                      </div>
                    )}
                    {syncStatus === 'done' && (
                      <div className="flex items-center justify-center gap-2 text-emerald-600">
                        <CheckCircle2 className="w-5 h-5" />
                        <span className="text-sm font-medium">
                          {(t as TFunc)('shopify.onboarding.productsSynced', { count: syncResult.synced || 0 })}
                        </span>
                      </div>
                    )}
                    {syncStatus === 'error' && (
                      <div className="flex items-center justify-center gap-2 text-amber-600">
                        <XCircle className="w-4 h-4" />
                        <span className="text-sm">{(t as TFunc)('shopify.onboarding.syncError')}</span>
                      </div>
                    )}
                    {syncStatus === 'idle' && (
                      <span className="text-sm text-surface-400">{(t as TFunc)('shopify.onboarding.syncingProducts')}</span>
                    )}
                  </div>

                  <Button
                    onClick={() => setStep(1)}
                    disabled={storeLoading || storeError}
                    size="lg"
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl py-4"
                  >
                    <div className="flex items-center justify-center gap-2">
                      <span>{(t as TFunc)('shopify.onboarding.connectPage')}</span>
                      <ArrowRight className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} />
                    </div>
                  </Button>
                </div>
              )}

              {/* Step 1: Connect Facebook Page */}
              {step === 1 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <div className="w-16 h-16 mx-auto bg-blue-100 rounded-2xl flex items-center justify-center mb-4">
                      <Globe className="w-8 h-8 text-blue-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-surface-900 mb-2">
                      {(t as TFunc)('shopify.onboarding.connectPage')}
                    </h2>
                    <p className="text-surface-500 text-sm">
                      {(t as TFunc)('shopify.onboarding.connectPageDesc')}
                    </p>
                  </div>

                  {pagesLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-surface-400" />
                    </div>
                  ) : pages.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-surface-500 text-sm">
                        {(t as TFunc)('shopify.onboarding.noPages')}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {pages.map((page) => (
                        <button
                          key={page.id}
                          onClick={() => setSelectedPageId(page.id)}
                          className={`w-full p-4 rounded-xl border-2 transition-all text-start ${
                            selectedPageId === page.id
                              ? 'border-emerald-500 bg-emerald-50'
                              : 'border-surface-200 hover:border-surface-300'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full border-2 ${
                              selectedPageId === page.id
                                ? 'border-emerald-500 bg-emerald-500'
                                : 'border-surface-300'
                            }`} />
                            <div>
                              <p className="font-medium text-surface-900 text-sm">{page.name}</p>
                              {page.instagramUsername && (
                                <p className="text-surface-400 text-xs">@{page.instagramUsername}</p>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-3">
                    <Button
                      onClick={() => setStep(0)}
                      variant="outline"
                      className="flex-1 rounded-2xl"
                    >
                      {(t as TFunc)('common.back')}
                    </Button>
                    <Button
                      onClick={handleLinkPage}
                      disabled={!selectedPageId || linking}
                      size="lg"
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl"
                    >
                      {linking ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        (t as TFunc)('shopify.onboarding.linkPage')
                      )}
                    </Button>
                  </div>

                  {/* Skip option */}
                  <button
                    onClick={() => router.push('/dashboard')}
                    className="w-full text-center text-sm text-surface-400 hover:text-surface-600 transition-colors"
                  >
                    {(t as TFunc)('shopify.onboarding.skipForNow')}
                  </button>
                </div>
              )}

              {/* Step 2: Done */}
              {step === 2 && (
                <div className="text-center space-y-6">
                  <div className="w-16 h-16 mx-auto bg-emerald-100 rounded-2xl flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-surface-900 mb-2">
                      {(t as TFunc)('shopify.onboarding.done')}
                    </h2>
                    <p className="text-surface-500 text-sm leading-relaxed">
                      {(t as TFunc)('shopify.onboarding.doneDesc')}
                    </p>
                  </div>
                  <Button
                    onClick={() => router.push('/dashboard')}
                    size="lg"
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl py-4"
                  >
                    {(t as TFunc)('shopify.onboarding.goToDashboard')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
