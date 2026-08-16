import React from 'react';
import { useTranslations } from 'next-intl';
import { MAX_FACT_ATTR_VALUE_LENGTH } from '@jawab24/shared';

/** Does this attribute value exceed the server's cap? Counted on the TRIMMED
 *  string — exactly what the save path sends — so the guard and the request
 *  body cannot disagree about the same text. */
export const factValueTooLong = (value: string): boolean =>
  value.trim().length > MAX_FACT_ATTR_VALUE_LENGTH;

/**
 * Inline counter + over-limit alert for a fact attribute value field, shared
 * by both list editors (ListRowSheet, FactEntitySheet) so the threshold and
 * the copy cannot drift apart.
 *
 * Quiet until the text approaches the cap — long notes are rare — then a
 * muted counter; loud (role="alert") once it crosses it. The caller disables
 * Save on the same predicate, so the server's 400 (which used to surface as a
 * misleading «راجع السعر والتواريخ» toast on a long note, 2026-08-16) is
 * unreachable from these forms.
 */
export function ValueLengthFeedback({ value, fieldId }: { value: string; fieldId: string }) {
  const t = useTranslations('business');
  const len = value.trim().length;
  if (len <= MAX_FACT_ATTR_VALUE_LENGTH - 100) return null;
  const over = len > MAX_FACT_ATTR_VALUE_LENGTH;
  return (
    <p
      id={`${fieldId}-length`}
      role={over ? 'alert' : undefined}
      className={`mt-1 text-xs ${over ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
    >
      {over
        ? t('lists.valueTooLong', { max: MAX_FACT_ATTR_VALUE_LENGTH })
        : t('lists.valueLengthCount', { len, max: MAX_FACT_ATTR_VALUE_LENGTH })}
    </p>
  );
}
