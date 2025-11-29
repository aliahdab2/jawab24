import { useUIStore } from '@/lib/store';
import { createT } from './translations';

// React hook for translations
export function useTranslation() {
  const { language, setLanguage } = useUIStore();
  const t = createT(language);
  
  return { t, language, setLanguage };
}

// Hook to get/set language
export function useLanguage() {
  const { language, setLanguage } = useUIStore();
  return { language, setLanguage };
}
