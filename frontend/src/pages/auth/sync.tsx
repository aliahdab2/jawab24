import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuthStore } from '@/lib/store';
import { PageSpinner } from '@/components/ui';

export default function AuthSync() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [status, setStatus] = useState('Initializing...');

  useEffect(() => {
    if (!router.isReady) return;

    const syncAuth = async () => {
      try {
        setStatus('Syncing session...');
        const { token, fbToken, user: userStr, redirect } = router.query;

        if (!token || typeof token !== 'string') {
            throw new Error('No token provided');
        }

        if (!userStr || typeof userStr !== 'string') {
            throw new Error('No user data provided');
        }

        let user;
        try {
            user = JSON.parse(decodeURIComponent(userStr));
        } catch (e) {
            throw new Error('Invalid user data');
        }

        // Hydrate the store
        setAuth(user, token, fbToken as string || '');
        
        setStatus('Redirecting...');
        
        // Brief delay to ensure storage persistence
        setTimeout(() => {
            const redirectPath = redirect ? decodeURIComponent(redirect as string) : '/dashboard';
            router.push(redirectPath);
        }, 100);

      } catch (err) {
        console.error('Auth Sync Error:', err);
        setStatus('Sync failed. Redirecting to login...');
        setTimeout(() => router.push('/login'), 2000);
      }
    };

    syncAuth();
  }, [router.isReady, router.query, setAuth, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50">
      <div className="text-center">
        <PageSpinner />
        <p className="mt-4 text-surface-500 text-sm font-medium">{status}</p>
      </div>
    </div>
  );
}
