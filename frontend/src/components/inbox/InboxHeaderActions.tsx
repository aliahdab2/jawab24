import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Download, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { isNativePlatform } from '@/lib/capacitor';
import type { Page } from '@jawab24/shared';

// ─── Page-aware title (inline page switcher in the heading) ─────

interface InboxTitleProps {
  title: string;
  activePages: Page[];
  pageId: string;
  onPageChange: (pageId: string) => void;
}

/**
 * Page title with inline page selector.
 * - 1 page: just "Comments" or "Messages"
 * - 2+ pages, all selected: "Comments" (no suffix)
 * - 2+ pages, one selected: "Comments · PageName ▼"
 * Tap the page name to open a dropdown to switch.
 */
export function InboxTitle({ title, activePages, pageId, onPageChange }: InboxTitleProps) {
  const tc = useTranslations('common');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedPage = activePages.find(p => p.id === pageId);
  const showSelector = activePages.length > 1;

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Position dropdown
  useEffect(() => {
    if (isOpen && dropdownRef.current && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const dropdownHeight = dropdownRef.current.offsetHeight;
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < dropdownHeight && rect.top > spaceBelow) {
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

  const handleSelect = (value: string) => {
    onPageChange(value);
    setIsOpen(false);
  };

  if (!showSelector) {
    return <>{title}</>;
  }

  const options = [
    { value: '', label: tc('allPages') },
    ...activePages.map(p => ({ value: p.id, label: p.name })),
  ];

  return (
    <span ref={containerRef} className="inline-flex items-baseline gap-2 relative">
      {title}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={tc('allPages')}
        className="inline-flex items-baseline gap-1 text-muted-foreground hover:text-foreground transition-colors group"
      >
        <span className="text-sm sm:text-base font-semibold max-w-[140px] sm:max-w-[200px] truncate">
          {selectedPage ? `· ${selectedPage.name}` : ''}
        </span>
        <ChevronDown className={clsx(
          'w-3.5 h-3.5 sm:w-4 sm:h-4 transition-transform flex-shrink-0 translate-y-[1px]',
          isOpen && 'rotate-180'
        )} />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute start-0 z-[100] min-w-[220px] bg-card border-2 border-brand-500/30 rounded-xl shadow-2xl shadow-black/30 dark:shadow-black/60 ring-1 ring-black/5 dark:ring-white/5 max-h-60 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {options.map((option, idx) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleSelect(option.value)}
              className={clsx(
                'w-full px-4 py-3 text-start text-sm flex items-center justify-between gap-2 transition-colors',
                option.value === pageId
                  ? 'status-brand font-semibold'
                  : 'text-foreground/80 hover:bg-muted',
                idx > 0 && 'border-t border-theme-border/50'
              )}
            >
              <span className="truncate">{option.label}</span>
              {option.value === pageId && (
                <Check className="w-4 h-4 text-brand-600 flex-shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// ─── Export button (renders in PageHeader action slot) ───────────

interface InboxExportButtonProps {
  onExport: () => void;
  exporting: boolean;
}

/**
 * Export CSV button for PageHeader action slot.
 * Hidden on native platforms (Capacitor).
 */
export function InboxExportButton({ onExport, exporting }: InboxExportButtonProps) {
  const tc = useTranslations('common');

  if (isNativePlatform()) return null;

  return (
    <button
      onClick={onExport}
      disabled={exporting}
      className="p-2 rounded-xl text-muted-foreground hover:text-foreground/70 hover:bg-muted transition-colors disabled:opacity-50"
      aria-label={tc('export')}
    >
      {exporting
        ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
        : <Download className="w-5 h-5" aria-hidden="true" />
      }
    </button>
  );
}
