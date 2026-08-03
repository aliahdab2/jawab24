import React, { useMemo } from 'react';
import { Select } from '@/components/ui';

/** "HH:MM" in half-hour steps, 00:00 → 23:30. */
const SLOTS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '30'] as const) {
    SLOTS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}

interface TimeSelectProps {
  value: string;
  onChange: (value: string) => void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

/**
 * Time picker for the business-hours sheet, replacing `<input type="time">`.
 *
 * The native control renders its value in the BROWSER locale's clock format —
 * «09.00» with a dot on many devices — while the stored string, the collapsed
 * day summary and the fact row all print the canonical «09:00». Same value,
 * two spellings on one screen. A Select over the canonical strings shows
 * exactly what is stored, always 24h, always with a colon, on every platform.
 *
 * Half-hour steps cover real opening hours; an existing off-step value (e.g.
 * a Facebook-imported «09:15») is injected into the list in order so it stays
 * selected and reachable rather than being silently snapped.
 */
export function TimeSelect({
  value,
  onChange,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: TimeSelectProps) {
  const options = useMemo(() => {
    // Zero-padded HH:MM sorts correctly as plain strings.
    const values = !value || SLOTS.includes(value) ? SLOTS : [...SLOTS, value].sort();
    return values.map((v) => ({ value: v, label: v }));
  }, [value]);

  return (
    <Select
      value={value}
      onChange={onChange}
      options={options}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    />
  );
}
