import { useState } from 'react';
import clsx from 'clsx';
import { Card, InputFieldWrapper } from '@/components/ui';
import {
  Clock,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SettingsCardProps } from './types';

export function ReplyDelayCard({ settings, setSettings }: SettingsCardProps) {
  const t = useTranslations('settings');
  const [showDelayInfo, setShowDelayInfo] = useState(false);

  return (
    <Card className="border-none shadow-md shadow-theme-border/30 p-4 landscape:p-3">
      <div className="flex items-center gap-4 mb-4 landscape:mb-3">
        <div className="w-12 h-12 rounded-xl icon-bg-brand flex items-center justify-center landscape:w-10 landscape:h-10">
          <Clock className="w-5 h-5" />
        </div>
        <div className="text-start">
          <h4 className="font-bold text-foreground text-lg landscape:text-base">{t('replyDelay.title')}</h4>
          <p className="text-xs text-muted-foreground font-medium landscape:hidden">{t('replyDelay.desc')}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-2">
        <InputFieldWrapper className="w-full">
          <input
            type="number"
            min={0}
            max={60}
            aria-label={t('replyDelay.title')}
            value={settings.replyDelay}
            onChange={(e) => setSettings({ ...settings, replyDelay: Math.min(60, Math.max(0, parseInt(e.target.value) || 0)) })}
            className={clsx(
              'w-full bg-transparent border-none p-3 rounded-2xl text-center font-bold text-lg',
              'placeholder:text-muted-foreground placeholder:italic',
              'focus:outline-none focus:ring-0',
            )}
          />
        </InputFieldWrapper>
        <span className="text-sm font-bold text-muted-foreground uppercase tracking-widest">{t('seconds')}</span>
      </div>
      <div className="mt-2 flex gap-2 flex-wrap">
        {[
          { value: 0, label: t('replyDelay.instant') },
          { value: 2, label: t('replyDelay.natural') },
          { value: 10, label: t('replyDelay.slower') },
        ].map((opt) => (
          <button
            key={opt.value}
            onClick={() => setSettings({ ...settings, replyDelay: opt.value })}
            className={clsx(
              "px-4 py-3 text-sm font-medium rounded-lg transition-all min-h-[44px] active:scale-[0.98] flex items-center gap-1.5",
              settings.replyDelay === opt.value
                ? "bg-brand-500 text-white shadow-lg hover:bg-brand-600"
                : "bg-muted text-muted-foreground border border-theme-border hover:bg-muted/80 hover:shadow-md"
            )}
          >
            {settings.replyDelay === opt.value && <Check className="w-3.5 h-3.5" />}
            {opt.label} {opt.value > 0 && <span className="opacity-60">({opt.value}{t('seconds')})</span>}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        {t('replyDelay.example')}
      </p>
      <button
        onClick={() => setShowDelayInfo(!showDelayInfo)}
        className="flex items-center gap-1 text-xs text-brand-600 font-medium mt-1 hover:text-brand-700 transition-colors"
      >
        {t('replyDelay.learnMore')}
        {showDelayInfo ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {showDelayInfo && (
        <div className="mt-2 p-3 rounded-lg bg-background border border-theme-border animate-slide-up">
          <p className="text-xs text-muted-foreground">
            {t('replyDelay.tip')}
          </p>
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            {t('replyDelay.formula')}
          </p>
        </div>
      )}
    </Card>
  );
}
