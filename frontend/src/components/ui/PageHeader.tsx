import React from 'react';

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, action, className }: PageHeaderProps) {
  return (
    <div className={`mb-5 landscape:mb-3 sm:mb-8 lg:mb-10 animate-slide-up ${className || ''}`}>
      <div className="flex items-start justify-between gap-3 sm:gap-6">
        <div className="flex-1 min-w-0 text-start">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-display font-extrabold text-surface-900 tracking-tight">
            {title}
          </h1>
        </div>
        {action && (
          <div className="flex-shrink-0 flex items-center self-start">
            {action}
          </div>
        )}
      </div>
      {description && (
        <p className="text-sm sm:text-lg text-surface-500 mt-2 sm:mt-3 lg:mt-5 font-medium leading-relaxed line-clamp-2 sm:line-clamp-none text-start">
          {description}
        </p>
      )}
    </div>
  );
}
