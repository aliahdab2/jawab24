import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui';
import { Loader2, Mail, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

export default function CompleteProfilePage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, setAuth } = useAuthStore();
  
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // If user already has email, redirect to dashboard
    if (user?.email) {
      router.push('/dashboard');
    }
  }, [user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate email
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
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
      }, 1500);
      
    } catch (err: any) {
      console.error('Save email error:', err);
      setError(err.response?.data?.error || 'Failed to save email. Please try again.');
      setSaving(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-violet-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-surface-900 mb-2">
            Profile Complete!
          </h2>
          <p className="text-surface-600">
            Redirecting you now...
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Complete Your Profile - Jawab24</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-violet-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-brand-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Mail className="w-8 h-8 text-brand-600" />
            </div>
            <h1 className="text-3xl font-bold text-surface-900 mb-2">
              {'Complete Your Profile'}
            </h1>
            <p className="text-surface-600">
              {t('profile.emailRequired') || 'Please provide your email address to continue. We\'ll use it for account notifications and receipts.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-surface-700 mb-2">
                {t('profile.emailAddress') || 'Email Address'}
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-4 py-3 border border-surface-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                disabled={saving}
                required
                autoFocus
              />
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={saving || !email}
            >
              {saving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  {t('common.saving') || 'Saving...'}
                </>
              ) : (
                t('common.continue') || 'Continue'
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-xs text-surface-500">
              {t('profile.privacyNote') || 'We respect your privacy. Your email will only be used for account-related communications.'}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
