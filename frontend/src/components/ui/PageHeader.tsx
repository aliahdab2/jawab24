import React from 'react';

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 mb-6 sm:mb-12 animate-slide-up">
      <div className="flex-1 text-start">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-display font-extrabold text-surface-900 tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm sm:text-lg text-surface-500 mt-1 sm:mt-2 font-medium leading-relaxed line-clamp-2 sm:line-clamp-none">
            {description}
          </p>
        )}
      </div>
      {action && (
        <div className="flex-shrink-0 flex items-center gap-3">
          {action}
        </div>
      )}
    </div>
  );
}

