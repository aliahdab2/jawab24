import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import clsx from 'clsx';

interface SelectOption {
  value: string;
  label: string;
  badge?: string;
  /** Badge tone. Defaults to the brand (teal) look; 'muted' for neutral states like "paused". */
  badgeTone?: 'brand' | 'muted';
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  className?: string;
  disabled?: boolean;
  /** Compact mode for inline filter bars — smaller padding, pill shape, muted background */
  compact?: boolean;
}

function LabelWithBadge({ label, badge, badgeTone = 'brand', truncate = false }: { label: string; badge?: string; badgeTone?: 'brand' | 'muted'; truncate?: boolean }) {
  return (
    <span className="flex-1 flex items-center gap-2 min-w-0">
      {/* Default selects wrap so the full option text is always readable (long
          labels like "رد على التعليق + رسالة خاصة" were clipped next to their
          badge on narrow screens). Compact filter pills keep single-line truncation. */}
      <span className={truncate ? 'truncate' : 'min-w-0 break-words'}>{label}</span>
      {badge && (
        <span className={clsx(
          'text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0',
          badgeTone === 'muted' ? 'bg-muted text-foreground/70' : 'status-brand',
        )}>
          {badge}
        </span>
      )}
    </span>
  );
}

/**
 * Custom Select component that works correctly on iOS
 * Native selects have issues inside modals on iOS Safari
 */
export function Select({ value, onChange, options, placeholder, label, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, className, disabled = false, compact = false }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Position dropdown above or below based on available space
  useEffect(() => {
    if (isOpen && dropdownRef.current && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const dropdownHeight = dropdownRef.current.offsetHeight;
      const spaceBelow = window.innerHeight - containerRect.bottom;
      const spaceAbove = containerRect.top;

      // If not enough space below and more space above, position above
      if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
        dropdownRef.current.style.bottom = '100%';
        dropdownRef.current.style.top = 'auto';
        dropdownRef.current.style.marginBottom = '4px';
        dropdownRef.current.style.marginTop = '0';
      } else {
        dropdownRef.current.style.top = '100%';
        dropdownRef.current.style.bottom = 'auto';
        dropdownRef.current.style.marginTop = '4px';
        dropdownRef.current.style.marginBottom = '0';
      }
    }
  }, [isOpen]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      {label && <label className="label">{label}</label>}
      
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={clsx(
          compact
            ? "w-full px-3 py-2 rounded-full bg-muted/50 border-none text-sm text-start flex items-center justify-between gap-2 transition-all focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            : "input !py-2.5 sm:!py-3 w-full text-start flex items-center justify-between gap-2",
          !selectedOption && "text-muted-foreground",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
      >
        <LabelWithBadge
          label={selectedOption ? selectedOption.label : (placeholder ?? '')}
          badge={selectedOption?.badge}
          badgeTone={selectedOption?.badgeTone}
          truncate={compact}
        />
        <ChevronDown 
          className={clsx(
            "w-4 h-4 text-surface-500 transition-transform flex-shrink-0",
            isOpen && "rotate-180"
          )} 
        />
      </button>

      {/* Dropdown */}
      {isOpen && !disabled && (
        <div
          ref={dropdownRef}
          className={clsx(
            "absolute z-[100] rounded-xl max-h-60 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-150",
            compact
              // Anchor to the trigger's start edge and grow inward, capped to the viewport,
              // so a trigger near the screen edge never pushes the menu off-screen.
              ? "start-0 min-w-[200px] max-w-[calc(100vw-2rem)] bg-card border-2 border-brand-500/30 shadow-2xl shadow-black/30 dark:shadow-black/60 ring-1 ring-black/5 dark:ring-white/5"
              : "inset-x-0 bg-card border border-theme-border shadow-xl"
          )}
        >
          {options.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted-foreground text-center">
              No options available
            </div>
          ) : (
            options.map((option, idx) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={clsx(
                  "w-full px-4 py-3 text-start text-sm flex items-center justify-between gap-2 transition-colors",
                  option.value === value
                    ? "status-brand font-semibold"
                    : "text-foreground/80 hover:bg-muted",
                  idx > 0 && "border-t border-theme-border/50"
                )}
              >
                <LabelWithBadge label={option.label} badge={option.badge} badgeTone={option.badgeTone} truncate={compact} />
                {option.value === value && (
                  <Check className="w-4 h-4 text-brand-600 flex-shrink-0" />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
