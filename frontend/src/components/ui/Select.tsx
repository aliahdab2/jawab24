import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import clsx from 'clsx';

interface SelectOption {
  value: string;
  label: string;
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
}

/**
 * Custom Select component that works correctly on iOS
 * Native selects have issues inside modals on iOS Safari
 */
export function Select({ value, onChange, options, placeholder, label, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, className, disabled = false }: SelectProps) {
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
          "input !py-2.5 sm:!py-3 w-full text-start flex items-center justify-between gap-2",
          !selectedOption && "text-surface-400",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
      >
        <span className="truncate flex-1">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
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
          className="absolute inset-x-0 z-[100] bg-card rounded-xl border border-theme-border shadow-xl max-h-60 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {options.length === 0 ? (
            <div className="px-4 py-3 text-sm text-surface-400 text-center">
              No options available
            </div>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={clsx(
                  "w-full px-4 py-3 text-start text-sm flex items-center justify-between gap-2 transition-colors",
                  option.value === value
                    ? "status-brand font-semibold"
                    : "text-foreground/80 hover:bg-muted"
                )}
              >
                <span className="truncate">{option.label}</span>
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
