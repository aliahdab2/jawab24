import React from 'react';
import clsx from 'clsx';
import { Card } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';

interface StatCardProps {
  nameKey: TranslationKey;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  color: 'brand' | 'emerald' | 'amber' | 'violet' | 'red';
  index: number;
}

export function StatCard({ nameKey, value, icon: Icon, color, index, onClick, isActive }: StatCardProps & { onClick?: () => void; isActive?: boolean }) {
  const { t } = useTranslation();

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
      className={clsx(
        "animate-slide-up relative overflow-hidden group transition-all cursor-pointer",
        // Precise duration for premium feel
        "duration-[120ms] ease-out",
        isActive 
          ? clsx(
              "ring-2 ring-offset-2",
              color === 'brand' ? 'bg-brand-50/50 ring-brand-500 border-brand-200 shadow-[0_0_15px_rgba(59,130,246,0.15)]' :
              color === 'emerald' ? 'bg-emerald-50/50 ring-emerald-500 border-emerald-200 shadow-[0_0_15px_rgba(16,185,129,0.15)]' :
              color === 'amber' ? 'bg-amber-50/50 ring-amber-500 border-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.15)]' :
              color === 'violet' ? 'bg-violet-50/50 ring-violet-500 border-violet-200 shadow-[0_0_15px_rgba(139,92,246,0.15)]' :
              'bg-red-50/50 ring-red-500 border-red-200 shadow-[0_0_15px_rgba(239,68,68,0.15)]'
            )
          : "border-transparent bg-white shadow-sm hover:shadow-lg active:shadow-md",
        "border", // Always apply border class to prevent layout shift
        // Press feedback
        "active:scale-[0.98] active:duration-[80ms]",
        // Hover feedback (only if NOT active to avoid jitter)
        !isActive && "hover:scale-[1.015] hover:-translate-y-0.5",
        index === 2 ? "col-span-2 sm:col-span-1" : "col-span-1"
      )}
      style={{
        animationDelay: `${index * 0.1}s`,
        // Default shadow removed here as we use tailwind classes for consistency
      } as React.CSSProperties}
      padding="none"
    >
      {/* Subtle background decoration */}
      <div className={clsx(
        "absolute -end-4 -bottom-4 w-20 h-20 rounded-full opacity-[0.08] transition-all duration-700 group-hover:scale-125 group-hover:opacity-[0.15]",
        color === 'brand' ? 'bg-brand-500' :
          color === 'emerald' ? 'bg-emerald-500' :
            'bg-amber-500'
      )}></div>

      <div className="relative z-10 px-4 py-3 sm:px-5 sm:py-4 flex items-center justify-between">
        <div>
          <p className={clsx(
            "text-[26px] sm:text-[32px] font-bold leading-none tracking-tight mb-1.5",
            isActive ? "text-surface-900" : "text-surface-900"
          )}>
            {value}
          </p>
          <p className={clsx(
            "text-[11px] sm:text-xs font-bold uppercase tracking-widest truncate leading-tight",
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
          "w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shadow-lg transition-all duration-500 group-hover:rotate-6 group-hover:scale-110",
          color === 'brand' ? 'bg-brand-50 text-brand-600 shadow-brand-500/10' :
            color === 'emerald' ? 'bg-emerald-50 text-emerald-600 shadow-emerald-500/10' :
              'bg-amber-50 text-amber-600 shadow-amber-500/10'
        )}>
          <Icon className="w-6 h-6 sm:w-7 sm:h-7" />
        </div>
      </div>
    </Card>
  );
}
