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
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { shopifyApi, pagesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { useEcommerceStoreSync } from '@/hooks/useEcommerceStoreSync';
import { StoreAutoReplyRow } from '@/components/onboarding/StoreAutoReplyRow';
import type { Page } from '@jawab24/shared';



const TOTAL_STEPS = 4;

export default function ShopifyOnboarding() {
  const router = useRouter();
  const t = useTranslations('shopify');
  const tc = useTranslations('common');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [step, setStep] = useState(0);
  const {
    store, storeLoading, storeError, syncStatus, syncResult,
    retrySync: handleRetrySync,
  } = useEcommerceStoreSync(shopifyApi, isAuthenticated && step >= 1);
  const [pages, setPages] = useState<Page[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  // The linked PAGE, not just its name: `autoReplyEnabled` is gate 1 of the
  // reply chain and outranks the workspace switches, so StoreAutoReplyRow needs
  // the row itself to tell the truth about whether replies can reach anyone.
  const [linkedPage, setLinkedPage] = useState<Page | null>(null);
  const [linking, setLinking] = useState(false);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, router]);

  // Fetch pages when advancing to step 2
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
    if (step === 2) {
      fetchPages();
    }
  }, [step, fetchPages]);

  // Link page to store
  const handleLinkPage = async () => {
    if (!selectedPageId) return;
    setLinking(true);
    try {
      await shopifyApi.linkPage(selectedPageId);
      const page = pages.find((p) => p.id === selectedPageId);
      setLinkedPage(page ?? null);
      setStep(3);
    } catch {
      toast.error(t('pageLinkError'));
    }
    setLinking(false);
  };

  if (!isAuthenticated) return null;

  const benefits = [
    t('onboarding.welcomeBenefit1'),
    t('onboarding.welcomeBenefit2'),
    t('onboarding.welcomeBenefit3'),
  ];

  return (
    <>
      <Head>
        <title>{t('onboarding.title')} | Jawab24</title>
      </Head>
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-brand-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          {/* Progress indicator */}
          <div className="flex gap-2 mb-8 justify-center">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i <= step ? 'bg-emerald-500 w-12' : 'bg-muted w-8'
                }`}
              />
            ))}
          </div>

          <div className="bg-card rounded-3xl shadow-xl border border-theme-border overflow-hidden">
            <div className="p-8">
              {/* Step 0: Welcome / Value Prop */}
              {step === 0 && (
                <div className="text-center space-y-6">
                  <div className="w-16 h-16 mx-auto bg-emerald-100 rounded-2xl flex items-center justify-center">
                    <Sparkles className="w-8 h-8 text-emerald-600" />
                  </div>

                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">
                      {t('onboarding.welcomeTitle')}
                    </h2>
                    <p className="text-muted-foreground text-sm">
                      {t('onboarding.welcomeSubtitle')}
                    </p>
                  </div>

                  <div className="space-y-3 text-start">
                    {benefits.map((benefit, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-background border border-theme-border">
                        <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-foreground">{benefit}</span>
                      </div>
                    ))}
                  </div>

                  <Button
                    onClick={() => setStep(1)}
                    size="lg"
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl py-4"
                  >
                    <div className="flex items-center justify-center gap-2">
                      <span>{t('onboarding.welcomeCta')}</span>
                      <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                    </div>
                  </Button>
                </div>
              )}

              {/* Step 1: Store Connected + Product Sync */}
              {step === 1 && (
                <div className="text-center space-y-6">
                  <div className="w-16 h-16 mx-auto bg-emerald-100 rounded-2xl flex items-center justify-center">
                    <ShoppingBag className="w-8 h-8 text-emerald-600" />
                  </div>

                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">
                      {t('onboarding.storeConnected')}
                    </h2>
                    {storeLoading ? (
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">{tc('loading')}</span>
                      </div>
                    ) : storeError ? (
                      <p className="text-red-500 text-sm">
                        {t('onboarding.storeNotFound')}
                      </p>
                    ) : (
                      <p className="text-muted-foreground font-mono text-sm">
                        {store?.storeDomain}
                      </p>
                    )}
                  </div>

                  {/* Sync status */}
                  <div className="p-4 rounded-2xl bg-background border border-theme-border">
                    {syncStatus === 'syncing' && (
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm font-medium">{t('onboarding.syncingProducts')}</span>
                      </div>
                    )}
                    {syncStatus === 'done' && (
                      <div className="flex items-center justify-center gap-2 text-emerald-600">
                        <CheckCircle2 className="w-5 h-5" />
                        <span className="text-sm font-medium">
                          {t('onboarding.productsSynced', { count: syncResult.synced || 0 })}
                        </span>
                      </div>
                    )}
                    {syncStatus === 'error' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-center gap-2 text-amber-600">
                          <XCircle className="w-4 h-4" />
                          <span className="text-sm">{t('onboarding.syncError')}</span>
                        </div>
                        <div className="flex justify-center">
                          <button
                            onClick={handleRetrySync}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-700 rounded-xl text-sm font-medium hover:bg-amber-200 transition-colors"
                          >
                            <RefreshCw className="w-4 h-4" />
                            {t('onboarding.retrySync')}
                          </button>
                        </div>
                      </div>
                    )}
                    {syncStatus === 'idle' && (
                      <span className="text-sm text-muted-foreground">{t('onboarding.syncingProducts')}</span>
                    )}
                  </div>

                  {/* Allow continue during sync */}
                  {syncStatus === 'syncing' && !storeLoading && !storeError && (
                    <p className="text-xs text-muted-foreground">
                      {t('onboarding.syncBackground')}
                    </p>
                  )}

                  <Button
                    onClick={() => setStep(2)}
                    disabled={storeLoading || storeError}
                    size="lg"
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl py-4"
                  >
                    <div className="flex items-center justify-center gap-2">
                      <span>{t('onboarding.connectPage')}</span>
                      <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                    </div>
                  </Button>
                </div>
              )}

              {/* Step 2: Connect Facebook Page */}
              {step === 2 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <div className="w-16 h-16 mx-auto bg-blue-100 rounded-2xl flex items-center justify-center mb-4">
                      <Globe className="w-8 h-8 text-blue-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">
                      {t('onboarding.connectPage')}
                    </h2>
                    <p className="text-muted-foreground text-sm">
                      {t('onboarding.connectPageDesc')}
                    </p>
                  </div>

                  {pagesLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : pages.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground text-sm">
                        {t('onboarding.noPages')}
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
                              : 'border-theme-border hover:border-surface-300'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full border-2 ${
                              selectedPageId === page.id
                                ? 'border-emerald-500 bg-emerald-500'
                                : 'border-surface-300'
                            }`} />
                            <div>
                              <p className="font-medium text-foreground text-sm">{page.name}</p>
                              {page.instagramUsername && (
                                <p className="text-muted-foreground text-xs">@{page.instagramUsername}</p>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-3">
                    <Button
                      onClick={() => setStep(1)}
                      variant="ghost"
                      className="flex-1 rounded-2xl"
                    >
                      {tc('back')}
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
                        t('onboarding.linkPage')
                      )}
                    </Button>
                  </div>

                  {/* Skip option */}
                  <button
                    onClick={() => router.push('/dashboard')}
                    className="w-full text-center text-sm text-muted-foreground hover:text-muted-foreground transition-colors"
                  >
                    {t('onboarding.skipForNow')}
                  </button>
                </div>
              )}

              {/* Step 3: Done — show accomplishments */}
              {step === 3 && (
                <div className="text-center space-y-6">
                  <div className="w-16 h-16 mx-auto bg-emerald-100 rounded-2xl flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">
                      {t('onboarding.done')}
                    </h2>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      {t('onboarding.doneDesc')}
                    </p>
                  </div>

                  {/* Accomplishment checklist */}
                  <div className="space-y-2 text-start">
                    {(syncResult.synced ?? 0) > 0 && (
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                        <span className="text-sm text-foreground font-medium">
                          {t('onboarding.doneCheckProducts', { count: syncResult.synced || 0 })}
                        </span>
                      </div>
                    )}
                    {linkedPage && (
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                        <span className="text-sm text-foreground font-medium">
                          {t('onboarding.doneCheckPage', { name: linkedPage.name })}
                        </span>
                      </div>
                    )}
                    <StoreAutoReplyRow page={linkedPage} />
                  </div>

                  <Button
                    onClick={() => router.push('/dashboard')}
                    size="lg"
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl py-4"
                  >
                    {t('onboarding.goToDashboard')}
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

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.shopifyOnboard]);
