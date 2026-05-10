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
 * for absolute positioning at bottom-end. Flips to red at 90% of max.
 */
export function CharCounter({ value, max, hideWhenZero }: CharCounterProps) {
  const len = typeof value === 'string' ? value.length : value;
  if (hideWhenZero && len === 0) return null;
  return (
    <span
      className={clsx(
        'text-[10px] font-medium',
        len > max * 0.9 ? 'text-red-500' : 'text-muted-foreground/70',
      )}
    >
      {len}/{max}
    </span>
  );
}
