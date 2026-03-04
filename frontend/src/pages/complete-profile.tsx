import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui';
import { Loader2, Mail, CheckCircle2, AlertCircle, Shield, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { captureError } from '@/lib/sentryHelpers';

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CompleteProfilePage() {
  const router = useRouter();
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';
  const { user, setAuth, _hasHydrated } = useAuthStore();
  
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [emailTouched, setEmailTouched] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Check if email is valid
  const isEmailValid = EMAIL_REGEX.test(email);
  const showEmailError = emailTouched && email.length > 0 && !isEmailValid;
  const showEmailSuccess = emailTouched && email.length > 0 && isEmailValid;

  // Wait for hydration and check if user needs this page
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!_hasHydrated) return;
    
    // If user already has email, redirect to dashboard
    if (user?.email) {
      const redirect = router.query.redirect as string;
      router.push(redirect || '/dashboard');
      return;
    }
    
    // If no user at all, redirect to login
    if (!user) {
      router.push('/login');
      return;
    }
    
    setIsLoading(false);
  }, [user, _hasHydrated, router]);

  // Handle email change with validation
  const handleEmailChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEmail(value);
    setError(''); // Clear error when user types
  }, []);

  // Handle blur - mark as touched for validation display
  const handleEmailBlur = useCallback(() => {
    setEmailTouched(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailTouched(true);
    
    // Validate email
    if (!email || !isEmailValid) {
      setError(t('profile.invalidEmail'));
      return;
    }

    setSaving(true);
    setError('');

    try {
      const response = await api.patch('/auth/profile', { email });
      
      // Update user in store
      if (user) {
        setAuth(
          { ...user, email: response.data.email },
          localStorage.getItem('token') || '',
          localStorage.getItem('fbToken') || ''
        );
      }

      setSuccess(true);
      
      // Redirect to intended destination or dashboard
      setTimeout(() => {
        const redirect = router.query.redirect as string;
        router.push(redirect || '/dashboard');
      }, 2000);
      
    } catch (err: any) {
      captureError(err, 'Save email error', { tags: { page: 'complete-profile' } });
      setError(err.response?.data?.error || t('profile.saveFailed'));
      setSaving(false);
    }
  };

  // Don't render until mounted (prevents hydration mismatch)
  if (!mounted) return null;

  // Loading state while checking user status
  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto bg-background px-4 py-8 pt-safe pb-safe">
        <div className="bg-card rounded-2xl shadow-xl p-8 max-w-md w-full mx-auto animate-pulse">
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 bg-surface-200 rounded-full mb-4" />
            <div className="h-8 w-48 bg-surface-200 rounded mb-2" />
            <div className="h-4 w-64 bg-surface-200 rounded mb-8" />
            <div className="w-full h-12 bg-surface-200 rounded-lg mb-4" />
            <div className="w-full h-12 bg-surface-200 rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  // Success state with animation
  if (success) {
    return (
      <div 
        className="flex-1 overflow-y-auto bg-background px-4 py-8 pt-safe pb-safe"
        role="main"
        aria-label={t('profile.complete')}
      >
        <div className="bg-card rounded-2xl shadow-xl p-8 max-w-md w-full mx-auto text-center animate-fade-in">
          {/* Animated success icon */}
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce-in">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
          
          <h2 className="text-2xl font-bold text-foreground mb-2">
            {t('profile.complete')}
          </h2>

          <p className="text-muted-foreground mb-6">
            {t('profile.redirecting')}
          </p>
          
          {/* Progress bar animation */}
          <div className="w-full h-1 bg-surface-200 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full animate-progress" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{t('profile.title')} - Jawab24</title>
        <meta name="description" content={t('profile.emailRequired')} />
      </Head>

      <div 
        className="flex-1 overflow-y-auto bg-background px-4 py-8 pt-safe pb-safe"
        role="main"
      >
        <div className="bg-card rounded-2xl shadow-xl p-8 max-w-md w-full mx-auto animate-fade-in">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-brand-100 rounded-full flex items-center justify-center mx-auto mb-4 transition-transform hover:scale-105">
              <Mail className="w-8 h-8 text-brand-600" aria-hidden="true" />
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              {t('profile.title')}
            </h1>
            <p className="text-muted-foreground">
              {t('profile.emailRequired')}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6" noValidate>
            <div>
              <label 
                htmlFor="email" 
                className="block text-sm font-medium text-foreground/70 mb-2 text-start"
              >
                {t('profile.emailAddress')}
              </label>
              
              {/* Email input with validation icons */}
              <div className="relative">
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={handleEmailChange}
                  onBlur={handleEmailBlur}
                  placeholder={t('profile.emailPlaceholder')}
                  className={`w-full px-4 py-3 pe-12 border rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:border-transparent ${
                    showEmailError 
                      ? 'border-red-300 focus:ring-red-500 bg-red-50' 
                      : showEmailSuccess 
                        ? 'border-green-300 focus:ring-green-500 bg-green-50' 
                        : 'border-surface-300 focus:ring-brand-500'
                  }`}
                  dir="auto"
                  disabled={saving}
                  required
                  autoFocus
                  autoComplete="email"
                  aria-invalid={showEmailError ? 'true' : undefined}
                  aria-describedby={showEmailError ? 'email-error' : undefined}
                />
                
                {/* Validation icon */}
                <div className="absolute top-1/2 -translate-y-1/2 end-4">
                  {showEmailSuccess && (
                    <CheckCircle2 className="w-5 h-5 text-green-500 animate-fade-in" aria-hidden="true" />
                  )}
                  {showEmailError && (
                    <AlertCircle className="w-5 h-5 text-red-500 animate-fade-in" aria-hidden="true" />
                  )}
                </div>
              </div>
              
              {/* Inline validation error */}
              {showEmailError && (
                <p 
                  id="email-error" 
                  className={`mt-2 text-sm text-red-600 flex items-center gap-1 animate-fade-in ${isRTL ? 'flex-row-reverse' : ''}`}
                  role="alert"
                >
                  <AlertCircle className="w-4 h-4" aria-hidden="true" />
                  {t('profile.invalidEmail')}
                </p>
              )}
            </div>

            {/* Server error */}
            {error && !showEmailError && (
              <div 
                className="p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-xl animate-fade-in"
                role="alert"
              >
                <p className={`text-sm text-red-800 dark:text-red-300 flex items-center gap-2 ${isRTL ? 'flex-row-reverse' : ''}`}>
                  <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                  {error}
                </p>
              </div>
            )}

            {/* Submit button */}
            <Button
              type="submit"
              size="lg"
              className="w-full transition-all duration-200 hover:shadow-lg"
              disabled={saving || email.length === 0 || showEmailError}
            >
              {saving ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                  {t('common.saving')}
                </span>
              ) : (
                t('common.continue')
              )}
            </Button>
          </form>

          {/* Trust indicators */}
          <div className="mt-8 pt-6 border-t border-theme-border">
            <div className="flex items-center justify-center gap-2 text-muted-foreground mb-3">
              <Shield className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs font-medium">{t('profile.privacyNote')}</span>
            </div>
            
            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Lock className="w-3 h-3" aria-hidden="true" />
                {t('profile.encrypted')}
              </span>
              <span>•</span>
              <span>{t('profile.neverShared')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Custom animations */}
      <style jsx global>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes bounce-in {
          0% { transform: scale(0); }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
        
        @keyframes progress {
          from { width: 0%; }
          to { width: 100%; }
        }
        
        .animate-fade-in {
          animation: fade-in 0.3s ease-out forwards;
        }
        
        .animate-bounce-in {
          animation: bounce-in 0.5s ease-out forwards;
        }
        
        .animate-progress {
          animation: progress 2s ease-out forwards;
        }
      `}</style>

      {/* Fixed safe area backgrounds */}
      <div className="fixed-safe-bg top-safe-bg bg-card" aria-hidden="true" />
      <div className="fixed-safe-bg bottom-safe-bg bg-muted" aria-hidden="true" />
    </>
  );
}
