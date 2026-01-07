import { useState, useRef, useMemo } from 'react';
import { 
  Facebook, 
  FileText, 
  Zap, 
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  X,
  Sparkles
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui';
import { useTranslation } from '@/i18n';

interface OnboardingWizardProps {
  onComplete: () => void;
  onSkip: () => void;
}

export function OnboardingWizard({ onComplete, onSkip }: OnboardingWizardProps) {
  const { t, language } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  
  // Touch swipe state (Step 1)
  const MIN_SWIPE_DISTANCE = 50;
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const touchEndY = useRef<number | null>(null);
  const [navDirection, setNavDirection] = useState<1 | -1>(1);
  const wizardRef = useRef<HTMLDivElement | null>(null);
  
  // RTL detection (Step 2)
  const isRTL = useMemo(() => {
    if (!wizardRef.current) return language === 'ar';
    return getComputedStyle(wizardRef.current).direction === 'rtl';
  }, [currentStep, language]);

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
      icon: Facebook,
      color: 'blue',
      title: t('onboarding.step1Title'),
      description: t('onboarding.step1Desc'),
      visual: (
        <div className="w-32 h-32 mx-auto bg-blue-100 rounded-3xl flex items-center justify-center">
          <Facebook className="w-16 h-16 text-blue-600" />
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

  // Step 4: Wrapped navigation with direction
  const goNextWithDir = () => {
    if (isLastStep) {
      onComplete();
      return;
    }
    setNavDirection(1);
    handleNext();
  };

  const goPrevWithDir = () => {
    if (isFirstStep) return;
    setNavDirection(-1);
    handlePrev();
  };

  // Helper to prevent swipes starting on interactive elements
  const shouldIgnoreTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    !!target.closest("button, a, input, textarea, select, [contenteditable='true']");

  // Step 5: Touch handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (shouldIgnoreTarget(e.target)) return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
    touchEndX.current = null;
    touchEndY.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchEndX.current = t.clientX;
    touchEndY.current = t.clientY;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current == null || touchEndX.current == null) return;

    const dx = touchEndX.current - touchStartX.current;

    // Vertical scroll guard: ignore mostly-vertical gestures
    if (touchStartY.current != null && touchEndY.current != null) {
      const dy = touchEndY.current - touchStartY.current;
      if (Math.abs(dx) < Math.abs(dy) * 1.2) {
        // Reset refs before returning
        touchStartX.current = null;
        touchEndX.current = null;
        touchStartY.current = null;
        touchEndY.current = null;
        return;
      }
    }

    if (Math.abs(dx) < MIN_SWIPE_DISTANCE) {
      // Reset refs before returning
      touchStartX.current = null;
      touchEndX.current = null;
      touchStartY.current = null;
      touchEndY.current = null;
      return;
    }

    const swipeLeft = dx < 0;

    // LTR: left => next, right => prev
    // RTL: reversed
    const shouldGoNext = isRTL ? !swipeLeft : swipeLeft;

    if (shouldGoNext) {
      goNextWithDir();
    } else {
      goPrevWithDir();
    }

    // Reset refs after navigation
    touchStartX.current = null;
    touchEndX.current = null;
    touchStartY.current = null;
    touchEndY.current = null;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div
        ref={wizardRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ touchAction: 'pan-y' }}
        className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-slide-up"
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

        {/* Content */}
        <div className="px-8 pb-8 pt-4 text-center">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={currentStep}
              initial={{ x: navDirection === 1 ? 40 : -40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: navDirection === 1 ? -40 : 40, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="mb-6">{currentStepData.visual}</div>

              <h2 className="text-2xl font-bold text-surface-900 mb-3">
                {currentStepData.title}
              </h2>

              <p className="text-surface-600 text-lg mb-8 leading-relaxed">
                {currentStepData.description}
              </p>
            </motion.div>
          </AnimatePresence>

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
                onClick={goPrevWithDir}
                className="flex-1"
              >
                <span className="rtl:block ltr:hidden">
                  <ArrowRight className="w-5 h-5" />
                </span>
                <span className="ltr:block rtl:hidden">
                  <ArrowLeft className="w-5 h-5" />
                </span>
                {t('onboarding.previous')}
              </Button>
            )}

            <Button
              size="lg"
              onClick={goNextWithDir}
              className={`flex-1 ${isFirstStep ? 'w-full' : ''}`}
            >
              {isLastStep ? t('onboarding.letsGo') : t('onboarding.next')}
              {!isLastStep && (
                <>
                  <span className="rtl:block ltr:hidden">
                    <ArrowLeft className="w-5 h-5" />
                  </span>
                  <span className="ltr:block rtl:hidden">
                    <ArrowRight className="w-5 h-5" />
                  </span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
