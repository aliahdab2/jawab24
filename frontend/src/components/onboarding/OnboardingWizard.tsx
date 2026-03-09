import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
  Info,
  Check,
} from 'lucide-react';
import { Button, Toggle } from '@/components/ui';
import { useTranslations, useLocale } from 'next-intl';
import { pagesApi, api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { captureError } from '@/lib/sentryHelpers';
import { toast } from 'sonner';
import type { Page } from '@jawab24/shared';

import { useSwipe } from '@/hooks/useSwipe';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useLandscape } from '@/hooks/useLandscape';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

type TFunction = (key: string, params?: Record<string, string | number>) => string;

interface OnboardingWizardProps {
  onComplete: () => void;
  onSkip: () => void;
}

// Suggestion chip definitions — emojis match EMOJI_TO_SECTION in knowledgeBaseParser
const SUGGESTION_CHIPS = [
  { id: 'prices', emoji: '💰', labelKey: 'onboarding.chipPrices', placeholderKey: 'onboarding.chipPricesPlaceholder' },
  { id: 'hours', emoji: '🕐', labelKey: 'onboarding.chipHours', placeholderKey: 'onboarding.chipHoursPlaceholder' },
  { id: 'location', emoji: '📍', labelKey: 'onboarding.chipLocation', placeholderKey: 'onboarding.chipLocationPlaceholder' },
  { id: 'services', emoji: '📋', labelKey: 'onboarding.chipServices', placeholderKey: 'onboarding.chipServicesPlaceholder' },
  { id: 'delivery', emoji: '📦', labelKey: 'onboarding.chipDelivery', placeholderKey: 'onboarding.chipDeliveryPlaceholder' },
  { id: 'other', emoji: '✦', labelKey: 'onboarding.chipOther', placeholderKey: 'onboarding.chipOtherPlaceholder' },
] as const;

type ChipId = typeof SUGGESTION_CHIPS[number]['id'];

