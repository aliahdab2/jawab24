import React from 'react';
import clsx from 'clsx';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'default';
  size?: 'sm' | 'md';
  className?: string;
  onClick?: () => void;
}

export function Badge({ children, variant = 'default', size = 'md', className, onClick }: BadgeProps) {
  const variantClasses = {
    success: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
    warning: 'bg-amber-50 text-amber-700 border border-amber-100',
    error: 'bg-red-50 text-red-700 border border-red-100',
    info: 'bg-brand-50 text-brand-700 border border-brand-100',
    default: 'bg-surface-50 text-surface-600 border border-surface-200',
  };

  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider',
    md: 'text-xs px-3 py-1 font-bold uppercase tracking-wider',
  };

  return (
    <span 
      onClick={onClick}
      className={clsx(
        'inline-flex items-center rounded-lg shadow-sm transition-all',
        variantClasses[variant], 
        sizeClasses[size],
        onClick && 'cursor-pointer hover:opacity-80 active:scale-95',
        className
      )}
    >
      {children}
    </span>
  );
}

