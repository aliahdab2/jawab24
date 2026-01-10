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
    <div className="flex flex-col items-center justify-center py-4 sm:py-8 md:py-20 px-6 text-center animate-fade-in">
      <div className="relative mb-4 sm:mb-6 md:mb-8">
        <div className="absolute inset-0 bg-brand-500/20 rounded-full blur-[40px] animate-pulse"></div>
        <div className="relative w-14 h-14 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-2xl md:rounded-[2rem] bg-gradient-to-br from-surface-50 to-white shadow-xl shadow-surface-200/50 flex items-center justify-center border border-white/50 transition-transform hover:scale-105 duration-500 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-tr from-brand-50 to-transparent opacity-50"></div>
          <Icon className="w-5 h-5 sm:w-8 sm:h-8 md:w-10 md:h-10 text-brand-600 relative z-10" />
        </div>
      </div>
      <h3 className="text-lg sm:text-xl md:text-2xl font-display font-extrabold text-surface-900 mb-1 md:mb-3 tracking-tight">{title}</h3>
      <p className="text-xs sm:text-base md:text-lg font-medium text-surface-500 max-w-sm mb-4 sm:mb-8 md:mb-10 leading-relaxed px-4 sm:px-0">
        {description}
      </p>
      {action && (
        <div className="transition-transform hover:scale-105 active:scale-95 duration-300">
          {action}
        </div>
      )}
    </div>
  );
}
