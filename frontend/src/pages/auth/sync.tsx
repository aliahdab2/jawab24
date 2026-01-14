import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuthStore } from '@/lib/store';
import axios from 'axios';

export default function AuthSync() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [status, setStatus] = useState('Initializing...');

  useEffect(() => {
    if (!router.isReady) return;

    const syncAuth = async () => {
      try {
        setStatus('Syncing session...');
        
        // 1. Get tokens from URL
        const { token, fbToken, redirect } = router.query;

        if (!token || typeof token !== 'string') {
            throw new Error('No token provided');
        }

        // 2. Fetch fresh user profile using the token
        setStatus('Verifying user...');
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';
        
        const userRes = await axios.get(`${apiUrl}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        const user = userRes.data;

        if (!user || !user.id) {
          throw new Error('Failed to fetch user profile');
        }

        // 3. Hydrate the store
        setAuth(user, token, fbToken as string || '');
        
        setStatus('Redirecting...');
        
        // Brief delay to ensure storage persistence
        setTimeout(() => {
            // redirect from query is already URL-decoded by Next.js router
            const redirectPath = (redirect && typeof redirect === 'string' && redirect.startsWith('/')) 
              ? redirect 
              : '/dashboard';
            router.replace(redirectPath);
        }, 100);

      } catch (err) {
        console.error('Auth Sync Error:', err);
        setStatus('Sync failed. Please log in again.');
        // Give user a chance to read the error before redirecting
        setTimeout(() => router.replace('/login'), 2500);
      }
    };

    syncAuth();
  }, [router.isReady, router.query, setAuth, router]);

  return (
    <div className="flex-1 overflow-y-auto flex items-center justify-center bg-surface-50">
      <div className="text-center">
        <p className="text-surface-500 text-sm font-medium">{status}</p>
      </div>
    </div>
  );
}
