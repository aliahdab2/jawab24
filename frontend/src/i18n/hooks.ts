import { useRouter } from 'next/router';
import { useUIStore } from '@/lib/store';
import { createT, Language } from './translations';

// React hook for translations - uses Next.js router locale
export function useTranslation() {
  const router = useRouter();
  const storeLanguage = useUIStore((state) => state.language);

  // Use router locale if available, fallback to store
  const language = (router.locale as Language) || storeLanguage;
  const t = createT(language);

  // Function to change language via Next.js routing
  const setLanguage = (newLang: Language) => {
    // Update store explicitly before navigation to support our redirect logic
    useUIStore.getState().setLanguage(newLang);
    router.push(router.pathname, router.asPath, { locale: newLang });
  };

  return { t, language, setLanguage };
}

// Hook to get/set language - uses Next.js router locale
export function useLanguage() {
  const router = useRouter();
  const storeLanguage = useUIStore((state) => state.language);

  const language = (router.locale as Language) || storeLanguage;

  const setLanguage = (newLang: Language) => {
    useUIStore.getState().setLanguage(newLang);
    router.push(router.pathname, router.asPath, { locale: newLang });
  };

  return { language, setLanguage };
}