// Step 1: Pick Page (with welcome header merged in)
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
        <p className="text-muted-foreground">{t('common.loading')}</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="text-center py-8">
        <div className="w-12 h-12 rounded-full icon-bg-red flex items-center justify-center mx-auto mb-4">
          <X className="w-6 h-6" />
        </div>
        <p className="text-muted-foreground font-medium">{t('onboarding.fetchError')}</p>
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-xl text-sm font-medium hover:bg-brand-600 transition-colors"
        >
          {t('errors.tryAgain')}
        </button>
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div className="text-center py-8">
        <FileText className="w-12 h-12 text-icon-muted mx-auto mb-4" />
        <p className="text-muted-foreground font-medium">{t('pages.noPages')}</p>
        <p className="text-muted-foreground text-sm mt-2">{t('onboarding.noPagesHelp')}</p>
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-xl text-sm font-medium hover:bg-brand-600 transition-colors"
        >
          {t('onboarding.refreshPages')}
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Welcome header — merged from removed WelcomeStep */}
      <div className={`text-center ${isLandscape ? 'mb-3' : 'mb-4'}`}>
        <div className={`${isLandscape ? 'w-12 h-12' : 'w-16 h-16'} mx-auto bg-gradient-to-br from-brand-400 to-accent-500 rounded-2xl flex items-center justify-center shadow-lg shadow-brand-500/20 mb-2`}>
          <Sparkles className={`${isLandscape ? 'w-6 h-6' : 'w-8 h-8'} text-white`} />
        </div>
        <h2 className={`font-bold text-foreground ${isLandscape ? 'text-lg mb-1' : 'text-xl mb-1'}`}>
          {t('onboarding.welcomeTitle')}
        </h2>
        <p className={`text-muted-foreground ${isLandscape ? 'text-xs' : 'text-sm'}`}>
          {t('onboarding.welcomeDesc')}
        </p>
      </div>

      {/* Page picker */}
      <div>
        <h3 className={`font-semibold text-foreground ${isLandscape ? 'text-sm mb-2' : 'text-base mb-2'}`}>
          {t('onboarding.pickPageTitle')}
        </h3>
        <p className={`text-muted-foreground ${isLandscape ? 'text-xs mb-2' : 'text-sm mb-3'}`}>
          {t('onboarding.pickPageDesc')}
          {pageLimit !== null && (
            <span className="block text-xs text-muted-foreground mt-1">
              {t('onboarding.pageLimitInfo', { limit: pageLimit })}
            </span>
          )}
        </p>

        <div className={`space-y-3 ${isLandscape ? 'max-h-[25vh] overflow-y-auto' : 'max-h-[35vh] overflow-y-auto'}`}>
          {pages.map((page) => (
            <div
              key={page.id}
              className={`flex items-center justify-between gap-4 p-4 rounded-2xl border-2 transition-all ${
                page.autoReplyEnabled
                  ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/30'
                  : 'border-theme-border bg-card'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  page.autoReplyEnabled ? 'bg-brand-500 text-white' : 'bg-muted text-icon-muted'
                }`}>
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0 text-start">
                  <p className="font-semibold text-foreground truncate" title={page.name}>{page.name}</p>
                  <p className="text-xs text-muted-foreground">
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

// Step 2: Review Business Info + Suggestion Chips
function ReviewInfoStep({
  selectedPage,
  knowledgeBase,
  onKnowledgeBaseChange,
  isEditing,
  onEditToggle,
  chipData,
  activeChip,
  onChipToggle,
  onChipContentChange,
  isLandscape,
  t,
}: {
  selectedPage: Page | null;
  knowledgeBase: string;
  onKnowledgeBaseChange: (value: string) => void;
  isEditing: boolean;
  onEditToggle: () => void;
  chipData: Record<ChipId, string>;
  activeChip: ChipId | null;
  onChipToggle: (chipId: ChipId) => void;
  onChipContentChange: (chipId: ChipId, content: string) => void;
  isLandscape: boolean;
  t: TFunction;
}) {
  if (!selectedPage) {
    return (
      <div className="text-center py-8">
        <Info className="w-12 h-12 text-icon-muted mx-auto mb-4" />
        <p className="text-muted-foreground">{t('onboarding.noPageSelected')}</p>
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
    <div>
      <div className="text-center mb-3">
        <div className={`${isLandscape ? 'w-12 h-12' : 'w-14 h-14'} mx-auto icon-bg-emerald rounded-2xl flex items-center justify-center mb-2`}>
          <CheckCircle2 className={`${isLandscape ? 'w-6 h-6' : 'w-7 h-7'}`} />
        </div>
        <h2 className={`font-bold text-foreground ${isLandscape ? 'text-lg mb-1' : 'text-xl mb-1'}`}>
          {t('onboarding.reviewInfoTitle')}
        </h2>
        <p className={`text-muted-foreground ${isLandscape ? 'text-xs' : 'text-sm'}`}>
          {t('onboarding.reviewInfoDesc')}
        </p>
      </div>

      {/* Completion summary */}
      {selectedPage?.autoReplyEnabled && (
        <div className="flex items-center gap-2 p-3 alert-success border rounded-xl mb-3 text-start">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{selectedPage.name}</p>
            <p className="text-xs opacity-80">{t('onboarding.readySummary')}</p>
          </div>
        </div>
      )}

      {/* Imported info preview */}
      {isEditing ? (
        <div className="text-start mb-3">
          <textarea
            value={knowledgeBase}
            onChange={(e) => onKnowledgeBaseChange(e.target.value)}
            className={`w-full p-3 border-2 border-theme-border rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none text-foreground bg-background text-sm ${
              isLandscape ? 'h-[15vh]' : 'h-[20vh]'
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
          className="text-start bg-muted rounded-xl p-3 border border-theme-border mb-3"
          dir="auto"
        >
          {knowledgeBase ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {hasAddress && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 status-success border rounded-lg text-xs font-medium">
                    <MapPin className="w-3 h-3" /> {t('onboarding.hasAddress')}
                  </span>
                )}
                {hasPhone && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 status-info rounded-lg text-xs font-medium">
                    <Phone className="w-3 h-3" /> {t('onboarding.hasPhone')}
                  </span>
                )}
                {hasWebsite && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 status-violet rounded-lg text-xs font-medium">
                    <Globe className="w-3 h-3" /> {t('onboarding.hasWebsite')}
                  </span>
                )}
                {hasHours && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 status-warning rounded-lg text-xs font-medium">
                    <Clock className="w-3 h-3" /> {t('onboarding.hasHours')}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground text-xs whitespace-pre-wrap line-clamp-3">
                {knowledgeBase}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('onboarding.fromFacebook')}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm italic">
              {t('onboarding.noBusinessInfo')}
            </p>
          )}
          <button
            onClick={onEditToggle}
            className="mt-2 inline-flex items-center gap-2 text-brand-600 hover:text-brand-700 text-sm font-medium"
          >
            <Pencil className="w-3.5 h-3.5" />
            {knowledgeBase ? t('onboarding.editInfo') : t('onboarding.addInfo')}
          </button>
        </div>
      )}

      {/* Suggestion chips — "Add more details" */}
      <div className="text-start">
        <p className={`font-semibold text-foreground ${isLandscape ? 'text-xs mb-2' : 'text-sm mb-2'}`}>
          {t('onboarding.addMore')}
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          {SUGGESTION_CHIPS.map((chip) => {
            const hasContent = chipData[chip.id]?.trim();
            const isActive = activeChip === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => onChipToggle(chip.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all min-h-[44px] ${
                  isActive
                    ? 'bg-brand-500 text-white shadow-sm'
                    : hasContent
                    ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800'
                    : 'bg-muted text-foreground border border-theme-border hover:border-brand-300 hover:bg-brand-50/50 dark:hover:bg-brand-950/20'
                }`}
              >
                <span>{chip.emoji}</span>
                <span>{t(chip.labelKey)}</span>
                {hasContent && !isActive && <Check className="w-3.5 h-3.5 text-brand-500" />}
              </button>
            );
          })}
        </div>

        {/* Active chip textarea */}
        {activeChip && (
          <div className="animate-fade-in">
            <textarea
              value={chipData[activeChip] || ''}
              onChange={(e) => onChipContentChange(activeChip, e.target.value)}
              className={`w-full p-3 border-2 border-brand-200 dark:border-brand-800 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none text-foreground bg-background text-sm placeholder:text-muted-foreground ${
                isLandscape ? 'min-h-[60px]' : 'min-h-[80px]'
              }`}
              placeholder={t(SUGGESTION_CHIPS.find(c => c.id === activeChip)!.placeholderKey)}
              aria-label={t(SUGGESTION_CHIPS.find(c => c.id === activeChip)!.labelKey)}
              dir="auto"
              autoFocus
            />
            <div className="flex justify-end mt-1.5">
              <button
                type="button"
                onClick={() => onChipToggle(activeChip)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 hover:bg-brand-50 dark:hover:bg-brand-950/30 rounded-lg transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                {t('onboarding.addMoreDone')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function OnboardingWizard({ onComplete, onSkip }: OnboardingWizardProps) {
  const tOnboarding = useTranslations('onboarding');
  const tc = useTranslations('common');
  const tPages = useTranslations('pages');
  const tErrors = useTranslations('errors');
  const tPricing = useTranslations('pricing');
  const locale = useLocale();
  const isRTL = locale === 'ar';

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
        toast.error(t('onboarding.pageLimitReached', { limit: pageLimit }));
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
        toast.error(t('onboarding.pageLimitReached', { limit: pageLimit ?? 1 }));
      } else {
        toast.error(t('errors.somethingWentWrong'));
      }
      // Revert optimistic update
      setPages(prev => prev.map(p =>
        p.id === pageId ? { ...p, autoReplyEnabled: !enabled } : p
      ));
    }
  }, [pages, pageLimit, t]);

  const handleChipToggle = useCallback((chipId: ChipId) => {
    setActiveChip(prev => prev === chipId ? null : chipId);
  }, []);

  const handleChipContentChange = useCallback((chipId: ChipId, content: string) => {
    setChipData(prev => ({ ...prev, [chipId]: content }));
  }, []);

  const handleComplete = async () => {
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
    onComplete();
  };

  const selectedPage = pages.find(p => p.id === selectedPageId) || null;
  const hasEnabledPage = pages.some(p => p.autoReplyEnabled);

  const totalSteps = 2;
  const isLastStep = currentStep === totalSteps - 1;
  const isFirstStep = currentStep === 0;

  const canProceed = () => {
    if (currentStep === 0) return hasEnabledPage; // Must enable at least one page
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
          {currentStep === 1 && (
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
        </div>

        {/* Footer with progress and buttons */}
        <div className={`flex-shrink-0 border-t border-theme-border ${isLandscape ? 'px-6 py-3' : 'px-6 py-4'}`}>
          {/* Step label */}
          <p className="text-center text-xs text-muted-foreground mb-2">
            {t('onboarding.stepOf', { step: currentStep + 1, total: totalSteps })}
          </p>

          {/* Progress dots */}
          <div className="flex gap-2 justify-center mb-3">
            {[0, 1].map((index) => (
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
              {isLastStep ? t('onboarding.letsGo') : t('onboarding.next')}
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
