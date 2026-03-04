import { useState, useEffect, useCallback } from 'react';
import { 
  FileText, 
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  X,
  Sparkles,
  Pencil,
  MapPin,
  Phone,
  Globe,
  Clock,
  Info
} from 'lucide-react';
import { Button, Toggle } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';
import { pagesApi, api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { captureError } from '@/lib/sentryHelpers';
import { toast } from 'sonner';
import type { Page } from '@jawab24/shared';

import { useSwipe } from '@/hooks/useSwipe';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useLandscape } from '@/hooks/useLandscape';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

// Type for the translation function
type TFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;

interface OnboardingWizardProps {
  onComplete: () => void;
  onSkip: () => void;
}

// Step 1: Welcome
function WelcomeStep({ 
  isLandscape, 
  t 
}: { 
  isLandscape: boolean; 
  t: TFunction;
}) {
  return (
    <div className={`text-center ${isLandscape ? 'flex items-center gap-6' : ''}`}>
      <div className={isLandscape ? 'flex-shrink-0' : 'mb-6'}>
        <div className={`${isLandscape ? 'w-20 h-20' : 'w-32 h-32'} mx-auto bg-gradient-to-br from-brand-400 to-accent-500 rounded-3xl flex items-center justify-center shadow-2xl shadow-brand-500/30`}>
          <Sparkles className={`${isLandscape ? 'w-10 h-10' : 'w-16 h-16'} text-white`} />
        </div>
      </div>
      <div className={isLandscape ? 'flex-1 text-start' : ''}>
        <h2 className={`font-bold text-foreground ${isLandscape ? 'text-xl mb-2' : 'text-2xl mb-4'}`}>
          {t('onboarding.welcomeTitle')}
        </h2>
        <p className={`text-muted-foreground leading-relaxed ${isLandscape ? 'text-sm' : 'text-lg'}`}>
          {t('onboarding.welcomeDesc')}
        </p>
      </div>
    </div>
  );
}

