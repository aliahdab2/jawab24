import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';
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
  /**
   * Opt-in type-ahead filter above the options. Off by default, so every existing
   * Select renders byte-identically.
   *
   * Turn it on for lists too long to scan — the IANA timezone list is ~400 entries,
   * and an unsearchable dropdown that size is the reason we nearly shipped a
   * hand-curated list instead of the platform's own database.
   */
  searchable?: boolean;
  /** Placeholder for the type-ahead input. Required when `searchable` (i18n — never hardcode). */
  searchPlaceholder?: string;
  /** Announced when the filter matches nothing. Required when `searchable`. */
  noResultsLabel?: string;
}

/** Gap the open compact menu keeps from the viewport edge, px. */
const MENU_VIEWPORT_GUTTER = 16;
/** Floor for the compact menu's width — unless the viewport leaves less room than that. */
const MENU_MIN_WIDTH = 200;

/** Which edge of the trigger the compact menu hangs from, plus the room it has on that side. */
interface MenuPlacement {
  anchor: 'start' | 'end';
  maxWidth?: number;
}
const START_ANCHORED: MenuPlacement = { anchor: 'start' };

function isRtl(el: HTMLElement): boolean {
  // The computed `direction` is the answer in a browser. jsdom leaves it empty,
  // so fall back to the nearest declared `dir` — `<html dir>` from _document.
  const computed = getComputedStyle(el).direction;
  return computed ? computed === 'rtl' : el.closest('[dir]')?.getAttribute('dir') === 'rtl';
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
export function Select({ value, onChange, options, placeholder, label, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, className, disabled = false, compact = false, searchable = false, searchPlaceholder, noResultsLabel }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuPlacement, setMenuPlacement] = useState<MenuPlacement>(START_ANCHORED);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  // Match on the label so a search hits both the zone name and its offset
  // ("tripoli" and "+02" both find Africa/Tripoli).
  const visibleOptions = searchable && query.trim()
    ? options.filter(opt => opt.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

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

  // Place the open menu: above or below by vertical room, and — compact only —
  // hung from whichever trigger edge leaves it more horizontal room.
  //
  // A layout effect, because it measures the freshly rendered menu and then
  // moves it; with a plain effect the unplaced menu would paint for a frame.
  useLayoutEffect(() => {
    if (!isOpen || !dropdownRef.current || !containerRef.current) {
      // Reopen unconstrained, so the natural width measured below is real and
      // not last time's cap. Same object, so a closed menu never re-renders.
      setMenuPlacement(START_ANCHORED);
      return;
    }
    const dropdown = dropdownRef.current;
    const containerRect = containerRef.current.getBoundingClientRect();
    const dropdownHeight = dropdown.offsetHeight;
    const spaceBelow = window.innerHeight - containerRect.bottom;
    const spaceAbove = containerRect.top;

    // If not enough space below and more space above, position above
    if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
      dropdown.style.bottom = '100%';
      dropdown.style.top = 'auto';
      dropdown.style.marginBottom = '4px';
      dropdown.style.marginTop = '0';
    } else {
      dropdown.style.top = '100%';
      dropdown.style.bottom = 'auto';
      dropdown.style.marginTop = '4px';
      dropdown.style.marginBottom = '0';
    }

    // The default menu is inset-x-0 — the trigger's own width — so only the
    // compact pill, whose menu is wider than its trigger, needs placing.
    if (!compact) return;

    // The compact menu used to be start-anchored with max-width 100vw − 2rem.
    // That caps it to the VIEWPORT's width, not to the room between the
    // trigger's start edge and the far side of the viewport — so from a trigger
    // sitting mid-screen (the persona scope picker in ReplyStyleCard, RTL,
    // reported 2026-08-22) it grew inward straight off the screen and the
    // options' ends were unreachable.
    const rtl = isRtl(containerRef.current);
    const viewportWidth = document.documentElement.clientWidth;
    // Hung from the start edge, the menu grows toward the viewport's far side …
    const roomFromStart = (rtl ? containerRect.right : viewportWidth - containerRect.left) - MENU_VIEWPORT_GUTTER;
    // … hung from the end edge, back toward the near side.
    const roomFromEnd = (rtl ? viewportWidth - containerRect.left : containerRect.right) - MENU_VIEWPORT_GUTTER;
    // Natural width of the unconstrained, start-anchored menu this render produced.
    const naturalWidth = dropdown.scrollWidth;

    const anchor = naturalWidth <= roomFromStart || roomFromStart >= roomFromEnd ? 'start' : 'end';
    const maxWidth = Math.max(0, Math.floor(anchor === 'start' ? roomFromStart : roomFromEnd));
    setMenuPlacement({ anchor, maxWidth });
  }, [isOpen, compact]);

  // Reset the filter whenever the menu closes, and focus the input when it opens,
  // so reopening never shows a stale, silently-filtered list.
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
    } else if (searchable) {
      searchRef.current?.focus();
    }
  }, [isOpen, searchable]);

  // Open with the current value in view — a long list (48 half-hour slots,
  // ~400 timezones) otherwise always opens scrolled to its first entry.
  // Sets scrollTop directly instead of scrollIntoView: the latter also
  // scrolls ancestors, which would drag the page behind the dropdown.
  useEffect(() => {
    const dropdown = dropdownRef.current;
    const selected = dropdown?.querySelector<HTMLElement>('[data-selected="true"]');
    if (isOpen && dropdown && selected) {
      dropdown.scrollTop = selected.offsetTop - dropdown.clientHeight / 2 + selected.clientHeight / 2;
    }
  }, [isOpen]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      // `min-w-0` is load-bearing, not defensive. As a FLEX/GRID item this root's
      // automatic minimum size is its min-content size, and in `compact` mode the
      // trigger label carries `truncate` (`white-space: nowrap`) — so min-content is
      // the ENTIRE label. Without `min-w-0` the item refuses to shrink, overflows its
      // container, and the `truncate` never engages because the box is never
      // constrained. Measured in Chrome with a long option label in a 412px row:
      // 517px wide, 114px past the container's start edge, `ellipsised: false`; with
      // `min-w-0` it is 394px, inside, and ellipsised. Shipped symptom: the persona
      // scope picker in ReplyStyleCard running off the card edge for a long page name
      // («الفريق الدمشقي للتدريب والتأهيل — شخصية خاصة»), reported 2026-08-19.
      // `max-w-full` covers the grid case, where `min-width: auto` is not the lever.
      // The caller cannot fix this from outside — `className` goes to the trigger
      // BUTTON below, never to this root. Pinned by Select.test.tsx (source) and
      // e2e/settings.spec.ts (the layout the browser actually resolves).
      className="relative min-w-0 max-w-full"
      // Esc closes the DROPDOWN only: without stopPropagation it bubbles to a
      // parent sheet's window-level escape handler, which closes (or asks to
      // discard) the whole modal mid-pick.
      onKeyDown={(e) => {
        if (e.key === 'Escape' && isOpen) {
          e.stopPropagation();
          setIsOpen(false);
        }
      }}
    >
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
              // Hung from the trigger edge the layout effect picked, and capped
              // to the room on that side, so the menu stays on screen wherever
              // the trigger sits.
              ? [
                menuPlacement.anchor === 'start' ? 'start-0' : 'end-0',
                "bg-card border-2 border-brand-500/30 shadow-2xl shadow-black/30 dark:shadow-black/60 ring-1 ring-black/5 dark:ring-white/5",
              ]
              : "inset-x-0 bg-card border border-theme-border shadow-xl"
          )}
          style={!compact ? undefined : menuPlacement.maxWidth === undefined
            ? { minWidth: MENU_MIN_WIDTH }
            : { maxWidth: menuPlacement.maxWidth, minWidth: Math.min(MENU_MIN_WIDTH, menuPlacement.maxWidth) }}
        >
          {searchable && (
            // Sticky so the filter stays reachable while scrolling a long list.
            <div className="sticky top-0 z-10 bg-card border-b border-theme-border p-2">
              <div className="relative">
                <Search
                  className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-icon-muted pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  ref={searchRef}
                  type="text"
                  dir="auto"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className="w-full ps-8 pe-2 py-2 text-sm rounded-lg bg-muted border-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            </div>
          )}
          {visibleOptions.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted-foreground text-center">
              {query.trim() ? noResultsLabel : 'No options available'}
            </div>
          ) : (
            visibleOptions.map((option, idx) => (
              <button
                key={option.value}
                type="button"
                data-selected={option.value === value || undefined}
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
