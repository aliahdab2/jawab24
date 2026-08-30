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
import { zidApi, pagesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { getEmbeddedPlatform } from '@/lib/embeddedSession';
import { openTopLevelAuthenticated } from '@/lib/embeddedBreakout';
import { useEcommerceStoreSync } from '@/hooks/useEcommerceStoreSync';
import { StoreAutoReplyRow } from '@/components/onboarding/StoreAutoReplyRow';
import type { Page } from '@jawab24/shared';

const TOTAL_STEPS = 4;

export default function ZidOnboarding() {
  const router = useRouter();
  const t = useTranslations('zid');
  const tc = useTranslations('common');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const [step, setStep] = useState(0);
  const {
    store, storeLoading, storeError, syncStatus, syncResult,
    retrySync: handleRetrySync,
  } = useEcommerceStoreSync(zidApi, isAuthenticated && step >= 1);
  const [pages, setPages] = useState<Page[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [linkedPageName, setLinkedPageName] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const isEmbedded = typeof window !== 'undefined' && getEmbeddedPlatform() !== null;

  useEffect(() => {
    // Wait for persisted auth to rehydrate before judging the session — a bare
    // `!isAuthenticated` on first paint races the async store and would bounce a
    // freshly-authenticated merchant. And an EMBEDDED session must never be sent
    // to /login: inside the platform dashboard that IS the sign-in prompt this
    // flow exists to remove (the embedded entry re-mints instead). See M-5.
    if (!hasHydrated || isEmbedded) return;
    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [hasHydrated, isAuthenticated, isEmbedded, router]);

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

  const handleLinkPage = async () => {
    if (!selectedPageId) return;
    setLinking(true);
    try {
      await zidApi.linkPage(selectedPageId);
      const page = pages.find((p) => p.id === selectedPageId);
      setLinkedPageName(page?.name || null);
      setStep(3);
    } catch {
      toast.error(t('pageLinkError'));
    }
    setLinking(false);
  };

  // Blank until authenticated — but never for an embedded tab mid-handoff
  // (the embedded entry sets auth just before routing here; a race must not
  // flash and it must not fall through to the /login redirect above).
  if (!isAuthenticated && !isEmbedded) return null;

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
      <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-brand-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          {/* Progress indicator */}
          <div className="flex gap-2 mb-8 justify-center">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i <= step ? 'bg-teal-600 w-12' : 'bg-muted w-8'
                }`}
              />
            ))}
          </div>

          <div className="bg-card rounded-3xl shadow-xl border border-theme-border overflow-hidden">
            <div className="p-8">
              {/* Step 0: Welcome / Value Prop */}
              {step === 0 && (
                <div className="text-center space-y-6">
                  <div className="w-16 h-16 mx-auto bg-teal-100 rounded-2xl flex items-center justify-center">
                    <Sparkles className="w-8 h-8 text-teal-700" />
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
                        <CheckCircle2 className="w-5 h-5 text-teal-600 flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-foreground">{benefit}</span>
                      </div>
                    ))}
                  </div>

                  <Button
                    onClick={() => setStep(1)}
                    size="lg"
                    className="w-full bg-teal-700 hover:bg-teal-800 text-white rounded-2xl py-4"
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
                  <div className="w-16 h-16 mx-auto bg-teal-100 rounded-2xl flex items-center justify-center">
                    <ShoppingBag className="w-8 h-8 text-teal-700" />
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
                        {store?.storeName || store?.storeDomain}
                      </p>
                    )}
                  </div>

                  <div className="p-4 rounded-2xl bg-background border border-theme-border">
                    {syncStatus === 'syncing' && (
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm font-medium">{t('onboarding.syncingProducts')}</span>
                      </div>
                    )}
                    {syncStatus === 'done' && (
                      <div className="flex items-center justify-center gap-2 text-teal-700">
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

                  {syncStatus === 'syncing' && !storeLoading && !storeError && (
                    <p className="text-xs text-muted-foreground">
                      {t('onboarding.syncBackground')}
                    </p>
                  )}

                  <Button
                    onClick={() => setStep(2)}
                    disabled={storeLoading || storeError}
                    size="lg"
                    className="w-full bg-teal-700 hover:bg-teal-800 text-white rounded-2xl py-4"
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
                    <div className="text-center py-8 space-y-4">
                      <p className="text-muted-foreground text-sm">
                        {t('onboarding.noPages')}
                      </p>
                      {/* Actionable, not a dead end. Connecting a Facebook page
                          needs the full first-party app (facebook.com refuses to
                          be framed), so from the embedded surface we break OUT to
                          a new top-level tab; on the normal web we navigate in
                          place. Either way the merchant has a way forward. */}
                      <Button
                        onClick={() => {
                          // Land on the pages screen, whose own empty state
                          // carries the connect-a-page action. Embedded: break
                          // out to a top-level tab that ARRIVES SIGNED IN
                          // (facebook.com can't be framed, and this merchant has
                          // no credentials to pass a login wall with); web:
                          // navigate in place.
                          if (isEmbedded) {
                            void openTopLevelAuthenticated('/pages');
                          } else {
                            router.push('/pages');
                          }
                        }}
                        size="lg"
                        className="bg-teal-700 hover:bg-teal-800 text-white rounded-2xl px-6"
                      >
                        <div className="flex items-center justify-center gap-2">
                          <span>{t('onboarding.connectFacebookCta')}</span>
                          <ArrowRight className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
                        </div>
                      </Button>
                      {isEmbedded && (
                        <p className="text-subtle text-xs">
                          {t('onboarding.connectFacebookNewTabHint')}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {pages.map((page) => (
                        <button
                          key={page.id}
                          onClick={() => setSelectedPageId(page.id)}
                          className={`w-full p-4 rounded-xl border-2 transition-all text-start ${
                            selectedPageId === page.id
                              ? 'border-teal-600 bg-teal-50'
                              : 'border-theme-border hover:border-surface-300'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full border-2 ${
                              selectedPageId === page.id
                                ? 'border-teal-600 bg-teal-600'
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
                      className="flex-1 bg-teal-700 hover:bg-teal-800 text-white rounded-2xl"
                    >
                      {linking ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        t('onboarding.linkPage')
                      )}
                    </Button>
                  </div>

                  <button
                    onClick={() => router.push('/dashboard')}
                    className="w-full text-center text-sm text-muted-foreground hover:text-muted-foreground transition-colors"
                  >
                    {t('onboarding.skipForNow')}
                  </button>
                </div>
              )}

              {/* Step 3: Done */}
              {step === 3 && (
                <div className="text-center space-y-6">
                  <div className="w-16 h-16 mx-auto bg-teal-100 rounded-2xl flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-teal-700" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">
                      {t('onboarding.done')}
                    </h2>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      {t('onboarding.doneDesc')}
                    </p>
                  </div>

                  <div className="space-y-2 text-start">
                    {(syncResult.synced ?? 0) > 0 && (
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-teal-50 border border-teal-200">
                        <CheckCircle2 className="w-5 h-5 text-teal-700 flex-shrink-0" />
                        <span className="text-sm text-foreground font-medium">
                          {t('onboarding.doneCheckProducts', { count: syncResult.synced || 0 })}
                        </span>
                      </div>
                    )}
                    {linkedPageName && (
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-teal-50 border border-teal-200">
                        <CheckCircle2 className="w-5 h-5 text-teal-700 flex-shrink-0" />
                        <span className="text-sm text-foreground font-medium">
                          {t('onboarding.doneCheckPage', { name: linkedPageName })}
                        </span>
                      </div>
                    )}
                    <StoreAutoReplyRow />
                  </div>

                  <Button
                    onClick={() => router.push('/dashboard')}
                    size="lg"
                    className="w-full bg-teal-700 hover:bg-teal-800 text-white rounded-2xl py-4"
                  >
                    {t('onboarding.goToDashboard')}
                  </Button>

                  {/* D-102: delivery/payment policies are not API-syncable —
                      route the merchant to the /business facts editor. */}
                  {linkedPageName && (
                    <Button
                      onClick={() => router.push(selectedPageId ? `/business?page=${selectedPageId}` : '/business')}
                      variant="ghost"
                      className="w-full rounded-2xl"
                    >
                      {t('onboarding.policiesNudge')}
                    </Button>
                  )}
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
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.zidOnboard]);
