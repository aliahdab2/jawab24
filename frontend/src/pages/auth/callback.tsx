import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { MessageCircle, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useAuthStore } from '@/lib/store';
import { authApi } from '@/lib/api';

export default function AuthCallbackPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const handleCallback = async () => {
      const { code, error: fbError } = router.query;

      if (fbError) {
        setStatus('error');
        setError('Facebook login was cancelled or failed');
        return;
      }

      if (!code || typeof code !== 'string') {
        // Wait for query params to be available
        return;
      }

      try {
        const response = await authApi.loginWithFacebook(code);
        const { token, user } = response.data;
        
        setAuth(user, token);
        setStatus('success');
        
        setTimeout(() => {
          router.push('/dashboard');
        }, 1500);
      } catch (err) {
        console.error('Auth error:', err);
        setStatus('error');
        setError('Failed to complete authentication. Please try again.');
      }
    };

    if (router.isReady) {
      handleCallback();
    }
  }, [router.isReady, router.query, setAuth, router]);

  return (
    <>
      <Head>
        <title>Authenticating... | Jawab24</title>
      </Head>
      <div className="min-h-screen flex items-center justify-center bg-surface-50">
        <div className="text-center">
          {/* Logo */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-400 to-accent-500 flex items-center justify-center shadow-xl">
              <MessageCircle className="w-7 h-7 text-white" />
            </div>
          </div>

          {status === 'loading' && (
            <>
              <Loader2 className="w-12 h-12 text-brand-600 animate-spin mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-surface-900 mb-2">
                Completing Sign In...
              </h2>
              <p className="text-surface-500">
                Please wait while we verify your account
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-emerald-600" />
              </div>
              <h2 className="text-xl font-semibold text-surface-900 mb-2">
                Welcome Back!
              </h2>
              <p className="text-surface-500">
                Redirecting to your dashboard...
              </p>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-8 h-8 text-red-600" />
              </div>
              <h2 className="text-xl font-semibold text-surface-900 mb-2">
                Authentication Failed
              </h2>
              <p className="text-surface-500 mb-6">
                {error}
              </p>
              <button
                onClick={() => router.push('/login')}
                className="btn-primary"
              >
                Try Again
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

