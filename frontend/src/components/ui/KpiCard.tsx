import React from 'react';
import { Card } from './Card';
import { LucideIcon } from 'lucide-react';

/**
 * KPI Card Component - Global Design DNA
 * 
 * LOCKED SPECIFICATIONS (DO NOT MODIFY WITHOUT SYSTEM-WIDE REVIEW):
 * - Number: 28px, font-weight 600, text-surface-900
 * - Label: 12px (text-xs), font-weight 500, text-surface-500 (~70% opacity)
 * - Icon: 16px (w-4 h-4), 40% opacity, supporting role only
 * - Shadow: 0 10px 30px rgba(0,0,0,0.05)
 * - Padding: px-5 py-3.5
 * - Hover: lift 2px (-translate-y-0.5), 150ms transition
 * - Border radius: inherited from Card component
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
    const colorMap = {
        brand: 'text-brand-500',
        emerald: 'text-emerald-500',
        amber: 'text-amber-500',
        violet: 'text-violet-500',
        red: 'text-red-500'
    };

    return (
        <Card
            className="border-none hover:shadow-lg transition-all duration-150 hover:-translate-y-0.5 animate-slide-up"
            padding="none"
            style={{
                boxShadow: '0 10px 30px rgba(0,0,0,0.05)',
                animationDelay
            }}
        >
            <div className="px-5 py-3.5">
                {/* Number-first hierarchy */}
                <div className="flex items-baseline justify-between gap-2 mb-1">
                    {/* Primary: Number */}
                    <p className="text-[28px] font-semibold text-surface-900 leading-none tracking-tight">
                        {typeof value === 'number' ? value.toLocaleString() : value}
                    </p>

                    {/* Supporting: Icon (40% opacity, 16px) */}
                    <div className={`opacity-40 transition-opacity hover:opacity-60 ${colorMap[color]}`}>
                        <Icon className="w-4 h-4" />
                    </div>
                </div>

                {/* Secondary: Label */}
                <p className="text-xs font-medium text-surface-500 truncate leading-tight">
                    {title}
                </p>
            </div>
        </Card>
    );
}
