import React from 'react';
import { Card } from './Card';
import { LucideIcon } from 'lucide-react';

/**
 * KPI Card Component - Global Design DNA
 * 
 * SPECIFICATIONS:
 * - Number: 30px, font-bold, text-surface-900
 * - Label: 12px (text-xs), font-medium, text-surface-500
 * - Icon: 24px (w-6 h-6) inside 48px (w-12 h-12) container
 * - Icon Container: Colored bg, colored shadow, rounded-2xl
 * - Shadow: 0 10px 30px rgba(0,0,0,0.05)
 * - Padding: px-5 py-4
 * - Hover: lift 2px (-translate-y-0.5), scale icon container
 */

interface KpiCardProps {
    /** Display label for the KPI */
    title: string;
    /** Numeric value to display */
    value: number | string;
    /** Lucide icon component */
    icon: LucideIcon;
    /** Color theme: brand, emerald, amber, violet, red */
    color?: 'brand' | 'emerald' | 'amber' | 'violet' | 'red';
    /** Optional animation delay for staggered entrance */
    animationDelay?: string;
}

export function KpiCard({
    title,
    value,
    icon: Icon,
    color = 'brand',
    animationDelay
}: KpiCardProps) {
    const containerClassMap = {
        brand: 'bg-brand-50 text-brand-600 shadow-brand-500/20',
        emerald: 'bg-emerald-50 text-emerald-600 shadow-emerald-500/20',
        amber: 'bg-amber-50 text-amber-600 shadow-amber-500/20',
        violet: 'bg-violet-50 text-violet-600 shadow-violet-500/20',
        red: 'bg-red-50 text-red-600 shadow-red-500/20'
    };

    return (
        <Card
            className="border-none hover:shadow-lg transition-all duration-150 hover:-translate-y-0.5 animate-slide-up group"
            padding="none"
            style={{
                boxShadow: '0 10px 30px rgba(0,0,0,0.05)',
                animationDelay
            }}
        >
            <div className="px-5 py-4 flex items-center justify-between">
                <div>
                    <p className="text-[30px] font-bold text-surface-900 leading-none tracking-tight mb-1">
                        {typeof value === 'number' ? value.toLocaleString() : value}
                    </p>
                    <p className="text-xs font-medium text-surface-500 truncate leading-tight">
                        {title}
                    </p>
                </div>

                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-110 group-hover:rotate-3 ${containerClassMap[color]}`}>
                    <Icon className="w-6 h-6" />
                </div>
            </div>
        </Card>
    );
}
