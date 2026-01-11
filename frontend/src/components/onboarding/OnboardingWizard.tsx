import { useState, useEffect } from 'react';
import { 
  FileText, 
  Zap, 
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  X,
  Sparkles
} from 'lucide-react';
import { Button, FacebookIcon } from '@/components/ui';
import { useTranslation } from '@/i18n';

import { useSwipe } from '@/hooks/useSwipe';

interface OnboardingWizardProps {
  onComplete: () => void;
  onSkip: () => void;
}

// Visual component that adapts to landscape
function StepVisual({ 
  icon: Icon, 
  color, 
  isLandscape,
  isLastStep 
}: { 
  icon: React.ElementType; 
  color: string; 
  isLandscape: boolean;
  isLastStep: boolean;
}) {
  const colorClasses: Record<string, string> = {
    brand: 'bg-gradient-to-br from-brand-400 to-accent-500 shadow-2xl shadow-brand-500/30',
    blue: 'bg-blue-100',
    emerald: 'bg-emerald-100',
    amber: 'bg-amber-100',
  };

  const iconColorClasses: Record<string, string> = {
    brand: 'text-white',
    blue: 'text-blue-600',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
  };

  const size = isLandscape ? 'w-20 h-20' : 'w-32 h-32';
  const iconSize = isLandscape ? 'w-10 h-10' : 'w-16 h-16';

  return (
    <div className={`${size} mx-auto ${colorClasses[color]} rounded-3xl flex items-center justify-center ${isLastStep ? 'animate-bounce' : ''}`}>
      <Icon className={`${iconSize} ${iconColorClasses[color]}`} />
    </div>
  );
}

export function OnboardingWizard({ onComplete, onSkip }: OnboardingWizardProps) {
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';
  const [currentStep, setCurrentStep] = useState(0);
  const [isLandscape, setIsLandscape] = useState(false);

  // Detect orientation using matchMedia (industry standard)
  useEffect(() => {
    const mediaQuery = window.matchMedia('(orientation: landscape)');
    setIsLandscape(mediaQuery.matches);
    
    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Prevent body scroll when wizard is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const steps = [
    {
      icon: Sparkles,
      color: 'brand',
      title: t('onboarding.welcomeTitle'),
      description: t('onboarding.welcomeDesc'),
    },
    {
      icon: FacebookIcon,
      color: 'blue',
      title: t('onboarding.step1Title'),
      description: t('onboarding.step1Desc'),
    },
    {
      icon: FileText,
      color: 'emerald',
      title: t('onboarding.step2Title'),
      description: t('onboarding.step2Desc'),
    },
    {
      icon: Zap,
      color: 'amber',
      title: t('onboarding.step3Title'),
      description: t('onboarding.step3Desc'),
    },
    {
      icon: CheckCircle2,
      color: 'emerald',
      title: t('onboarding.completeTitle'),
      description: t('onboarding.completeDesc'),
    },
  ];

  const currentStepData = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;
  const isFirstStep = currentStep === 0;

  const handleNext = () => {
    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirstStep) {
      setCurrentStep(currentStep - 1);
    }
  };

  // Implement swipe using reusable hook (Best Practice)
  const swipeHandlers = useSwipe({
    onSwipeLeft: isRTL ? handlePrev : handleNext,
    onSwipeRight: isRTL ? handleNext : handlePrev,
    minSwipeDistance: 50
  });

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" 
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div 
        className={`bg-white rounded-3xl shadow-2xl overflow-hidden animate-In slide-in-from-bottom-4 duration-300 ${
          isLandscape ? 'max-w-2xl w-full max-h-[90vh]' : 'max-w-md w-full'
        }`}
        {...swipeHandlers}
      >
        {/* Skip button */}
        <div className={`flex justify-end ${isLandscape ? 'p-3 pb-0' : 'p-4 pb-0'}`}>
          <button 
            onClick={onSkip}
            className="text-surface-400 hover:text-surface-600 text-sm flex items-center gap-1 min-h-[44px] min-w-[44px] justify-center"
          >
            {t('onboarding.skip')}
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content - Horizontal in landscape, Vertical in portrait */}
        <div 
          key={currentStep}
          className={`animate-In fade-in duration-300 ${
            isLandscape 
              ? 'flex items-center gap-6 px-6 pb-4 pt-2' 
              : 'px-8 pb-8 pt-4 text-center'
          }`}
        >
          {/* Visual */}
          <div className={isLandscape ? 'flex-shrink-0' : 'mb-6'}>
            <StepVisual 
              icon={currentStepData.icon} 
              color={currentStepData.color} 
              isLandscape={isLandscape}
              isLastStep={isLastStep}
            />
          </div>

          {/* Text content */}
          <div className={isLandscape ? 'flex-1 min-w-0' : ''}>
            {/* Title */}
            <h2 className={`font-bold text-surface-900 ${
              isLandscape ? 'text-xl mb-1 text-start' : 'text-2xl mb-3'
            }`}>
              {currentStepData.title}
            </h2>

            {/* Description */}
            <p className={`text-surface-600 leading-relaxed ${
              isLandscape ? 'text-sm mb-3 text-start' : 'text-lg mb-8'
            }`}>
              {currentStepData.description}
            </p>

            {/* Progress dots */}
            <div className={`flex gap-2 ${isLandscape ? 'mb-3 justify-start' : 'mb-6 justify-center'}`}>
              {steps.map((_, index) => (
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
            <div className={`flex gap-3 ${isLandscape ? '' : ''}`}>
              {!isFirstStep && (
                <Button
                  variant="secondary"
                  size={isLandscape ? 'default' : 'lg'}
                  onClick={handlePrev}
                  className="flex-1"
                >
                  <span className="rtl:block ltr:hidden"><ArrowRight className={isLandscape ? 'w-4 h-4' : 'w-5 h-5'} /></span>
                  <span className="ltr:block rtl:hidden"><ArrowLeft className={isLandscape ? 'w-4 h-4' : 'w-5 h-5'} /></span>
                  {t('onboarding.previous')}
                </Button>
              )}
              <Button
                size={isLandscape ? 'default' : 'lg'}
                onClick={handleNext}
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
    </div>
  );
}

