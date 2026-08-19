import clsx from 'clsx';

/** One filter chip. `count` is optional — a chip with no number renders bare. */
export interface FilterChip<K extends string = string> {
  key: K;
  label: string;
  count?: number;
  /**
   * Accent tone for a chip that is not part of the main status sequence — the
   * leads page's cross-cutting «عاد للتواصل» flag, whose orange echoes the badge
   * on the card it filters to. Everything else is `brand`.
   */
  tone?: 'brand' | 'accent';
}

interface FilterChipBarProps<K extends string> {
  chips: FilterChip<K>[];
  /** The chip currently applied, or null when none is. */
  activeKey: K | null;
  onSelect: (key: K) => void;
  /** Names the group for screen readers, e.g. "filter messages". */
  ariaLabel: string;
}

/**
 * The filter chip row above the inbox lists (messages, comments, leads).
 *
 * One component because the three pages carried byte-identical markup — a chip
 * whose padding, tap target or selected style was fixed in one page silently
 * drifted from the other two.
 *
 * **Every chip stays on screen.** All three rows used to be a single
 * horizontally-scrolling line on mobile with `scrollbar-hide` and no fade, so
 * the overflow was invisible: the inbox hid «تمت المعالجة» (reported
 * 2026-08-19) and leads hid «عاد للتواصل» by design. That is the exact pattern
 * Material 3 and NN/g call out — a scrollable set must at least peek.
 *
 * What makes one row hold everything is the STACK: below `sm` the count sits
 * under its label, so a chip is as wide as `max(label, number)` rather than
 * `label + number`. Measured in Cairo against 328 px of usable width on a
 * 360 px phone — inbox 417 → 311 px, leads 447 → 309 px (324 px in English),
 * and 327 px with five-digit counts like 72,325. Cost: +2 px of height.
 * Deleting the counts would NOT have fixed it — the labels alone need 333 px.
 *
 * `flex-wrap` is the safety net for ~320 px devices, where even the stacked row
 * spills: a visible second row beats a hidden filter.
 *
 * **The chips SHARE the row's full width** (`flex-1` below `sm`). Content-sized
 * chips left the short ones tiny and the row unfinished: measured on leads at
 * 360 px, 57 px of it went unused while «الكل» sat in a pill about a third the
 * width of «تحوّل» (reported 2026-08-19) — the most-tapped filter had the
 * smallest target. Growing is safe with big numbers precisely because `flex-1`
 * keeps the default `min-width: auto`: a chip never shrinks below its own
 * widest line, so a 72,325 count still sets its floor and only the surplus is
 * shared. When the floors add up to more than the line, nothing is squashed —
 * the row wraps, exactly as before.
 */
export function FilterChipBar<K extends string>({
  chips,
  activeKey,
  onSelect,
  ariaLabel,
}: FilterChipBarProps<K>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="w-full sm:flex-1 sm:min-w-0 flex flex-wrap items-center gap-1 sm:gap-2"
    >
      {chips.map((chip) => {
        const active = activeKey === chip.key;
        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => onSelect(chip.key)}
            aria-pressed={active}
            className={clsx(
              // Stacked below sm (count under label), inline pill from sm up.
              // The stack is what makes one row fit — see the `layout` note.
              'flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-0 sm:gap-1.5',
              // Fill the phone's width, keep the natural pill from sm up — there
              // the row shares its line with the search box, so growing would
              // steal that space.
              'flex-1 sm:flex-none',
              'px-2.5 sm:px-4 py-1 sm:py-2 min-h-[46px] sm:min-h-0 rounded-2xl sm:rounded-full',
              'text-xs sm:text-sm font-medium whitespace-nowrap transition-all duration-200',
              active
                ? chip.tone === 'accent'
                  ? 'bg-accent-500 text-white shadow-sm shadow-accent-500/25'
                  : 'bg-brand-500 text-white shadow-sm shadow-brand-500/25'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/80',
            )}
          >
            {chip.label}
            {chip.count !== undefined && (
              // Stacked, the number is the chip's second line — give it the weight
              // that earns, since it is what the merchant scans. On the one-line
              // desktop form it trails the label, so it stays muted there.
              <span className={clsx(
                'tabular-nums leading-tight text-[13px] font-bold sm:text-xs sm:font-medium',
                active ? 'text-white/80 sm:text-white/70' : 'text-muted-foreground sm:text-subtle',
              )}>
                {chip.count.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