// Step 2: Pick Page
function PickPageStep({
  pages,
  loading,
  fetchError,
  onRetry,
  onToggle,
  isLandscape,
  t,
  pageLimit
}: {
  pages: Page[];
  loading: boolean;
  fetchError: boolean;
  onRetry: () => void;
  onToggle: (pageId: string, enabled: boolean) => void;
  isLandscape: boolean;
  t: TFunction;
  pageLimit: number | null;
}) {
  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-surface-500">{t('common.loading')}</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="text-center py-8">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
          <X className="w-6 h-6 text-red-500" />
        </div>
        <p className="text-surface-600 font-medium">{t('onboarding.fetchError' as TranslationKey)}</p>
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-xl text-sm font-medium hover:bg-brand-600 transition-colors"
        >
          {t('errors.tryAgain' as TranslationKey)}
        </button>
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div className="text-center py-8">
        <FileText className="w-12 h-12 text-surface-300 mx-auto mb-4" />
        <p className="text-surface-600 font-medium">{t('pages.noPages')}</p>
        <p className="text-surface-400 text-sm mt-2">{t('onboarding.noPagesHelp' as TranslationKey)}</p>
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-xl text-sm font-medium hover:bg-brand-600 transition-colors"
        >
          {t('onboarding.refreshPages' as TranslationKey)}
        </button>
      </div>
    );
  }

  return (
    <div className={isLandscape ? 'flex gap-6' : ''}>
      <div className={isLandscape ? 'flex-shrink-0 flex items-start' : 'text-center mb-6'}>
        <div className={`${isLandscape ? 'w-16 h-16' : 'w-20 h-20 mx-auto'} icon-bg-blue rounded-2xl flex items-center justify-center`}>
          <FileText className={`${isLandscape ? 'w-8 h-8' : 'w-10 h-10'}`} />
        </div>
      </div>
      <div className={`flex-1 ${isLandscape ? 'text-start' : 'text-center'}`}>
        <h2 className={`font-bold text-foreground ${isLandscape ? 'text-lg mb-1' : 'text-xl mb-2'}`}>
          {t('onboarding.pickPageTitle')}
        </h2>
        <p className={`text-surface-500 ${isLandscape ? 'text-sm mb-3' : 'mb-6'}`}>
          {t('onboarding.pickPageDesc')}
          {pageLimit !== null && (
            <span className="block text-xs text-surface-400 mt-1">
              {t('onboarding.pageLimitInfo' as TranslationKey, { limit: pageLimit })}
            </span>
          )}
        </p>
        
        <div className={`space-y-3 ${isLandscape ? 'max-h-[30vh] overflow-y-auto' : 'max-h-[40vh] overflow-y-auto'}`}>
          {pages.map((page) => (
            <div
              key={page.id}
              className={`flex items-center justify-between gap-4 p-4 rounded-2xl border-2 transition-all ${
                page.autoReplyEnabled 
                  ? 'border-brand-500 bg-brand-50/50'
                  : 'border-theme-border bg-card'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  page.autoReplyEnabled ? 'bg-brand-500 text-white' : 'bg-surface-100 text-surface-400'
                }`}>
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0 text-start">
                  <p className="font-semibold text-foreground truncate" title={page.name}>{page.name}</p>
                  <p className="text-xs text-surface-400">
                    {page.autoReplyEnabled ? t('onboarding.autoReplyOn') : t('onboarding.autoReplyOff')}
                  </p>
                </div>
              </div>
              <Toggle
                enabled={page.autoReplyEnabled ?? false}
                onChange={(enabled) => onToggle(page.id, enabled)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Step 3: Review Business Info
function ReviewInfoStep({
  selectedPage,
  knowledgeBase,
  onKnowledgeBaseChange,
  isEditing,
  onEditToggle,
  isLandscape,
  t,
}: {
  selectedPage: Page | null;
  knowledgeBase: string;
  onKnowledgeBaseChange: (value: string) => void;
  isEditing: boolean;
  onEditToggle: () => void;
  isLandscape: boolean;
  t: TFunction;
}) {
  if (!selectedPage) {
    return (
      <div className="text-center py-8">
        <Info className="w-12 h-12 text-surface-300 mx-auto mb-4" />
        <p className="text-surface-600">{t('onboarding.noPageSelected')}</p>
      </div>
    );
  }

  // Parse knowledge base to show structured fields
  const lines = knowledgeBase.split('\n').filter(l => l.trim());
  const hasAddress = lines.some(l => l.includes('العنوان') || l.includes('Address'));
  const hasPhone = lines.some(l => l.includes('الهاتف') || l.includes('Phone'));
  const hasWebsite = lines.some(l => l.includes('الموقع') || l.includes('website'));
  const hasHours = lines.some(l => l.includes('ساعات') || l.includes('hours'));

  return (
    <div className={isLandscape ? 'flex gap-6' : ''}>
      <div className={isLandscape ? 'flex-shrink-0 flex items-start' : 'text-center mb-4'}>
        <div className={`${isLandscape ? 'w-16 h-16' : 'w-20 h-20 mx-auto'} bg-emerald-100 rounded-2xl flex items-center justify-center`}>
          <CheckCircle2 className={`${isLandscape ? 'w-8 h-8' : 'w-10 h-10'} text-emerald-600`} />
        </div>
      </div>
      <div className={`flex-1 ${isLandscape ? 'text-start' : 'text-center'}`}>
        <h2 className={`font-bold text-foreground ${isLandscape ? 'text-lg mb-1' : 'text-xl mb-2'}`}>
          {t('onboarding.reviewInfoTitle')}
        </h2>
        <p className={`text-surface-500 ${isLandscape ? 'text-sm mb-3' : 'text-sm mb-4'}`}>
          {t('onboarding.reviewInfoDesc')}
        </p>

        {/* Completion summary */}
        {selectedPage?.autoReplyEnabled && (
          <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl mb-3 text-start">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-emerald-800 truncate">{selectedPage.name}</p>
              <p className="text-xs text-emerald-600">{t('onboarding.readySummary' as TranslationKey)}</p>
            </div>
          </div>
        )}

        {isEditing ? (
          <div className="text-start">
            <textarea
              value={knowledgeBase}
              onChange={(e) => onKnowledgeBaseChange(e.target.value)}
              className={`w-full p-4 border-2 border-theme-border rounded-2xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none text-foreground ${
                isLandscape ? 'h-[20vh]' : 'h-[30vh]'
              }`}
              placeholder={t('pages.writeBusinessInfo')}
              aria-label={t('pages.writeBusinessInfo')}
              dir="auto"
              autoFocus
            />
            <div className="flex justify-end mt-2">
              <Button size="sm" onClick={onEditToggle}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        ) : (
          <div 
            className="text-start bg-surface-50 rounded-2xl p-4 border border-theme-border"
            dir="auto"
          >
            {knowledgeBase ? (
              <div className="space-y-3">
                {/* Show indicators for what info is present */}
                <div className="flex flex-wrap gap-2 mb-3">
                  {hasAddress && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium">
                      <MapPin className="w-3 h-3" /> {t('onboarding.hasAddress')}
                    </span>
                  )}
                  {hasPhone && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 status-info rounded-lg text-xs font-medium">
                      <Phone className="w-3 h-3" /> {t('onboarding.hasPhone')}
                    </span>
                  )}
                  {hasWebsite && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 status-violet rounded-lg text-xs font-medium">
                      <Globe className="w-3 h-3" /> {t('onboarding.hasWebsite')}
                    </span>
                  )}
                  {hasHours && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 status-warning rounded-lg text-xs font-medium">
                      <Clock className="w-3 h-3" /> {t('onboarding.hasHours')}
                    </span>
                  )}
                </div>
                <p className="text-surface-600 text-sm whitespace-pre-wrap line-clamp-4">
                  {knowledgeBase}
                </p>
                <p className="text-xs text-surface-400 mt-2">
                  {t('onboarding.fromFacebook')}
                </p>
              </div>
            ) : (
              <p className="text-surface-400 text-sm italic">
                {t('onboarding.noBusinessInfo')}
              </p>
            )}
            <button
              onClick={onEditToggle}
              className="mt-3 inline-flex items-center gap-2 text-brand-600 hover:text-brand-700 text-sm font-medium"
            >
              <Pencil className="w-4 h-4" />
              {knowledgeBase ? t('onboarding.editInfo') : t('onboarding.addInfo')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function OnboardingWizard({ onComplete, onSkip }: OnboardingWizardProps) {
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';
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

  // Reusable hooks
  const isLandscape = useLandscape();
  useBodyScrollLock(true);
  useEscapeKey(onSkip);

  // Fetch pages — if empty and we have a FB token, trigger a sync first (defense-in-depth
  // against the race condition where the login-time auto-sync hasn't completed yet)
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
          await api.post('/pages/sync', { accessToken: fbToken });
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
        // Use existing knowledgeBase, or fall back to suggestedKnowledgeBase from Facebook
        setKnowledgeBase(selected.knowledgeBase || selected.suggestedKnowledgeBase || '');
      }
    } catch (error) {
      captureError(error, 'Onboarding: failed to fetch pages', { tags: { component: 'onboarding' } });
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [fbToken]);

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
        toast.error(t('onboarding.pageLimitReached' as TranslationKey, { limit: pageLimit }));
        return;
      }
    }

    // Optimistic update
    setPages(prev => prev.map(p =>
      p.id === pageId ? { ...p, autoReplyEnabled: enabled } : p
    ));

    // If enabling, select this page for info review
    if (enabled) {
      const page = pages.find(p => p.id === pageId);
      setSelectedPageId(pageId);
      // Use existing knowledgeBase, or fall back to suggestedKnowledgeBase from Facebook
      setKnowledgeBase(page?.knowledgeBase || page?.suggestedKnowledgeBase || '');
    }

    try {
      await pagesApi.toggle(pageId, enabled);
    } catch (error: unknown) {
      captureError(error, 'Onboarding: failed to toggle page', { tags: { component: 'onboarding' } });
      const axiosErr = error as { response?: { status?: number; data?: { code?: string } } };
      if (axiosErr.response?.status === 403 && axiosErr.response?.data?.code === 'PAGE_LIMIT_REACHED') {
        toast.error(t('onboarding.pageLimitReached' as TranslationKey, { limit: pageLimit ?? 1 }));
      } else {
        toast.error(t('errors.somethingWentWrong' as TranslationKey));
      }
      // Revert optimistic update
      setPages(prev => prev.map(p =>
        p.id === pageId ? { ...p, autoReplyEnabled: !enabled } : p
      ));
    }
  }, [pages, pageLimit, t]);

  const handleComplete = async () => {
    // Save knowledge base if changed
    if (selectedPageId && knowledgeBase) {
      setSaving(true);
      try {
        await api.put(`/pages/${selectedPageId}`, { knowledgeBase });
      } catch (error) {
        captureError(error, 'Onboarding: failed to save knowledge base', { tags: { component: 'onboarding' } });
      } finally {
        setSaving(false);
      }
    }
    onComplete();
  };

  const selectedPage = pages.find(p => p.id === selectedPageId) || null;
  const hasEnabledPage = pages.some(p => p.autoReplyEnabled);

  const totalSteps = 3;
  const isLastStep = currentStep === totalSteps - 1;
  const isFirstStep = currentStep === 0;

  const canProceed = () => {
    if (currentStep === 0) return true; // Welcome - always can proceed
    if (currentStep === 1) return hasEnabledPage; // Must enable at least one page
    return true; // Review step - always can proceed
  };

  const handleNext = () => {
    if (isLastStep) {
      handleComplete();
    } else {
      setCurrentStep(currentStep + 1);
    }
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

  return (
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
            className="text-surface-400 hover:text-surface-600 text-sm flex items-center gap-1 min-h-[44px] min-w-[44px] justify-center"
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
            <WelcomeStep isLandscape={isLandscape} t={t} />
          )}
          {currentStep === 1 && (
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
          {currentStep === 2 && (
            <ReviewInfoStep
              selectedPage={selectedPage}
              knowledgeBase={knowledgeBase}
              onKnowledgeBaseChange={setKnowledgeBase}
              isEditing={isEditingInfo}
              onEditToggle={() => setIsEditingInfo(!isEditingInfo)}
              isLandscape={isLandscape}
              t={t}
            />
          )}
        </div>

        {/* Footer with progress and buttons */}
        <div className={`flex-shrink-0 border-t border-theme-border ${isLandscape ? 'px-6 py-3' : 'px-6 py-4'}`}>
          {/* Step label */}
          <p className="text-center text-xs text-surface-400 mb-2">
            {t('onboarding.stepOf' as TranslationKey, { step: currentStep + 1, total: totalSteps })}
          </p>

          {/* Progress dots */}
          <div className={`flex gap-2 justify-center mb-4`}>
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className={`h-2 rounded-full transition-all ${
                  isLandscape ? 'w-2' : 'w-2.5 h-2.5'
                } ${
                  index === currentStep 
                    ? `bg-brand-500 ${isLandscape ? 'w-6' : 'w-8'}` 
                    : index < currentStep 
                    ? 'bg-brand-300' 
                    : 'bg-surface-200'
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
                <span className="rtl:block ltr:hidden"><ArrowRight className={isLandscape ? 'w-4 h-4' : 'w-5 h-5'} /></span>
                <span className="ltr:block rtl:hidden"><ArrowLeft className={isLandscape ? 'w-4 h-4' : 'w-5 h-5'} /></span>
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
              {isLastStep ? t('onboarding.letsGo') : t('onboarding.next')}
              {!isLastStep && (
                <>
                  <span className="rtl:block ltr:hidden"><ArrowLeft className={isLandscape ? 'w-4 h-4' : 'w-5 h-5'} /></span>
                  <span className="ltr:block rtl:hidden"><ArrowRight className={isLandscape ? 'w-4 h-4' : 'w-5 h-5'} /></span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
