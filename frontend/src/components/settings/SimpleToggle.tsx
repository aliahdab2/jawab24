import React from 'react';
import clsx from 'clsx';
import { Toggle } from '@/components/ui';

interface SimpleToggleProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  /**
   * Hero treatment for master switches — larger padding, larger icon container,
   * larger title, and a stronger enabled-state shadow. Use sparingly: at most
   * one prominent toggle per section so the visual hierarchy stays meaningful.
   */
  prominent?: boolean;
}

export function SimpleToggle({
  icon,
  title,
  description,
  enabled,
  onChange,
  prominent = false,
}: SimpleToggleProps) {
  return (
    <div
      className={clsx(
        'flex items-center justify-between gap-4 rounded-2xl border transition-all duration-300',
        prominent ? 'p-5 landscape:p-4' : 'p-4',
        enabled
          ? clsx(
              'bg-brand-50/30 dark:bg-brand-950/20 border-brand-100 dark:border-brand-800/40',
              prominent
                ? 'shadow-[0_10px_30px_rgba(16,185,129,0.12)] dark:shadow-[0_10px_30px_rgba(16,185,129,0.06)] ring-1 ring-brand-200/50 dark:ring-brand-700/30'
                : 'shadow-sm',
            )
          : 'bg-card border-theme-border',
      )}
    >
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <div
          className={clsx(
            'flex-shrink-0 rounded-xl flex items-center justify-center transition-colors',
            prominent ? 'w-14 h-14 landscape:w-12 landscape:h-12' : 'w-12 h-12',
            enabled ? 'icon-bg-brand' : 'bg-muted text-muted-foreground',
          )}
        >
          {icon}
        </div>
        <div className="text-start min-w-0">
          <p
            className={clsx(
              'font-bold',
              prominent ? 'text-base landscape:text-sm' : '',
              enabled ? 'text-brand-900 dark:text-brand-300' : 'text-foreground',
            )}
          >
            {title}
          </p>
          <p className="text-xs font-medium text-muted-foreground leading-relaxed">{description}</p>
        </div>
      </div>
      <Toggle enabled={enabled} onChange={onChange} aria-label={title} />
    </div>
  );
}
