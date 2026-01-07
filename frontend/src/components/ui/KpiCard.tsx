import React from 'react';
import { Card } from './Card';
import { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from '@/i18n';

/**
 * KPI Card Component - Global Design DNA
 * 
 * SPECIFICATIONS:
 * - Number: 28px-32px, font-bold, text-surface-900
 * - Label: 10px-12px, font-bold, text-surface-500, uppercase
 * - Icon: 24px-28px inside 48px-56px container
 * - Decoration: Subtle background circle relative to color
 * - Shadow: 0 10px 30px rgba(0,0,0,0.04)
 */

interface KpiCardProps {
    title: string;
    value: number | string;
    icon: LucideIcon;
    color?: 'brand' | 'emerald' | 'amber' | 'violet' | 'red';
    animationDelay?: string;
    className?: string;
}

export function KpiCard({
    title,
    value,
    icon: Icon,
    color = 'brand',
    animationDelay,
    className
}: KpiCardProps) {
    const { language } = useTranslation();
    return (
        <Card
            className={clsx(
                "animate-slide-up relative overflow-hidden group border-none bg-white transition-all duration-300 hover:-translate-y-1",
                className
            )}
            hover
            padding="none"
            style={{
                animationDelay,
                boxShadow: '0 10px 30px rgba(0,0,0,0.04)'
            }}
        >
            {/* Subtle background decoration */}
            <div className={clsx(
                "absolute -end-4 -bottom-4 w-20 h-20 rounded-full opacity-[0.08] transition-all duration-700 group-hover:scale-125 group-hover:opacity-[0.15]",
                color === 'brand' ? 'bg-brand-500' :
                    color === 'emerald' ? 'bg-emerald-500' :
                        color === 'amber' ? 'bg-amber-500' :
                            color === 'violet' ? 'bg-violet-500' :
                                'bg-red-500'
            )}></div>

            <div className="relative z-10 px-4 py-4 sm:px-5 sm:py-5 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                    <p className="text-[26px] sm:text-[32px] font-bold text-surface-900 leading-none tracking-tight mb-1.5 truncate">
                        {typeof value === 'number' ? value.toLocaleString() : value}
                    </p>
                    <p className={clsx(
                        "text-[10px] sm:text-xs font-bold text-surface-500 truncate leading-tight opacity-70",
                        language !== 'ar' && "uppercase tracking-widest"
                    )}>
                        {title}
                    </p>
                </div>

                <div className={clsx(
                    "w-11 h-11 sm:w-13 sm:h-13 rounded-2xl flex items-center justify-center shadow-lg transition-all duration-500 group-hover:rotate-6 group-hover:scale-110 flex-shrink-0",
                    color === 'brand' ? 'bg-brand-50 text-brand-600 shadow-brand-500/10' :
                        color === 'emerald' ? 'bg-emerald-50 text-emerald-600 shadow-emerald-500/10' :
                            color === 'amber' ? 'bg-amber-50 text-amber-600 shadow-amber-500/10' :
                                color === 'violet' ? 'bg-violet-50 text-violet-600 shadow-violet-500/10' :
                                    'bg-red-50 text-red-600 shadow-red-500/10'
                )}>
                    <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
            </div>
        </Card>
    );
}
