import React from 'react';
import clsx from 'clsx';
import { Card } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';

interface StatCardProps {
  nameKey: TranslationKey;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  color: 'brand' | 'emerald' | 'amber';
  index: number;
}

export function StatCard({ nameKey, value, icon: Icon, color, index }: StatCardProps) {
  const { t } = useTranslation();

  return (
    <Card
      hover
      className={clsx(
        "animate-slide-up relative overflow-hidden group border-none bg-white transition-all duration-300 hover:-translate-y-1",
        index === 2 ? "col-span-2 sm:col-span-1" : "col-span-1"
      )}
      style={{
        animationDelay: `${index * 0.1}s`,
        boxShadow: '0 10px 30px rgba(0,0,0,0.04)'
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

      <div className="relative z-10 px-4 py-4 sm:px-5 sm:py-5 flex items-center justify-between">
        <div>
          <p className="text-[26px] sm:text-[32px] font-bold text-surface-900 leading-none tracking-tight mb-1.5">
            {value}
          </p>
          <p className="text-[11px] sm:text-xs font-bold text-surface-500 uppercase tracking-widest truncate leading-tight opacity-70">
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
