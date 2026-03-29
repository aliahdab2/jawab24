import { FileText, X, Sparkles } from 'lucide-react';
import { Toggle } from '@/components/ui';
import type { Page } from '@jawab24/shared';
import type { TFunction } from './onboardingTypes';

interface PickPageStepProps {
  pages: Page[];
  loading: boolean;
  fetchError: boolean;
  onRetry: () => void;
  onToggle: (pageId: string, enabled: boolean) => void;
  isLandscape: boolean;
  t: TFunction;
  pageLimit: number | null;
}

export function PickPageStep({
  pages,
  loading,
  fetchError,
  onRetry,
  onToggle,
  isLandscape,
  t,
  pageLimit,
}: PickPageStepProps) {
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
