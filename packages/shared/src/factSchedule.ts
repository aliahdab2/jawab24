/**
 * Structured SHADOW values for fact-row attributes (G1b round 7).
 *
 * The write-back contract: the merchant-visible attribute string stays the
 * source of truth and is what the AI quotes — these shadows ride alongside it
 * so the product can sort, count and expire sessions reliably WITHOUT ever
 * interpreting free text. The prompt pipeline never reads them; deleting the
 * column would lose no merchant data.
 *
 * Keyed by the attribute LABEL the shadow belongs to («الأيام» → weekdays,
 * «الساعة» → timeRange) — labels are merchant-authored, so the key is
 * whatever their list uses, never a hardcoded vocabulary.
 */

/** Days of week, JS `Date#getDay()` numbering: 0 = Sunday … 6 = Saturday. */
export interface FactWeekdaysValue {
  kind: 'weekdays';
  days: number[];
}

/** 24-hour wall-clock times, `"HH:MM"` — what `<input type="time">` yields. */
export interface FactTimeRangeValue {
  kind: 'timeRange';
  start: string;
  end: string;
}

export type FactStructuredFieldValue = FactWeekdaysValue | FactTimeRangeValue;

/** attribute label → its structured shadow. */
export type FactStructuredValues = Record<string, FactStructuredFieldValue>;
