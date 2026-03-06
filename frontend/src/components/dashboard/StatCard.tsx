import React from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';

interface StatCardProps {
  nameKey: TranslationKey;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  color: 'brand' | 'emerald' | 'amber' | 'violet' | 'red';
  index: number;
  href?: string;
  onClick?: () => void;
  isActive?: boolean;
}

export function StatCard({ nameKey, value, icon: Icon, color, index, onClick, href, isActive }: StatCardProps) {
  const { t } = useTranslation();

  const iconColorClasses =
    color === 'brand' ? 'icon-bg-brand-light' :
    color === 'emerald' ? 'icon-bg-emerald-light' :
    color === 'amber' ? 'icon-bg-amber-light' :
    color === 'violet' ? 'icon-bg-violet-light' :
    'icon-bg-red-light';

  const labelColorClasses = isActive
    ? (color === 'brand' ? 'text-brand-700' :
       color === 'emerald' ? 'text-emerald-700 dark:text-emerald-400' :
       color === 'amber' ? 'text-amber-700 dark:text-amber-400' :
       color === 'violet' ? 'text-violet-700 dark:text-violet-400' : 'text-red-700 dark:text-red-400')
    : "text-muted-foreground opacity-70";

  const content = (
    <div className="relative z-10 px-3 py-3 sm:px-5 sm:py-4 pointer-events-none">
      {/* Desktop/tablet: side-by-side layout */}
      <div className="hidden sm:flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[32px] font-bold leading-none tracking-tight text-foreground mb-1.5">
            {value}
          </p>
          <p className={clsx(
            "text-xs font-bold uppercase tracking-widest line-clamp-2 leading-tight",
            labelColorClasses
          )}>
            {t(nameKey)}
          </p>
        </div>
        <div className={clsx(
          "w-14 h-14 rounded-2xl flex-shrink-0 flex items-center justify-center shadow-lg transition-all duration-500 group-hover:rotate-6 group-hover:scale-110",
          iconColorClasses
        )}>
          <Icon className="w-7 h-7" />
        </div>
      </div>

      {/* Mobile: stacked layout — icon on top, then value, then label (all full width) */}
      <div className="sm:hidden">
        <div className={clsx(
          "w-8 h-8 rounded-lg flex items-center justify-center shadow-sm mb-2",
          iconColorClasses
        )}>
          <Icon className="w-4 h-4" />
        </div>
        <p className="text-xl font-bold leading-none tracking-tight text-foreground mb-1">
          {value}
        </p>
        <p className={clsx(
          "text-[10px] font-bold uppercase tracking-wider line-clamp-2 leading-tight",
          labelColorClasses
        )}>
          {t(nameKey)}
        </p>
      </div>
    </div>
  );

  const cardClasses = clsx(
    "animate-slide-up relative overflow-hidden group transition-all",
    // Base styles
    "border duration-[120ms] ease-out",
    // Interactive styles
    (onClick || href) && "cursor-pointer hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98] active:duration-[80ms] focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-brand-500",
    // Active state
    isActive 
      ? clsx(
          "ring-2 ring-offset-2",
          color === 'brand' ? 'bg-brand-50/50 ring-brand-500 border-brand-200 shadow-[0_0_15px_rgba(59,130,246,0.15)]' :
          color === 'emerald' ? 'bg-emerald-50/50 dark:bg-emerald-900/20 ring-emerald-500 border-emerald-200 dark:border-emerald-700 shadow-[0_0_15px_rgba(16,185,129,0.15)]' :
          color === 'amber' ? 'bg-amber-50/50 dark:bg-amber-900/20 ring-amber-500 border-amber-200 dark:border-amber-700 shadow-[0_0_15px_rgba(245,158,11,0.15)]' :
          color === 'violet' ? 'bg-violet-50/50 dark:bg-violet-900/20 ring-violet-500 border-violet-200 dark:border-violet-700 shadow-[0_0_15px_rgba(139,92,246,0.15)]' :
          'bg-red-50/50 dark:bg-red-900/20 ring-red-500 border-red-200 dark:border-red-700 shadow-[0_0_15px_rgba(239,68,68,0.15)]'
        )
      : clsx(
          "border-transparent bg-card shadow-sm",
          // Soft hover background tint
          color === 'brand' && "hover:bg-brand-50/30",
          color === 'emerald' && "hover:bg-emerald-50/30 dark:hover:bg-emerald-900/20",
          color === 'amber' && "hover:bg-amber-50/30 dark:hover:bg-amber-900/20",
          color === 'violet' && "hover:bg-violet-50/30 dark:hover:bg-violet-900/20",
          color === 'red' && "hover:bg-red-50/30 dark:hover:bg-red-900/20"
        ),
    // Grid spanning
    index === 2 ? "col-span-2 sm:col-span-1" : "col-span-1"
  );

  const cardStyle = {
    animationDelay: `${index * 0.1}s`,
  } as React.CSSProperties;

  // Background decoration simplified
  const backgroundDecoration = (
    <div className={clsx(
      "absolute -end-4 -bottom-4 w-20 h-20 rounded-full opacity-[0.08] transition-all duration-700 group-hover:scale-125 group-hover:opacity-[0.15]",
      color === 'brand' ? 'bg-brand-500' :
      color === 'emerald' ? 'bg-emerald-500' :
      color === 'amber' ? 'bg-amber-500' :
      color === 'violet' ? 'bg-violet-500' :
      'bg-red-500'
    )}></div>
  );

  if (href) {
    return (
      <Link href={href} className="block outline-none" tabIndex={-1}>
        <Card className={cardClasses} style={cardStyle} padding="none">
          {backgroundDecoration}
          {content}
          <div className="absolute bottom-2 end-2 opacity-0 group-hover:opacity-50 transition-opacity pointer-events-none">
            <ChevronRight className="w-3.5 h-3.5 text-icon-muted rtl:rotate-180" />
          </div>
        </Card>
      </Link>
    );
  }

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={cardClasses}
      style={cardStyle}
      padding="none"
    >
      {backgroundDecoration}
      {content}
    </Card>
  );
}
