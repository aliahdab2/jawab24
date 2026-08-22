import React from 'react';
import clsx from 'clsx';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'brand' | 'violet' | 'orange' | 'default';
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  onClick?: () => void;
}

export function Badge({ children, variant = 'default', size = 'md', className, onClick }: BadgeProps) {
  // One entry per status-* class in globals.css, named after the class it maps
  // to. `info` used to map to status-BRAND, which left status-info (blue)
  // unreachable through this component and made the prop name a lie; violet and
  // orange had no entry at all, so those two states could only be reached by
  // writing the CSS class by hand.
  const variantClasses = {
    success: 'status-success border',
    warning: 'status-warning border',
    error: 'status-error border',
    info: 'status-info border',
    brand: 'status-brand border',
    violet: 'status-violet border',
    orange: 'status-orange border',
    default: 'status-neutral border',
  };

  const sizeClasses = {
    // Compact, normal-case chip — fits in tight spots (e.g. inline beside other
    // text on a narrow mobile tile) where the uppercase + tracking-wider sizes
    // would be too wide and wrap.
    xs: 'text-[10px] px-1.5 py-0.5 font-semibold leading-tight whitespace-nowrap',
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

