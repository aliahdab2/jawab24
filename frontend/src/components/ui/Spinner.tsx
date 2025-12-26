import clsx from 'clsx';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export function Spinner({ size = 'md', className }: SpinnerProps) {
  const sizeClasses = {
    sm: 'w-5 h-5 border-2',
    md: 'w-10 h-10 border-3',
    lg: 'w-16 h-16 border-4',
    xl: 'w-24 h-24 border-5',
  };

  return (
    <div className={clsx('relative flex items-center justify-center', className)}>
      {/* Outer ring */}
      <div 
        className={clsx(
          'absolute border-surface-100 rounded-full',
          sizeClasses[size]
        )}
      />
      {/* Spinning ring */}
      <div 
        className={clsx(
          'border-transparent border-t-brand-600 rounded-full animate-spin',
          sizeClasses[size]
        )}
      />
    </div>
  );
}

export function PageSpinner() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-6 animate-fade-in">
      <div className="relative">
        <div className="absolute inset-0 bg-brand-500/20 rounded-full blur-3xl animate-pulse"></div>
        <Spinner size="lg" />
      </div>
      <p className="text-sm font-bold text-surface-400 uppercase tracking-[0.2em] animate-pulse">
        Loading Jawab24
      </p>
    </div>
  );
}
