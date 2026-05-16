import { Card } from '@/components/ui';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { MessageKeys, NestedKeyOf } from 'use-intl';
import { useTheme } from '@/hooks';
import type { Theme } from '@/lib/store';

type SettingsKey = MessageKeys<IntlMessages['settings'], NestedKeyOf<IntlMessages['settings']>>;

const THEME_OPTIONS: { value: Theme; icon: typeof Sun; labelKey: SettingsKey }[] = [
  { value: 'light', icon: Sun, labelKey: 'lightTheme' },
  { value: 'dark', icon: Moon, labelKey: 'darkTheme' },
  { value: 'system', icon: Monitor, labelKey: 'autoTheme' },
];

export function ThemeSelector() {
  const t = useTranslations('settings');
  const { theme, setTheme } = useTheme();

  return (
    <Card className="border-none shadow-card-soft p-5 landscape:p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-brand-600/10 text-brand-600 flex items-center justify-center flex-shrink-0 landscape:w-10 landscape:h-10 landscape:rounded-xl">
            {theme === 'dark' ? (
              <Moon className="w-5 h-5 landscape:w-5 landscape:h-5" />
            ) : theme === 'light' ? (
              <Sun className="w-5 h-5 landscape:w-5 landscape:h-5" />
            ) : (
              <Monitor className="w-5 h-5 landscape:w-5 landscape:h-5" />
            )}
          </div>
          <div className="text-start min-w-0">
            <h3 className="font-bold text-foreground text-sm landscape:text-sm">
              {t('theme')}
            </h3>
          </div>
        </div>

        <div
          className="flex gap-1 p-1 bg-muted rounded-xl"
          role="radiogroup"
          aria-label={t('theme')}
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
