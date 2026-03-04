import React from 'react';
import clsx from 'clsx';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

/**
 * FilterButtons - Responsive filter button group
 * 
 * On mobile: 2x2 grid so all options are visible without scrolling
 * On larger screens: horizontal row
 */

interface FilterOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  badge?: number;
  highlight?: boolean;
}

interface FilterButtonsProps<T extends string> {
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function FilterButtons<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: FilterButtonsProps<T>) {
  return (
    <div className={clsx(
      // Mobile: 2x2 grid for 4 items, or flex-wrap for other counts
      'grid grid-cols-2 gap-2',
      // Larger screens: horizontal row
      'sm:flex sm:flex-row sm:gap-2',
      className
    )}>
      {options.map((option) => {
        const isActive = value === option.value;
        const hasAlert = option.highlight && option.badge && option.badge > 0;
        
        return (
          <Button
            key={option.value}
            variant={isActive ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => onChange(option.value)}
            className={clsx(
              'rounded-full transition-all duration-300',
              // Mobile: full width in grid cell
              'w-full',
              // Larger screens: auto width
              'sm:w-auto sm:px-6',
              isActive && 'shadow-md shadow-brand-100',
              hasAlert && 'ring-2 ring-red-200'
            )}
          >
            <div className="flex items-center justify-center gap-1.5 sm:gap-2">
              {option.icon}
              <span className="text-xs sm:text-sm truncate">{option.label}</span>
              {option.badge !== undefined && option.badge > 0 && (
                <span className={clsx(
                  'text-[10px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5 flex-shrink-0',
                  option.highlight 
                    ? 'bg-red-500 text-white' 
                    : isActive 
                      ? 'bg-white/20 text-white' 
                      : 'bg-muted text-muted-foreground'
                )}>
                  {option.badge}
                </span>
              )}
            </div>
          </Button>
        );
      })}
    </div>
  );
}

// Pre-configured for Comments page
interface CommentsFilterProps {
  filter: 'all' | 'replied' | 'pending' | 'needs_attention';
  onChange: (filter: 'all' | 'replied' | 'pending' | 'needs_attention') => void;
  needsAttentionCount?: number;
  labels: {
    all: string;
    replied: string;
    pending: string;
    needsAttention: string;
  };
}

export function CommentsFilterButtons({
  filter,
  onChange,
  needsAttentionCount = 0,
  labels,
}: CommentsFilterProps) {
  const options: FilterOption<'all' | 'replied' | 'pending' | 'needs_attention'>[] = [
    { value: 'all', label: labels.all },
    { value: 'replied', label: labels.replied },
    { value: 'pending', label: labels.pending },
    { 
      value: 'needs_attention', 
      label: labels.needsAttention,
      icon: <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />,
      badge: needsAttentionCount,
      highlight: true,
    },
  ];

  return <FilterButtons options={options} value={filter} onChange={onChange} />;
}

// Pre-configured for Messages page
interface MessagesFilterProps {
  filter: 'all' | 'incoming' | 'outgoing' | 'needs_attention';
  onChange: (filter: 'all' | 'incoming' | 'outgoing' | 'needs_attention') => void;
  needsAttentionCount?: number;
  labels: {
    all: string;
    incoming: string;
    outgoing: string;
    needsAttention: string;
  };
}

export function MessagesFilterButtons({
  filter,
  onChange,
  needsAttentionCount = 0,
  labels,
}: MessagesFilterProps) {
  const options: FilterOption<'all' | 'incoming' | 'outgoing' | 'needs_attention'>[] = [
    { value: 'all', label: labels.all },
    { value: 'incoming', label: labels.incoming },
    { value: 'outgoing', label: labels.outgoing },
    { 
      value: 'needs_attention', 
      label: labels.needsAttention,
      icon: <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />,
      badge: needsAttentionCount,
      highlight: true,
    },
  ];

  return <FilterButtons options={options} value={filter} onChange={onChange} />;
}

export default FilterButtons;
