import React from 'react';
import { Toggle } from '@/components/ui';

interface SimpleToggleProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function SimpleToggle({
  icon,
  title,
  description,
  enabled,
  onChange
}: SimpleToggleProps) {
  return (
    <div className={`flex items-center justify-between gap-4 p-4 rounded-2xl border transition-all duration-300 ${enabled ? 'bg-brand-50/30 dark:bg-brand-900/20 border-brand-100 dark:border-brand-800 shadow-sm' : 'bg-card border-theme-border'
      }`}>
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <div className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${enabled ? 'bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400' : 'bg-muted text-muted-foreground'
          }`}>
          {icon}
        </div>
        <div className="text-start min-w-0">
          <p className={`font-bold ${enabled ? 'text-brand-900 dark:text-brand-300' : 'text-foreground'}`}>{title}</p>
          <p className="text-xs font-medium text-muted-foreground leading-relaxed">{description}</p>
        </div>
      </div>
      <Toggle enabled={enabled} onChange={onChange} aria-label={title} />
    </div>
  );
}
