import { Card } from '@/components/ui';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTranslation } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { useTheme } from '@/hooks';
import type { Theme } from '@/lib/store';

const THEME_OPTIONS: { value: Theme; icon: typeof Sun; labelKey: TranslationKey }[] = [
  { value: 'light', icon: Sun, labelKey: 'settings.lightTheme' },
  { value: 'dark', icon: Moon, labelKey: 'settings.darkTheme' },
  { value: 'system', icon: Monitor, labelKey: 'settings.autoTheme' },
];

export function ThemeSelector() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <Card className="border-none shadow-[0_10px_30px_rgba(0,0,0,0.04)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.3)] p-5 landscape:p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-brand-600/10 text-brand-600 flex items-center justify-center landscape:w-10 landscape:h-10 landscape:rounded-xl">
            {theme === 'dark' ? (
              <Moon className="w-6 h-6 landscape:w-5 landscape:h-5" />
            ) : theme === 'light' ? (
              <Sun className="w-6 h-6 landscape:w-5 landscape:h-5" />
            ) : (
              <Monitor className="w-6 h-6 landscape:w-5 landscape:h-5" />
            )}
          </div>
          <div className="text-start">
            <h3 className="font-bold text-foreground text-base landscape:text-sm">
              {t('settings.theme')}
            </h3>
          </div>
        </div>

        <div
          className="flex gap-1 p-1 bg-muted rounded-xl"
          role="radiogroup"
          aria-label={t('settings.theme')}
        >
          {THEME_OPTIONS.map(({ value, icon: Icon, labelKey }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              role="radio"
              aria-checked={theme === value}
              className={`flex items-center gap-1.5 px-3 py-2 landscape:py-1.5 landscape:px-2.5 rounded-lg text-sm font-bold transition-all ${
                theme === value
                  ? 'bg-card text-brand-600 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t(labelKey)}</span>
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}
