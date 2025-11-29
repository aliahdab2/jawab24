import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-8">
      <div className="flex-1 text-start">
        <h1 className="text-2xl lg:text-3xl font-display font-bold text-surface-900">
          {title}
        </h1>
        {description && (
          <p className="text-surface-500 mt-1">
            {description}
          </p>
        )}
      </div>
      {action && (
        <div className="flex-shrink-0">
          {action}
        </div>
      )}
    </div>
  );
}

