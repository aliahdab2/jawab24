import React from 'react';
import clsx from 'clsx';
import Link from 'next/link';
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

  const content = (
    <div className="relative z-10 px-3 py-3 sm:px-5 sm:py-4 flex items-center justify-between gap-2 pointer-events-none">
      <div className="min-w-0">
        <p className={clsx(
          "text-[22px] sm:text-[32px] font-bold leading-none tracking-tight mb-1.5",
          isActive ? "text-surface-900" : "text-surface-900"
        )}>
          {value}
        </p>
        <p className={clsx(
          "text-[11px] sm:text-xs font-bold uppercase tracking-widest line-clamp-2 leading-tight",
          isActive 
              ? (color === 'brand' ? 'text-brand-700' : 
                 color === 'emerald' ? 'text-emerald-700' : 
                 color === 'amber' ? 'text-amber-700' : 
                 color === 'violet' ? 'text-violet-700' : 'text-red-700')
              : "text-surface-500 opacity-70"
        )}>
          {t(nameKey)}
        </p>
      </div>

      <div className={clsx(
        "w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex-shrink-0 flex items-center justify-center shadow-lg transition-all duration-500 group-hover:rotate-6 group-hover:scale-110",
        color === 'brand' ? 'bg-brand-50 text-brand-600 shadow-brand-500/10' :
          color === 'emerald' ? 'bg-emerald-50 text-emerald-600 shadow-emerald-500/10' :
          color === 'amber' ? 'bg-amber-50 text-amber-600 shadow-amber-500/10' :
          color === 'violet' ? 'bg-violet-50 text-violet-600 shadow-violet-500/10' :
          'bg-red-50 text-red-600 shadow-red-500/10'
      )}>
        <Icon className="w-5 h-5 sm:w-7 sm:h-7" />
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
          color === 'emerald' ? 'bg-emerald-50/50 ring-emerald-500 border-emerald-200 shadow-[0_0_15px_rgba(16,185,129,0.15)]' :
          color === 'amber' ? 'bg-amber-50/50 ring-amber-500 border-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.15)]' :
          color === 'violet' ? 'bg-violet-50/50 ring-violet-500 border-violet-200 shadow-[0_0_15px_rgba(139,92,246,0.15)]' :
          'bg-red-50/50 ring-red-500 border-red-200 shadow-[0_0_15px_rgba(239,68,68,0.15)]'
        )
      : clsx(
          "border-transparent bg-white shadow-sm",
          // Soft hover background tint
          color === 'brand' && "hover:bg-brand-50/30",
          color === 'emerald' && "hover:bg-emerald-50/30",
          color === 'amber' && "hover:bg-amber-50/30",
          color === 'violet' && "hover:bg-violet-50/30",
          color === 'red' && "hover:bg-red-50/30"
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
