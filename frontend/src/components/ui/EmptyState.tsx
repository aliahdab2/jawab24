import React from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-8 md:py-20 px-6 text-center animate-fade-in">
      <div className="relative mb-6 md:mb-8">
        <div className="absolute inset-0 bg-brand-500/10 rounded-full blur-2xl animate-pulse"></div>
        <div className="relative w-20 h-20 md:w-24 md:h-24 rounded-2xl md:rounded-[2rem] bg-gradient-to-br from-surface-50 to-white shadow-xl shadow-surface-200/50 flex items-center justify-center border border-surface-100 transition-transform hover:rotate-6 duration-500">
          <Icon className="w-8 h-8 md:w-10 md:h-10 text-brand-500" />
        </div>
      </div>
      <h3 className="text-xl md:text-2xl font-display font-bold text-surface-900 mb-2 md:mb-3 tracking-tight">{title}</h3>
      <p className="text-base md:text-lg font-medium text-surface-500 max-w-sm mb-8 md:mb-10 leading-relaxed">{description}</p>
      {action && (
        <div className="transition-transform hover:scale-105 active:scale-95 duration-300">
          {action}
        </div>
      )}
    </div>
  );
}
