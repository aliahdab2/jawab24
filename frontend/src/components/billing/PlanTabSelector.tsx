import { useRef, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import { isRTLLocale } from '@/utils/locale';

export interface PlanTab {
  /** Stable key — also used to build the `plan-panel-${key}` aria-controls id. */
  key: string;
  label: string;
}

/**
 * Mobile-only segmented tab bar for switching between plan cards (one visible at
 * a time). Shared by the public /pricing grid and the hidden /pricing/scale page
 * so both pages get identical visual + keyboard behavior from one source.
 *
 * Hidden on md+ (`md:hidden`) — desktop shows all cards side by side. The caller
 * owns the active index + the matching `plan-panel-${key}` panels; this component
 * only renders the `tablist`.
 */
export function PlanTabSelector({
  tabs,
  activeIndex,
  onChange,
  locale,
  ariaLabel,
}: {
  tabs: PlanTab[];
  activeIndex: number;
  onChange: (index: number) => void;
  locale: string;
  ariaLabel: string;
}) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // RTL-aware roving-tabindex navigation (ArrowLeft/Right swap in RTL).
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const isRTL = isRTLLocale(locale);
    const forward = isRTL ? 'ArrowLeft' : 'ArrowRight';
    const backward = isRTL ? 'ArrowRight' : 'ArrowLeft';
    let next = activeIndex;

    if (e.key === forward) { e.preventDefault(); next = (activeIndex + 1) % tabs.length; }
    else if (e.key === backward) { e.preventDefault(); next = (activeIndex - 1 + tabs.length) % tabs.length; }
    else if (e.key === 'Home') { e.preventDefault(); next = 0; }
    else if (e.key === 'End') { e.preventDefault(); next = tabs.length - 1; }
    else return;

    onChange(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      className="grid mx-4 mb-8 border border-theme-border rounded-lg overflow-hidden md:hidden"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.key}
          ref={(el) => { tabRefs.current[index] = el; }}
          type="button"
          role="tab"
          id={`plan-tab-${tab.key}`}
          aria-selected={activeIndex === index}
          aria-controls={`plan-panel-${tab.key}`}
          tabIndex={activeIndex === index ? 0 : -1}
          onClick={() => onChange(index)}
          className={clsx(
            'py-3 text-sm font-semibold text-center transition-all duration-200 whitespace-nowrap',
            'border-theme-border',
            index > 0 && 'border-s',
            activeIndex === index
              ? 'bg-card text-foreground shadow-sm'
              : 'bg-background text-muted-foreground hover:text-foreground/70 hover:bg-muted',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
