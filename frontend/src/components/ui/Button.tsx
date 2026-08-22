import React, { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'accent' | 'ghost' | 'danger' | 'warning';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({ 
  children, 
  variant = 'primary', 
  size = 'md',
  loading = false,
  icon,
  className,
  disabled,
  ...props 
}: ButtonProps) {
  const variantClasses = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    accent: 'btn-accent',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
    warning: 'btn-warning',
  };

  const sizeClasses = {
    sm: 'text-xs px-4 py-2 rounded-xl',
    md: 'text-sm px-6 py-3 rounded-2xl',
    lg: 'text-base px-8 py-4 rounded-2xl',
  };

  return (
    <button
      className={clsx(
        variantClasses[variant],
        sizeClasses[size],
        'relative overflow-hidden group',
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      <div className={clsx(
        "flex items-center justify-center gap-2 transition-all duration-300",
        loading ? "opacity-0" : "opacity-100"
      )}>
        {icon && <span className="transition-transform group-hover:scale-110 group-hover:rotate-3">{icon}</span>}
        <span className="font-bold tracking-tight">{children}</span>
      </div>
      
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      )}
      
      {/* Subtle shine effect on hover */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer pointer-events-none"></div>
    </button>
  );
}

