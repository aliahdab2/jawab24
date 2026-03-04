import React from 'react';
import { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

type EmptyStateVariant = 'empty' | 'success' | 'search';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  variant?: EmptyStateVariant;
  iconColorClass?: string;
  iconBgClass?: string;
}

const variantStyles: Record<EmptyStateVariant, { iconBg: string; iconColor: string }> = {
  empty: {
    iconBg: 'icon-bg-brand-light',
    iconColor: '',
  },
  success: {
    iconBg: 'icon-bg-emerald-light',
    iconColor: '',
  },
  search: {
    iconBg: 'bg-muted',
    iconColor: 'text-muted-foreground',
  },
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  variant = 'empty',
  iconColorClass,
  iconBgClass,
}: EmptyStateProps) {
  const styles = variantStyles[variant];
  const bgClass = iconBgClass || styles.iconBg;
  const colorClass = iconColorClass || styles.iconColor;

  return (
    <div
      role="region"
      aria-label={title}
      className="flex flex-col items-center justify-center py-8 sm:py-12 md:py-16 px-5 sm:px-6 text-center animate-fade-in"
    >
      <div className={clsx(
        'w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center mb-5 sm:mb-6',
        'animate-empty-state-icon',
        bgClass,
      )}>
        <Icon className={clsx('w-7 h-7 sm:w-9 sm:h-9', colorClass)} aria-hidden="true" />
      </div>

      <h2 className="text-xl sm:text-2xl font-display font-bold text-foreground mb-2 sm:mb-3 tracking-tight">
        {title}
      </h2>

      <p className="text-sm sm:text-base text-muted-foreground max-w-md mb-6 sm:mb-8 leading-relaxed">
        {description}
      </p>

      {action && (
        <div className="transition-transform hover:scale-[1.02] active:scale-95 duration-200">
          {action}
        </div>
      )}

      {secondaryAction && (
        <div className="mt-3 sm:mt-4 text-sm text-muted-foreground">
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
