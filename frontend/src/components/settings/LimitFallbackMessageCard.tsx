import clsx from 'clsx';
import { MAX_TEMPLATE_MESSAGE_LENGTH } from '@jawab24/shared';
import { Card, Toggle, InputFieldWrapper, CharCounter } from '@/components/ui';
import { MessageSquareOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getLocaleDirection } from '@/utils/locale';
import type { SettingsCardProps } from './types';

/**
 * Shows the merchant's safety-net reply for when their monthly Smart Reply
 * quota is exhausted. UX shape mirrors Gmail/iOS vacation responder:
 *   - Master toggle decides whether anything is sent at the limit.
 *   - When OFF (default): customers receive nothing; comments and DMs are
 *     flagged for manual handling in the inbox.
 *   - When ON + custom text: send the custom message in the resolved language.
 *   - When ON + empty: send the hardcoded translation default so the toggle
 *     state always means "yes, send something" (no mode confusion).
 */
export function LimitFallbackMessageCard({ settings, setSettings }: SettingsCardProps) {
  const t = useTranslations('settings');

  const enabled = settings.limitFallbackEnabled;
  const currentLang = settings.dashboardLanguage;
  const value = settings.limitFallbackMessageMulti?.[currentLang] || '';
  const sourceLang = settings.limitFallbackMessageMulti?.sourceLang;
  const isAutoTranslated = sourceLang && sourceLang !== 'manual' && sourceLang !== currentLang;
  const displayValue = isAutoTranslated ? '' : value;
  const placeholder = isAutoTranslated && value ? value : t('limitFallbackMessagePlaceholder');
  const maxChars = MAX_TEMPLATE_MESSAGE_LENGTH;
  const charCount = displayValue.length;

  const hasAnyValue = Object.entries(settings.limitFallbackMessageMulti || {})
    .some(([k, v]) => k !== 'sourceLang' && typeof v === 'string' && v.trim().length > 0);

  return (
    <Card className="border-none shadow-lg shadow-theme-border/50 p-4 landscape:p-3 h-full flex flex-col">
      <div className="flex items-start gap-3 mb-3 landscape:mb-2">
        <div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 flex items-center justify-center shrink-0 landscape:w-9 landscape:h-9">
          <MessageSquareOff className="w-4 h-4" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0 text-start">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-foreground landscape:text-sm">{t('limitFallbackMessage.title')}</h4>
            <span className={clsx(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold',
              enabled
                ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                : 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400'
            )}>
              <span className={clsx('w-1.5 h-1.5 rounded-full', enabled ? 'bg-green-500' : 'bg-surface-400')} />
              {enabled ? t('limitFallbackMessage.statusActive') : t('limitFallbackMessage.statusOff')}
            </span>
          </div>
          <p className="text-xs text-muted-foreground font-medium mt-0.5 landscape:hidden">
            {t('limitFallbackMessage.desc')}
          </p>
        </div>
        <Toggle
          enabled={enabled}
          onChange={(next) => setSettings({ ...settings, limitFallbackEnabled: next })}
          aria-label={t('limitFallbackMessage.toggleLabel')}
        />
      </div>

      <InputFieldWrapper
        className="flex-1"
        disabled={!enabled}
        // Keep the counter visible when disabled but content exists — otherwise
        // a stored 200-char message looks identical to an empty field while off.
        trailing={(enabled || charCount > 0) ? <CharCounter value={charCount} max={maxChars} /> : null}
      >
        <textarea
          aria-label={t('limitFallbackMessage.title')}
          aria-disabled={!enabled}
          className={clsx(
            'w-full h-full bg-transparent border-none p-3 pe-14 rounded-2xl resize-none min-h-[120px]',
            'placeholder:text-muted-foreground placeholder:italic',
            'focus:outline-none focus:ring-0',
            currentLang === 'ar' && 'italic italic-arabic',
          )}
          rows={3}
          placeholder={placeholder}
          dir={displayValue ? 'auto' : getLocaleDirection(currentLang)}
          maxLength={maxChars}
          value={displayValue}
          disabled={!enabled}
          onChange={(e) => {
            const newValue = e.target.value;
            setSettings({
              ...settings,
              limitFallbackMessageMulti: {
                ...settings.limitFallbackMessageMulti,
                [currentLang]: newValue,
                sourceLang: currentLang,
              },
            });
          }}
        />
      </InputFieldWrapper>

      {/* Empty-on preview: tells the merchant exactly what gets sent when they
          enabled the feature without writing anything. Mirrors Gmail's vacation
          responder behavior — toggle ON always sends something. */}
      {enabled && !hasAnyValue && (
        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
          {t('limitFallbackMessage.emptyOnPreview', {
            defaultText: t('limitFallbackMessage.defaultPreviewText'),
          })}
        </p>
      )}
    </Card>
  );
}
