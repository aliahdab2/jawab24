import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuthStore } from '@/lib/store';
import { PageSpinner } from '@/components/ui';

export default function AuthCallback() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      const { code, error: fbError } = router.query;

      if (fbError) {
        setError('Facebook login was cancelled or failed.');
        setTimeout(() => router.push('/login'), 3000);
        return;
      }

      if (!code || typeof code !== 'string') {
        // Wait for query params to be available
        return;
      }

      try {
        // Exchange code for token via our backend
        // Use absolute URL to avoid any routing issues
        const response = await fetch('https://jawab24.com/api/auth/facebook', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.message || 'Authentication failed');
        }

        const data = await response.json();
        
        // Store auth data
        setAuth(data.user, data.token);
        
        // Redirect to dashboard
        router.push('/dashboard');
      } catch (err) {
        console.error('Auth error:', err);
        setError(err instanceof Error ? err.message : 'Authentication failed');
        setTimeout(() => router.push('/login'), 3000);
      }
    };

    if (router.isReady) {
      handleCallback();
    }
  }, [router.isReady, router.query, setAuth, router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50">
        <div className="text-center">
          <div className="text-red-500 text-xl mb-4">❌</div>
          <h1 className="text-xl font-semibold text-surface-900 mb-2">خطأ في تسجيل الدخول</h1>
          <p className="text-surface-500 mb-4">{error}</p>
          <p className="text-sm text-surface-400">جاري إعادة التوجيه...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50">
      <div className="text-center">
        <PageSpinner />
        <p className="mt-4 text-surface-500">جاري تسجيل الدخول...</p>
      </div>
    </div>
  );
}
