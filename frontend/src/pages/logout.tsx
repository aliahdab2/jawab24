import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useLocale } from 'next-intl';
import { useAuthStore } from '@/lib/store';
import { makeGetStaticProps } from '@/i18n/getMessages';

/**
 * /logout route — performs logout and redirects to login.
 * Covers direct URL navigation, password managers, and security tools.
 */
export default function LogoutPage() {
  const router = useRouter();
  const locale = useLocale();
  const logout = useAuthStore((state) => state.logout);

  useEffect(() => {
    const performLogout = async () => {
      await logout();
      await router.replace('/login', '/login', { locale });
    };
    performLogout();
  }, [logout, router, locale]);

  return null;
}

export const getStaticProps = makeGetStaticProps(['auth']);
