import { Card } from '@/components/ui';
import { Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { persistDashboardLanguage } from '@/lib/dashboardLanguage';
import { captureError } from '@/lib/sentryHelpers';
import { toast } from 'sonner';
import type { SettingsState } from './types';

interface LanguageSelectorProps {
  settings: SettingsState;
  initialSettings: SettingsState;
  setSettings: (settings: SettingsState) => void;
  setInitialSettings: (settings: SettingsState) => void;
  setLanguage: (lang: 'ar' | 'en') => void;
}

export function LanguageSelector({
  settings,
  initialSettings,
  setSettings,
  setInitialSettings,
  setLanguage,
}: LanguageSelectorProps) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');

  const handleLanguageChange = async (lang: 'ar' | 'en') => {
    if (lang === settings.dashboardLanguage) return;

    try {
      // Shared with the nav-bar toggle in DashboardLayout — see the helper for
      // why this patches only the language field.
      await persistDashboardLanguage(lang);
      // Commit local state only after the persist succeeds, so a failed PUT
      // doesn't leave the UI showing a language the backend never saved.
      setSettings({ ...settings, dashboardLanguage: lang });
      setInitialSettings({ ...initialSettings, dashboardLanguage: lang });
      setLanguage(lang);
    } catch (error) {
      captureError(error, 'Failed to change dashboard language', {
        tags: { page: 'settings', action: 'change-language' },
      });
      toast.error(tc('error'));
    }
  };

  return (
    <Card className="border-none shadow-[0_10_30px_rgba(0,0,0,0.04)] p-5 landscape:p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-brand-600/10 text-brand-600 flex items-center justify-center flex-shrink-0 landscape:w-10 landscape:h-10 landscape:rounded-xl">
            <Globe className="w-5 h-5 landscape:w-5 landscape:h-5" />
          </div>
          <div className="text-start min-w-0">
            <h3 className="font-bold text-foreground text-sm landscape:text-sm">{t('language')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t('dashboardLanguage.desc')}</p>
          </div>
        </div>

        <div className="flex gap-1 p-1 bg-muted rounded-xl">
          <button
            onClick={() => handleLanguageChange('ar')}
            className={`px-4 py-2 landscape:py-1.5 landscape:px-3 rounded-lg text-sm font-bold transition-all ${settings.dashboardLanguage === 'ar'
              ? 'bg-card text-brand-600 shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
              }`}
          >
            🇸🇦 {tc('langArabic')}
          </button>
          <button
            onClick={() => handleLanguageChange('en')}
            className={`px-4 py-2 landscape:py-1.5 landscape:px-3 rounded-lg text-sm font-bold transition-all ${settings.dashboardLanguage === 'en'
              ? 'bg-card text-brand-600 shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
              }`}
          >
            🇬🇧 {tc('langEnglish')}
          </button>
        </div>
      </div>
    </Card>
  );
}
