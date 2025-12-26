import { useState } from 'react';
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
import { Button } from '@/components/ui';
import { useTranslation } from '@/i18n';

interface OnboardingWizardProps {
  onComplete: () => void;
  onSkip: () => void;
}

export function OnboardingWizard({ onComplete, onSkip }: OnboardingWizardProps) {
  const { language } = useTranslation();
  const isRTL = language === 'ar';
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    {
      icon: Sparkles,
      color: 'brand',
      title: isRTL ? 'مرحباً بك في Jawab24! 👋' : 'Welcome to Jawab24! 👋',
      description: isRTL 
        ? 'سنساعدك على تفعيل الردود التلقائية على صفحتك في فيسبوك في 3 خطوات بسيطة'
        : "We'll help you set up auto-replies on your Facebook page in 3 simple steps",
      visual: (
        <div className="w-32 h-32 mx-auto bg-gradient-to-br from-brand-400 to-accent-500 rounded-3xl flex items-center justify-center shadow-2xl shadow-brand-500/30">
          <Sparkles className="w-16 h-16 text-white" />
        </div>
      ),
    },
    {
      icon: Facebook,
      color: 'blue',
      title: isRTL ? '1. ربط صفحة فيسبوك' : '1. Connect Facebook Page',
      description: isRTL 
        ? 'اضغط على "صفحاتي" في القائمة واختر صفحة فيسبوك التي تريد تفعيل الردود التلقائية عليها'
        : 'Click "My Pages" in the menu and select the Facebook page you want to enable auto-replies on',
      visual: (
        <div className="w-32 h-32 mx-auto bg-blue-100 rounded-3xl flex items-center justify-center">
          <Facebook className="w-16 h-16 text-blue-600" />
        </div>
      ),
    },
    {
      icon: FileText,
      color: 'emerald',
      title: isRTL ? '2. أضف معلومات عملك' : '2. Add Your Business Info',
      description: isRTL 
        ? 'أخبرنا عن منتجاتك وخدماتك وأسعارك لنتمكن من الرد بشكل أفضل على عملائك'
        : 'Tell us about your products, services, and prices so we can reply better to your customers',
      visual: (
        <div className="w-32 h-32 mx-auto bg-emerald-100 rounded-3xl flex items-center justify-center">
          <FileText className="w-16 h-16 text-emerald-600" />
        </div>
      ),
    },
    {
      icon: Zap,
      color: 'amber',
      title: isRTL ? '3. فعّل الردود التلقائية' : '3. Enable Auto-Replies',
      description: isRTL 
        ? 'فعّل خاصية الرد التلقائي وستبدأ بالرد على تعليقات ورسائل عملائك تلقائياً!'
        : 'Turn on auto-reply and we\'ll start responding to your customers\' comments and messages automatically!',
      visual: (
        <div className="w-32 h-32 mx-auto bg-amber-100 rounded-3xl flex items-center justify-center">
          <Zap className="w-16 h-16 text-amber-600" />
        </div>
      ),
    },
    {
      icon: CheckCircle2,
      color: 'emerald',
      title: isRTL ? 'تم! أنت جاهز! 🎉' : "You're All Set! 🎉",
      description: isRTL 
        ? 'الآن سيتم الرد على تعليقات ورسائل صفحتك تلقائياً على مدار الساعة'
        : 'Now your page comments and messages will be replied to automatically 24/7',
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-slide-up">
        {/* Skip button */}
        <div className="flex justify-end p-4 pb-0">
          <button 
            onClick={onSkip}
            className="text-surface-400 hover:text-surface-600 text-sm flex items-center gap-1"
          >
            {isRTL ? 'تخطي' : 'Skip'}
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-8 pb-8 pt-4 text-center">
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
                {isRTL ? <ArrowRight className="w-5 h-5" /> : <ArrowLeft className="w-5 h-5" />}
                {isRTL ? 'السابق' : 'Previous'}
              </Button>
            )}
            <Button
              size="lg"
              onClick={handleNext}
              className={`flex-1 ${isFirstStep ? 'w-full' : ''}`}
            >
              {isLastStep 
                ? (isRTL ? 'ابدأ الآن! 🚀' : "Let's Go! 🚀")
                : (isRTL ? 'التالي' : 'Next')
              }
              {!isLastStep && (isRTL ? <ArrowLeft className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />)}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

