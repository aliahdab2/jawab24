import { Card } from '@/components/ui';
import { Globe } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { settingsApi } from '@/lib/api';
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
  const { t } = useTranslation();

  const handleLanguageChange = async (lang: 'ar' | 'en') => {
    const newSettings = { ...settings, dashboardLanguage: lang };
    setSettings(newSettings);
    setInitialSettings({ ...initialSettings, dashboardLanguage: lang });
    try {
      await settingsApi.update(newSettings as unknown as Record<string, unknown>);
      setLanguage(lang);
    } catch {
      toast.error(t('common.error'));
    }
  };

  return (
    <Card className="border-none shadow-[0_10_30px_rgba(0,0,0,0.04)] p-5 landscape:p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-brand-600/10 text-brand-600 flex items-center justify-center landscape:w-10 landscape:h-10 landscape:rounded-xl">
            <Globe className="w-6 h-6 landscape:w-5 landscape:h-5" />
          </div>
          <div className="text-start">
            <h3 className="font-bold text-surface-900 text-base landscape:text-sm">{t('settings.language')}</h3>
            <p className="text-xs text-surface-500 mt-1">{t('settings.dashboardLanguage.desc')}</p>
          </div>
        </div>

        <div className="flex gap-1 p-1 bg-surface-100 rounded-xl">
          <button
            onClick={() => handleLanguageChange('ar')}
            className={`px-4 py-2 landscape:py-1.5 landscape:px-3 rounded-lg text-sm font-bold transition-all ${settings.dashboardLanguage === 'ar'
              ? 'bg-white text-brand-600 shadow-sm'
              : 'text-surface-600 hover:text-surface-900'
              }`}
          >
            🇸🇦 {t('common.langArabic')}
          </button>
          <button
            onClick={() => handleLanguageChange('en')}
            className={`px-4 py-2 landscape:py-1.5 landscape:px-3 rounded-lg text-sm font-bold transition-all ${settings.dashboardLanguage === 'en'
              ? 'bg-white text-brand-600 shadow-sm'
              : 'text-surface-600 hover:text-surface-900'
              }`}
          >
            🇬🇧 {t('common.langEnglish')}
          </button>
        </div>
      </div>
    </Card>
  );
}
