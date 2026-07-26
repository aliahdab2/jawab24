import React, { useCallback, useState, useRef } from 'react';
import { ChevronDown, Check, Download, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { isNativePlatform } from '@/lib/capacitor';
import { useClickOutside } from '@/hooks';
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

  useClickOutside(containerRef, useCallback(() => setIsOpen(false), []), isOpen);


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
    // `flex` (not inline-flex) + min-w-0 so the row can actually distribute width:
    // an inline-flex sizes to its content and overflows its parent instead, which
    // is how a long page name ended up UNDER the header actions on 360px.
    <span ref={containerRef} className="flex items-center gap-2 relative min-w-0 w-full">
      {/* «التعليقات · Nourva» — title AND name, always, one stable structure.
          Hiding the title entirely (tried first) made the band look bare and
          unlabelled whenever the name was short — the owner flagged it twice,
          against the bottom nav's label being "enough". Conditional visibility
          (show title only when the name fits) was rejected with the character-
          threshold idea: any cutoff is wrong across viewport × page × locale ×
          font-scale, and the header changing shape per selected page reads as
          jitter. So both are always present; the NAME absorbs the squeeze
          (truncates) because the title is short, fixed, and names the screen,
          while the full page name is one tap away in the picker.
          Mobile gets its own compact rendering of the title (text-sm, muted —
          the NAME keeps the identity ink); sm+ keeps the h1's inherited large
          type exactly as before. Two spans because the mobile one must NOT
          inherit the h1's font scale; aria-hidden on it so the accessible
          heading doesn't say the title twice. */}
      <span className="sm:hidden flex-shrink-0 text-sm font-semibold text-muted-foreground" aria-hidden="true">{title}</span>
      <span className="sm:hidden flex-shrink-0 text-subtle text-sm" aria-hidden="true">·</span>
      <span className="sr-only sm:not-sr-only flex-shrink-0">{title}</span>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={tc('allPages')}
        // min-h-9 matches the header ACTIONS band (36px — a size="sm" button plus
        // its container's inset). The row is top-aligned, so a 20px-tall selector
        // against that band put the page name 8px ABOVE the button's centre —
        // visibly floating, which is what the owner spotted. Matching the height
        // aligns the centres exactly, without forcing `items-center` on every
        // PageHeader in the app. Also lifts the picker's tap target from 20px to
        // 36px, closer to the 44px guidance.
        // Mobile: the name IS the header (the h1 title is sr-only there), so it
        // takes title-grade ink — muted gray next to a coloured «رد البوست» made
        // the ACTION read as the screen's identity and the identity read as a
        // hint. sm+: the real title returns, the picker goes back to supporting
        // muted. hover keeps signalling interactivity on both.
        className="inline-flex items-center min-h-9 gap-1 min-w-0 text-foreground sm:text-muted-foreground hover:text-foreground transition-colors group"
      >
        {/* No fixed cap. `max-w-[34vw]` was sized for the WORST case (comments,
            which also carries a labelled «رد البوست») and then applied to every
            page, so /messages truncated just as hard despite having room to
            spare. Flexing instead lets the name take whatever the actions leave
            — automatically wider where there are fewer of them. */}
        {/* text-sm even though this is the mobile header's identity: ink (white
            + bold), not SIZE, carries the weight. text-base measured ~15% wider
            here and pushed the truncation from «…الدمشقي» back to «…الدم» — on
            a narrow screen every glyph of the NAME is worth more than font
            size, and this specific cut turned the name into another word. */}
        <span dir="auto" className="text-sm font-bold sm:font-semibold min-w-0 truncate">
          {selectedPage?.name ?? tc('allPages')}
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
                  <span dir="auto" className="truncate">{option.label}</span>
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
