import React, { CSSProperties, MouseEventHandler } from 'react';
import clsx from 'clsx';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLDivElement>;
}

export function Card({ children, className, hover = false, padding = 'md', style, onClick }: CardProps) {
  const paddingClasses = {
    none: '',
    sm: 'p-5 sm:p-6',
    md: 'p-6 sm:p-8',
    lg: 'p-8 sm:p-12',
  };

  return (
    <div
      className={clsx(
        hover ? 'card-hover' : 'card',
        paddingClasses[padding],
        // Ensure overflow is visible by default to prevent clipping of shadows, rings, and focus states
        // Only override with overflow-hidden if explicitly needed via className
        !className?.includes('overflow-') && 'overflow-visible',
        onClick && 'cursor-pointer active:scale-[0.98] transition-transform duration-300',
        className
      )}
      style={style}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function CardHeader({ title, description, action }: CardHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8">
      <div className="text-start">
        <h3 className="text-xl font-bold text-surface-900 tracking-tight">{title}</h3>
        {description && (
          <p className="text-sm font-medium text-surface-500 mt-1 leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

