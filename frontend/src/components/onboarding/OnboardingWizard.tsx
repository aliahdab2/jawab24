import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ArrowLeft, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { useTranslations, useLocale } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { pagesApi, api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { iosOr } from '@/lib/iosCopy';
import { captureError } from '@/lib/sentryHelpers';
import { isRTLLocale } from '@/utils/locale';
import { toast } from 'sonner';
import type { Page } from '@jawab24/shared';

import { useSwipe } from '@/hooks/useSwipe';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useLandscape } from '@/hooks/useLandscape';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { PickPageStep } from './PickPageStep';
import { ReviewInfoStep } from './ReviewInfoStep';
import { TryReplyStep } from './TryReplyStep';
import { SUGGESTION_CHIPS, type ChipId, type TFunction } from './onboardingTypes';

interface OnboardingWizardProps {
  onComplete: () => void;
  onSkip: () => void;
}

export function OnboardingWizard({ onComplete, onSkip }: OnboardingWizardProps) {
  const queryClient = useQueryClient();
  const tOnboarding = useTranslations('onboarding');
  const tc = useTranslations('common');
  const tPages = useTranslations('pages');
  const tErrors = useTranslations('errors');
  const tPricing = useTranslations('pricing');
  const locale = useLocale();
  const isRTL = isRTLLocale(locale);

  // Legacy wrapper: sub-components still expect a single t(fullKey) function.
  // TODO: refactor PickPageStep/ReviewInfoStep to accept namespace translators directly.
  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    const [ns, ...rest] = key.split('.');
    const subKey = rest.join('.');
    if (ns === 'onboarding') return tOnboarding(subKey as Parameters<typeof tOnboarding>[0], params);
    if (ns === 'common') return tc(subKey as Parameters<typeof tc>[0], params);
    if (ns === 'pages') return tPages(subKey as Parameters<typeof tPages>[0], params);
    if (ns === 'errors') return tErrors(subKey as Parameters<typeof tErrors>[0], params);
    if (ns === 'pricing') return tPricing(subKey as Parameters<typeof tPricing>[0], params);
    return key;
  }, [tOnboarding, tc, tPages, tErrors, tPricing]) as TFunction;
  const { fbToken } = useAuthStore();
  const [currentStep, setCurrentStep] = useState(0);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [pageLimit, setPageLimit] = useState<number | null>(null);
  const [chipData, setChipData] = useState<Record<ChipId, string>>({
    prices: '', hours: '', location: '', services: '', delivery: '', other: '',
  });
  const [activeChip, setActiveChip] = useState<ChipId | null>(null);
  const [hasTriedReply, setHasTriedReply] = useState(false);

  // Reusable hooks
  const isLandscape = useLandscape();
  useBodyScrollLock(true);
  useEscapeKey(onSkip);

  // Fetch pages — if empty and we have a FB token, trigger a sync first (defense-in-depth
  // against the race condition where the login-time auto-sync hasn't completed yet)
  /**
   * Prefill the info editor with a page's business-info text.
   *
   * The LIST endpoint (`pagesApi.getAll`) no longer ships `knowledgeBase` /
   * `suggestedKnowledgeBase` — they were 48% of that response's bytes and no list
   * screen reads them (see `serializeListPage`, backend controllers/pages.ts). So
   * the text has to come from the single-page read.
   *
   * Falls back to an empty editor on failure: a merchant can type into an empty
   * box, but a thrown wizard blocks onboarding entirely.
   */
  const prefillKnowledgeBase = useCallback(async (pageId: string) => {
    try {
      const { data } = await pagesApi.getById(pageId);
      const page = (data?.data ?? data) as Page | undefined;
      setKnowledgeBase(page?.knowledgeBase || page?.suggestedKnowledgeBase || '');
    } catch (error) {
      captureError(error, 'Onboarding: failed to load business info text', { tags: { component: 'onboarding' } });
      setKnowledgeBase('');
    }
  }, []);

  const fetchPages = useCallback(async () => {
    try {
      setLoading(true);
      setFetchError(false);
      let response = await pagesApi.getAll();
      let data: Page[] = Array.isArray(response.data)
        ? response.data
        : (Array.isArray(response.data?.data) ? response.data.data : []);

      // If no pages found and we have a token, trigger a sync then re-read
      if (data.length === 0 && fbToken) {
        try {
          await pagesApi.sync(fbToken);
          response = await pagesApi.getAll();
          data = Array.isArray(response.data)
            ? response.data
            : (Array.isArray(response.data?.data) ? response.data.data : []);
        } catch {
          // Sync failed — show empty state with retry button
        }
      }

      setPages(data);

      // Auto-select first enabled page, or first page
      const enabledPage = data.find((p: Page) => p.autoReplyEnabled);
      const firstPage = data[0];
      const selected = enabledPage || firstPage;
      if (selected) {
        setSelectedPageId(selected.id);
        // Existing text, else the Facebook auto-sync suggestion — both live on the
        // single-page read now, not the list row.
        await prefillKnowledgeBase(selected.id);
      }
    } catch (error) {
      captureError(error, 'Onboarding: failed to fetch pages', { tags: { component: 'onboarding' } });
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [fbToken, prefillKnowledgeBase]);

  // Fetch pages and page limit on mount
  useEffect(() => {
    fetchPages();
    api.get('/subscriptions/usage').then((res) => {
      const limit = res.data?.pages?.limit;
      if (typeof limit === 'number') setPageLimit(limit);
    }).catch(() => { /* fail open — backend toggle will still enforce */ });
  }, [fetchPages]);

  const handleToggle = useCallback(async (pageId: string, enabled: boolean) => {
    // Check plan limit before enabling (1 physical page = 1 slot, FB + IG share the slot)
    if (enabled && pageLimit !== null) {
      const enabledPages = pages.filter(p => p.autoReplyEnabled || p.instagramAutoReplyEnabled).length;
      // Only block if the page being toggled doesn't already have any auto-reply enabled
      const targetPage = pages.find(p => p.id === pageId);
      const targetAlreadyEnabled = targetPage?.autoReplyEnabled || targetPage?.instagramAutoReplyEnabled;
      if (!targetAlreadyEnabled && enabledPages >= pageLimit) {
        toast.error(t(iosOr('onboarding.pageLimitReachedIOS', 'onboarding.pageLimitReached'), { limit: pageLimit }));
        return;
      }
    }

    // Optimistic update
    setPages(prev => prev.map(p =>
      p.id === pageId ? { ...p, autoReplyEnabled: enabled } : p
    ));

    // If enabling, select this page for info review
    if (enabled) {
      setSelectedPageId(pageId);
      // Existing text, else the Facebook auto-sync suggestion — both live on the
      // single-page read now, not the list row.
      void prefillKnowledgeBase(pageId);
    }

    try {
      await pagesApi.toggle(pageId, enabled);
      queryClient.invalidateQueries({ queryKey: ['pages'] });
    } catch (error: unknown) {
      captureError(error, 'Onboarding: failed to toggle page', { tags: { component: 'onboarding' } });
      const axiosErr = error as { response?: { status?: number; data?: { code?: string } } };
      if (axiosErr.response?.status === 402 && axiosErr.response?.data?.code === 'SUBSCRIPTION_INACTIVE') {
        toast.error(t('pages.subscriptionInactive'));
      } else if (axiosErr.response?.status === 403 && axiosErr.response?.data?.code === 'PAGE_LIMIT_REACHED') {
        toast.error(t(iosOr('onboarding.pageLimitReachedIOS', 'onboarding.pageLimitReached'), { limit: pageLimit ?? 1 }));
      } else if (axiosErr.response?.status === 402 && axiosErr.response?.data?.code === 'TRIAL_ALREADY_USED') {
        toast.error(t('pages.pageTrialUsedBlocked'));
      } else if (axiosErr.response?.status === 409 && axiosErr.response?.data?.code === 'BUSINESS_INFO_REQUIRED') {
        // Reachable when the Facebook page carried nothing to seed from (no
        // about/phone/hours/category), so the card was created with a null
        // knowledge base. Not a dead end: the optimistic `setSelectedPageId`
        // above is deliberately NOT reverted, so this page's info editor is
        // already open below — the merchant types their info and toggles again.
        toast.error(t('pages.businessInfoRequiredToEnable'));
      } else {
        toast.error(t('errors.somethingWentWrong'));
      }
      // Revert optimistic update
      setPages(prev => prev.map(p =>
        p.id === pageId ? { ...p, autoReplyEnabled: !enabled } : p
      ));
    }
  }, [pages, pageLimit, queryClient, t, prefillKnowledgeBase]);

  const handleChipToggle = useCallback((chipId: ChipId) => {
    setActiveChip(prev => prev === chipId ? null : chipId);
  }, []);

  const handleChipContentChange = useCallback((chipId: ChipId, content: string) => {
    setChipData(prev => ({ ...prev, [chipId]: content }));
  }, []);

  // Persist the page's Business Info (existing KB + chip additions). Called both
  // when entering the "Try a reply" step (test-reply reads the STORED KB) and on
  // finish. The PUT is idempotent, so running it on both transitions is safe.
  const persistKnowledgeBase = useCallback(async () => {
    // Build final KB: existing content + chip additions
    let finalKb = knowledgeBase.trim();

    // Append chip content using emoji markers (compatible with knowledgeBaseParser)
    for (const chip of SUGGESTION_CHIPS) {
      const content = chipData[chip.id]?.trim();
      if (!content) continue;

      const label = t(chip.labelKey);
      const section = `${chip.emoji} ${label}:\n${content}`;
      finalKb = finalKb ? `${finalKb}\n\n${section}` : section;
    }

    if (selectedPageId && finalKb) {
      setSaving(true);
      try {
        await api.put(`/pages/${selectedPageId}`, { knowledgeBase: finalKb });
      } catch (error) {
        captureError(error, 'Onboarding: failed to save knowledge base', { tags: { component: 'onboarding' } });
      } finally {
        setSaving(false);
      }
    }
  }, [knowledgeBase, chipData, selectedPageId, t]);

  const handleComplete = async () => {
    await persistKnowledgeBase();
    onComplete();
  };

  const selectedPage = pages.find(p => p.id === selectedPageId) || null;
  const hasEnabledPage = pages.some(p => p.autoReplyEnabled);

  // Step indices: 0 = pick page, 1 = review info, 2 = try a reply
  const REVIEW_STEP = 1;
  const TRY_STEP = 2;
  const totalSteps = 3;
  const isLastStep = currentStep === totalSteps - 1;
  const isFirstStep = currentStep === 0;

  const canProceed = () => {
    if (currentStep === 0) return hasEnabledPage; // Must enable at least one page
    return true; // Review + Try steps — always can proceed (trying is optional)
  };

  const handleNext = async () => {
    if (isLastStep) {
      handleComplete();
      return;
    }
    // Entering the Try step: persist Business Info first so test-reply reads the
    // latest stored KB (the test-reply request body carries no KB field).
    if (currentStep === REVIEW_STEP) {
      await persistKnowledgeBase();
    }
    setCurrentStep(currentStep + 1);
  };

  const handlePrev = () => {
    if (!isFirstStep) {
      setCurrentStep(currentStep - 1);
    }
  };

  // Implement swipe using reusable hook
  const swipeHandlers = useSwipe({
    onSwipeLeft: isRTL ? handlePrev : (canProceed() ? handleNext : undefined),
    onSwipeRight: isRTL ? (canProceed() ? handleNext : undefined) : handlePrev,
    minSwipeDistance: 50
  });

  const content = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div 
        className={`bg-card rounded-3xl shadow-2xl overflow-hidden animate-slide-up ${
          isLandscape ? 'max-w-2xl w-full max-h-[90vh]' : 'max-w-md w-full max-h-[85vh]'
        } flex flex-col`}
        {...swipeHandlers}
      >
        {/* Skip button */}
        <div className={`flex justify-end flex-shrink-0 ${isLandscape ? 'p-3 pb-0' : 'p-4 pb-0'}`}>
          <button 
            onClick={onSkip}
            className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1 min-h-[44px] min-w-[44px] justify-center"
          >
            {t('onboarding.skip')}
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div 
          key={currentStep}
          className={`animate-fade-in flex-1 overflow-y-auto ${
            isLandscape ? 'px-6 pb-4 pt-2' : 'px-6 pb-6 pt-2'
          }`}
        >
          {currentStep === 0 && (
            <PickPageStep
              pages={pages}
              loading={loading}
              fetchError={fetchError}
              onRetry={fetchPages}
              onToggle={handleToggle}
              isLandscape={isLandscape}
              t={t}
              pageLimit={pageLimit}
            />
          )}
          {currentStep === REVIEW_STEP && (
            <ReviewInfoStep
              selectedPage={selectedPage}
              knowledgeBase={knowledgeBase}
              onKnowledgeBaseChange={setKnowledgeBase}
              isEditing={isEditingInfo}
              onEditToggle={() => setIsEditingInfo(!isEditingInfo)}
              chipData={chipData}
              activeChip={activeChip}
              onChipToggle={handleChipToggle}
              onChipContentChange={handleChipContentChange}
              isLandscape={isLandscape}
              t={t}
            />
          )}
          {currentStep === TRY_STEP && (
            <TryReplyStep
              pageId={selectedPageId}
              hasKnowledgeBase={Boolean(knowledgeBase.trim())}
              isLandscape={isLandscape}
              t={t}
              onReplyShown={() => setHasTriedReply(true)}
            />
          )}
        </div>

        {/* Footer with progress and buttons */}
        <div className={`flex-shrink-0 border-t border-theme-border ${isLandscape ? 'px-6 py-3' : 'px-6 py-4'}`}>
          {/* Step label */}
          <p className="text-center text-xs text-muted-foreground mb-2">
            {t('onboarding.stepOf', { step: currentStep + 1, total: totalSteps })}
          </p>

          {/* Progress dots */}
          <div className="flex gap-2 justify-center mb-3">
            {Array.from({ length: totalSteps }, (_, i) => i).map((index) => (
              <div
                key={index}
                className={`h-2 rounded-full transition-all ${
                  isLandscape ? 'w-2' : 'w-2.5 h-2.5'
                } ${
                  index === currentStep 
                    ? `bg-brand-500 ${isLandscape ? 'w-6' : 'w-8'}` 
                    : index < currentStep 
                    ? 'bg-brand-300'
                    : 'bg-muted'
                }`}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            {!isFirstStep && (
              <Button
                variant="secondary"
                size={isLandscape ? 'md' : 'lg'}
                onClick={handlePrev}
                className="flex-1"
              >
                <span className="rtl:inline ltr:hidden"><ArrowRight className={isLandscape ? 'w-4 h-4' : 'w-5 h-5'} /></span>
                <span className="ltr:inline rtl:hidden"><ArrowLeft className={isLandscape ? 'w-4 h-4' : 'w-5 h-5'} /></span>
                {t('onboarding.previous')}
              </Button>
            )}
            <Button
              size={isLandscape ? 'md' : 'lg'}
              onClick={handleNext}
              disabled={!canProceed() || saving}
              loading={saving}
              className={`flex-1 ${isFirstStep ? 'w-full' : ''}`}
            >
              {isLastStep
                ? (hasTriedReply ? t('onboarding.tryEnableOnPage') : t('onboarding.letsGo'))
                : t('onboarding.next')}
              {!isLastStep && (
                <>
                  <span className="rtl:inline ltr:hidden"><ArrowLeft className={isLandscape ? 'w-4 h-4' : 'w-5 h-5'} /></span>
                  <span className="ltr:inline rtl:hidden"><ArrowRight className={isLandscape ? 'w-4 h-4' : 'w-5 h-5'} /></span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  // Portal to document.body to escape <main>'s stacking context (z-[1])
  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
}
