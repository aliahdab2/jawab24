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
        <span className="text-sm sm:text-base font-semibold max-w-[55vw] sm:max-w-[300px] truncate">
          {selectedPage ? `· ${selectedPage.name}` : ''}
        </span>
        <ChevronDown className={clsx(
          'w-3.5 h-3.5 sm:w-4 sm:h-4 transition-transform flex-shrink-0 translate-y-[1px]',
          isOpen && 'rotate-180'
        )} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-[99] bg-black/30" onClick={() => setIsOpen(false)} />
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 pointer-events-none">
            <div className="bg-card border border-theme-border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden pointer-events-auto animate-in fade-in zoom-in-95 duration-150">
              <p className="px-4 pt-4 pb-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">
                {tc('allPages')}
              </p>
              {options.map((option, idx) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={clsx(
                    'w-full px-4 py-3.5 text-start text-sm flex items-center justify-between gap-2 transition-colors',
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
          </div>
        </>
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
