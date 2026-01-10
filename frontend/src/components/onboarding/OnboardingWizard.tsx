import { useState } from 'react';
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

export function OnboardingWizard({ onComplete, onSkip }: OnboardingWizardProps) {
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    {
      icon: Sparkles,
      color: 'brand',
      title: t('onboarding.welcomeTitle'),
      description: t('onboarding.welcomeDesc'),
      visual: (
        <div className="w-32 h-32 mx-auto bg-gradient-to-br from-brand-400 to-accent-500 rounded-3xl flex items-center justify-center shadow-2xl shadow-brand-500/30">
          <Sparkles className="w-16 h-16 text-white" />
        </div>
      ),
    },
    {
      icon: FacebookIcon,
      color: 'blue',
      title: t('onboarding.step1Title'),
      description: t('onboarding.step1Desc'),
      visual: (
        <div className="w-32 h-32 mx-auto bg-blue-100 rounded-3xl flex items-center justify-center">
          <FacebookIcon className="w-16 h-16 text-blue-600" />
        </div>
      ),
    },
    {
      icon: FileText,
      color: 'emerald',
      title: t('onboarding.step2Title'),
      description: t('onboarding.step2Desc'),
      visual: (
        <div className="w-32 h-32 mx-auto bg-emerald-100 rounded-3xl flex items-center justify-center">
          <FileText className="w-16 h-16 text-emerald-600" />
        </div>
      ),
    },
    {
      icon: Zap,
      color: 'amber',
      title: t('onboarding.step3Title'),
      description: t('onboarding.step3Desc'),
      visual: (
        <div className="w-32 h-32 mx-auto bg-amber-100 rounded-3xl flex items-center justify-center">
          <Zap className="w-16 h-16 text-amber-600" />
        </div>
      ),
    },
    {
      icon: CheckCircle2,
      color: 'emerald',
      title: t('onboarding.completeTitle'),
      description: t('onboarding.completeDesc'),
      visual: (
        <div className="w-32 h-32 mx-auto bg-emerald-100 rounded-3xl flex items-center justify-center animate-bounce">
          <CheckCircle2 className="w-16 h-16 text-emerald-600" />
        </div>
      ),
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
        className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-In slide-in-from-bottom-4 duration-300"
        {...swipeHandlers}
      >
        {/* Skip button */}
        <div className="flex justify-end p-4 pb-0">
          <button 
            onClick={onSkip}
            className="text-surface-400 hover:text-surface-600 text-sm flex items-center gap-1"
          >
            {t('onboarding.skip')}
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content with transition based on currentStep */}
        <div 
          key={currentStep}
          className="px-8 pb-8 pt-4 text-center animate-In fade-in slide-in-from-right-4 duration-300 ltr:animate-In rtl:animate-In rtl:slide-in-from-left-4"
        >
          {/* Visual */}
          <div className="mb-6">
            {currentStepData.visual}
          </div>

          {/* Title */}
          <h2 className="text-2xl font-bold text-surface-900 mb-3">
            {currentStepData.title}
          </h2>

          {/* Description */}
          <p className="text-surface-600 text-lg mb-8 leading-relaxed">
            {currentStepData.description}
          </p>

          {/* Progress dots */}
          <div className="flex justify-center gap-2 mb-6">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`w-2.5 h-2.5 rounded-full transition-all ${
                  index === currentStep 
                    ? 'bg-brand-500 w-8' 
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
                size="lg"
                onClick={handlePrev}
                className="flex-1"
              >
                <span className="rtl:block ltr:hidden"><ArrowRight className="w-5 h-5" /></span>
                <span className="ltr:block rtl:hidden"><ArrowLeft className="w-5 h-5" /></span>
                {t('onboarding.previous')}
              </Button>
            )}
            <Button
              size="lg"
              onClick={handleNext}
              className={`flex-1 ${isFirstStep ? 'w-full' : ''}`}
            >
              {isLastStep ? t('onboarding.letsGo') : t('onboarding.next')}
              {!isLastStep && (
                <>
                  <span className="rtl:block ltr:hidden"><ArrowLeft className="w-5 h-5" /></span>
                  <span className="ltr:block rtl:hidden"><ArrowRight className="w-5 h-5" /></span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

