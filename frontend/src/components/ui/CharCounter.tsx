import clsx from 'clsx';

interface CharCounterProps {
  /** Either the string itself or a precomputed length. */
  value: string | number;
  max: number;
  /** Hide while empty — useful when the counter is noise on a fresh field. */
  hideWhenZero?: boolean;
}

/**
 * Tiny `n/max` counter shared by all settings inputs. Pair with `InputFieldWrapper`
 * for absolute positioning at bottom-end.
 *
 * Tri-tier coloring:
 *   - muted while comfortably under cap
 *   - amber from 80% up to (cap−1) — "you're getting close"
 *   - red only at or above cap — "you've hit the limit"
 */
export function CharCounter({ value, max, hideWhenZero }: CharCounterProps) {
  const len = typeof value === 'string' ? value.length : value;
  if (hideWhenZero && len === 0) return null;
  return (
    <span
      className={clsx(
        'text-[10px] font-medium',
        len >= max
          ? 'text-red-500'
          : len > max * 0.8
            ? 'text-amber-500'
            : 'text-muted-foreground/70',
      )}
    >
      {len}/{max}
    </span>
  );
}
