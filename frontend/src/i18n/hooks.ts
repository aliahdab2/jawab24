// import { useRouter } from 'next/router'; // Removed for static export compatibility
import { useCallback } from 'react';
import { useUIStore } from '@/lib/store';
import { createT, Language, TranslationKey } from './translations';

export { type TranslationKey };

// React hook for translations - uses global store state (compatible with Static Export)
export function useTranslation() {
  const language = useUIStore((state) => state.language);
  const setStoreLanguage = useUIStore((state) => state.setLanguage);
  
  const t = createT(language);

  // Function to change language via store
  const setLanguage = useCallback((newLang: Language) => {
    setStoreLanguage(newLang);
    // Update HTML dir attribute for immediate feedback
    if (typeof document !== 'undefined') {
      document.dir = newLang === 'ar' ? 'rtl' : 'ltr';
      document.documentElement.lang = newLang;
    }
  }, [setStoreLanguage]);

  return { t, language, setLanguage };
}

// Hook to get/set language - uses global store state
export function useLanguage() {
  const language = useUIStore((state) => state.language);
  const setStoreLanguage = useUIStore((state) => state.setLanguage);

  const setLanguage = useCallback((newLang: Language) => {
    setStoreLanguage(newLang);
    if (typeof document !== 'undefined') {
      document.dir = newLang === 'ar' ? 'rtl' : 'ltr';
      document.documentElement.lang = newLang;
    }
  }, [setStoreLanguage]);

  return { language, setLanguage };
}
