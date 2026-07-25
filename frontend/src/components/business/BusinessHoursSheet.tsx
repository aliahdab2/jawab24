import React, { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, Check } from 'lucide-react';
import Link from 'next/link';
import { DetailSheet, Button } from '@/components/ui';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useMerchantTimezone } from '@/hooks/useMerchantTimezone';
import { canonicalizeHoursEntry, SHORT_DAY_KEYS } from '@jawab24/shared';

type DayKey = typeof SHORT_DAY_KEYS[number];

/** Week starts Saturday in the Arab market — the order merchants read. */
const DISPLAY_ORDER: readonly DayKey[] = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
/** Default working week for the region: Friday off. Merchant can change it. */
const DEFAULT_OPEN: readonly DayKey[] = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu'];

interface BusinessHoursSheetProps {
  /** Existing hours (any accepted day-key form). */
  initialHours: Record<string, string[]> | undefined;
  saving: boolean;
  onSave: (hours: Record<string, string[]> | undefined) => void;
  onClose: () => void;
}

/** Pull "HH:MM"/"HH:MM" out of the first canonical entry we can find. */
function readExisting(hours: Record<string, string[]> | undefined) {
  const open = new Set<DayKey>();
  let from = '09:00';
  let to = '17:00';
  let found = false;
  for (const day of DISPLAY_ORDER) {
    const entries = hours?.[day] ?? hours?.[`${day}day`] ?? [];
    const first = Array.isArray(entries) ? entries[0] : undefined;
    if (!first || first === 'closed') continue;
    open.add(day);
    const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(first);
    if (m && !found) { from = m[1]; to = m[2]; found = true; }
  }
  return { open: open.size ? open : new Set<DayKey>(DEFAULT_OPEN), from, to };
}

/**
 * Structured working-hours editor (B1 part 2b).
 *
 * Replaces the free-text fallback the hours row used to route to — the owner
 * hit that immediately («عم يرجع ياخدني على النص الحر... نفس الشي صح») and was
 * right: sending a merchant into a 16k-char textarea to state "9 to 5, closed
 * Friday" is the exact unmaintainability this milestone exists to remove.
 *
 * Optimized for the common case rather than the general one: ONE schedule
 * applied to the days you pick. Day chips + two native time inputs = ~4 taps,
 * and the value is written structured (`{sat:['09:00-17:00'], …}`) so it
 * reaches the AI through BUSINESS_INFO as an authoritative field. Per-day
 * different hours remain a Phase-D refinement — deliberately not built here,
 * because it costs every merchant complexity to serve a minority.
 */
export function BusinessHoursSheet({ initialHours, saving, onSave, onClose }: BusinessHoursSheetProps) {
  const t = useTranslations('business');
  const tc = useTranslations('common');
  const timezone = useMerchantTimezone();

  const existing = useMemo(() => readExisting(initialHours), [initialHours]);
  const [openDays, setOpenDays] = useState<Set<DayKey>>(existing.open);
  const [from, setFrom] = useState(existing.from);
  const [to, setTo] = useState(existing.to);

  useEscapeKey(onClose, true);

  const toggleDay = (day: DayKey) => {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  };

  // Reuse the shared canonicalizer (never re-implement time parsing).
  const parsed = canonicalizeHoursEntry(`${from}-${to}`);
  const valid = parsed.ok && openDays.size > 0;

  const submit = () => {
    if (saving || !valid) return;
    if (openDays.size === 0) { onSave(undefined); return; }
    const value = (parsed as { ok: true; value: string }).value;
    const hours: Record<string, string[]> = {};
    for (const day of DISPLAY_ORDER) {
      hours[day] = openDays.has(day) ? [value] : ['closed'];
    }
    onSave(hours);
  };

  return (
    <DetailSheet
      panelClassName="sm:max-h-[70vh]"
      dialogProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'hours-sheet-title' }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:p-5 border-b border-theme-border flex-shrink-0">
        <h2 id="hours-sheet-title" className="text-base sm:text-lg font-semibold text-foreground">
          {t('facts.hours')}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={tc('close')}
          className="min-h-[44px] min-w-[44px] -me-2 flex items-center justify-center rounded-lg hover:bg-surface-100 text-surface-500"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">
        <p className="text-sm text-muted-foreground mb-3">{t('facts.hint_hours')}</p>

        {/* Working days — chips are 44px so they're comfortable one-handed */}
        <fieldset>
          <legend className="text-sm font-medium text-foreground mb-2">{t('facts.hoursDays')}</legend>
          <div className="flex flex-wrap gap-2">
            {DISPLAY_ORDER.map((day) => {
              const on = openDays.has(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  aria-pressed={on}
                  className={`min-h-[44px] px-3.5 rounded-full text-sm font-medium border transition ${
                    on
                      ? 'bg-brand-500 text-white border-transparent'
                      : 'bg-card text-muted-foreground border-theme-border hover:bg-surface-100'
                  }`}
                >
                  {t(`facts.day_${day}`)}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* One schedule for the selected days — the common case */}
        <div className="flex items-end gap-3 mt-5">
          <div className="flex-1 min-w-0">
            <label htmlFor="hours-from" className="block text-sm font-medium text-foreground mb-1.5">
              {t('facts.hoursFrom')}
            </label>
            <input
              id="hours-from"
              type="time"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              dir="ltr"
              className="w-full min-h-[44px] rounded-xl border border-theme-border bg-card px-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div className="flex-1 min-w-0">
            <label htmlFor="hours-to" className="block text-sm font-medium text-foreground mb-1.5">
              {t('facts.hoursTo')}
            </label>
            <input
              id="hours-to"
              type="time"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              dir="ltr"
              className="w-full min-h-[44px] rounded-xl border border-theme-border bg-card px-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        {openDays.size === 0 && (
          <p className="text-xs text-amber-700 mt-3" role="status">{t('facts.hoursPickDay')}</p>
        )}

        {/* Timezone is SHOWN, never edited here: it is workspace-level and already
            drives the AI's date awareness + the Post-Reply hours gate. A second
            control would give one value two homes (D-039). */}
        {timezone && (
          <p className="text-xs text-muted-foreground mt-4">
            {/* Show the city, not the IANA id: "Asia/Damascus" → "Damascus". */}
            {t('facts.hoursTimezone', { timezone: timezone.split('/').pop()?.replace(/_/g, ' ') ?? timezone })}{' '}
            <Link href="/settings" className="text-brand-600 hover:underline underline-offset-2">
              {t('facts.hoursTimezoneChange')}
            </Link>
          </p>
        )}


      </div>

      <div className="flex-shrink-0 flex items-center justify-end gap-3 px-4 py-3 pb-safe-modal lg:pb-4 lg:px-5 border-t border-theme-border bg-card">
        <Button variant="secondary" size="sm" onClick={onClose} className="max-sm:hidden">
          {tc('cancel')}
        </Button>
        <Button
          size="sm"
          onClick={submit}
          loading={saving}
          disabled={!valid}
          icon={<Check className="w-4 h-4" />}
          className="max-sm:h-11 max-sm:px-6 max-sm:flex-1"
        >
          {tc('save')}
        </Button>
      </div>
    </DetailSheet>
  );
}
