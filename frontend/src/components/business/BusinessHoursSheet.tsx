import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, Check, Plus, Trash2, Copy, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { DetailSheet, Button, Toggle, ConfirmationModal } from '@/components/ui';
import { TimeSelect } from './TimeSelect';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useModalBackHandler } from '@/hooks/useModalBackHandler';
import { useMerchantTimezone } from '@/hooks/useMerchantTimezone';
import {
  DAY_KEYS,
  DEFAULT_RANGE,
  parseWeek,
  serializeWeek,
  hasOpenDay,
  describeDay,
  dayHasOverlap,
  overlappingDays,
  nextPeriodDefault,
  type DayKey,
  type WeekState,
} from '@/utils/businessHours';

interface BusinessHoursSheetProps {
  /** Existing hours (any accepted day-key form). */
  initialHours: Record<string, string[]> | undefined;
  saving: boolean;
  /** Save failure, rendered INSIDE the sheet — toasts sit under the modal
   *  tier (z-45 < z-50), so a toast can't carry this message. */
  saveError?: string | null;
  onSave: (hours: Record<string, string[]> | undefined) => void;
  onClose: () => void;
}

/**
 * Structured working-hours editor (B1 part 2b).
 *
 * Replaces the free-text fallback the hours row used to route to — sending a
 * merchant into a 16k-char textarea to state "9 to 5, closed Friday" is the
 * exact unmaintainability this milestone exists to remove.
 *
 * PER-DAY by design. The first version applied ONE schedule to every day you
 * picked, on the theory that per-day hours cost every merchant complexity to
 * serve a minority. That was wrong in a way that lost data: `business_profile.
 * hours` stores `Record<day, string[]>`, Facebook import already writes
 * different hours per day AND split shifts (`mon_1_*`, `mon_2_*`), and the
 * prompt formatter already renders them. So a merchant whose real week was
 * "Sat–Thu 09:00–17:00, Fri 14:00–20:00" would open this sheet, see one
 * flattened range, and overwrite their true hours the moment they saved.
 *
 * The fast path is preserved by «apply to all days» rather than by removing
 * the capability: set one day, copy it across — still ~4 taps for the uniform
 * case, while a genuinely different Friday survives.
 *
 * MOBILE-FIRST LAYOUT: one 56px line per day, expanded to edit (the Cal.com /
 * Calendly pattern). Showing every day's time inputs at once measured 153px per
 * open day — a seven-day shop needed ~2.2 screens of scrolling just to READ its
 * own hours, and repeated the "add another period" row seven times for a
 * feature most merchants never touch. Collapsed, the whole week fits one screen,
 * so the merchant sees what the AI will tell customers without scrolling, and
 * pays the extra tap only on the day they actually change.
 */
export function BusinessHoursSheet({ initialHours, saving, saveError = null, onSave, onClose }: BusinessHoursSheetProps) {
  const t = useTranslations('business');
  const tc = useTranslations('common');
  const timezone = useMerchantTimezone();

  const initial = useMemo(() => parseWeek(initialHours), [initialHours]);
  const [week, setWeek] = useState<WeekState>(initial);

  /** Nothing stored yet = first-time setup: open the first day so the merchant
   *  sees what to fill in. With hours already saved, start collapsed — the
   *  overview is the point. */
  const [expanded, setExpanded] = useState<DayKey | null>(() =>
    initialHours && Object.keys(initialHours).length > 0
      ? null
      : DAY_KEYS.find((d) => initial[d].kind !== 'closed') ?? null,
  );

  const setDay = (day: DayKey, next: WeekState[DayKey]) =>
    setWeek((prev) => ({ ...prev, [day]: next }));

  const toggleDay = (day: DayKey, open: boolean) => {
    setDay(day, open ? { kind: 'ranges', ranges: [{ ...DEFAULT_RANGE }] } : { kind: 'closed' });
    // Opening a day reveals its times straight away — otherwise the merchant
    // flips the switch and has to hunt for where to set them.
    setExpanded(open ? day : (prev) => (prev === day ? null : prev));
  };

  const setRange = (day: DayKey, index: number, field: 'from' | 'to', value: string) =>
    setWeek((prev) => {
      const state = prev[day];
      if (state.kind !== 'ranges') return prev;
      const ranges = state.ranges.map((r, i) => (i === index ? { ...r, [field]: value } : r));
      return { ...prev, [day]: { kind: 'ranges', ranges } };
    });

  const addPeriod = (day: DayKey) =>
    setWeek((prev) => {
      const state = prev[day];
      if (state.kind !== 'ranges') return prev;
      // Starts after the previous period ends, so adding one never creates an
      // overlap by default.
      const ranges = [...state.ranges, nextPeriodDefault(state.ranges)];
      return { ...prev, [day]: { kind: 'ranges', ranges } };
    });

  const removePeriod = (day: DayKey, index: number) =>
    setWeek((prev) => {
      const state = prev[day];
      if (state.kind !== 'ranges') return prev;
      const ranges = state.ranges.filter((_, i) => i !== index);
      return { ...prev, [day]: ranges.length ? { kind: 'ranges', ranges } : { kind: 'closed' } };
    });

  /** Turn a preserved "all day" into editable times without losing the day. */
  const setSpecificTimes = (day: DayKey) =>
    setDay(day, { kind: 'ranges', ranges: [{ ...DEFAULT_RANGE }] });

  /** The day whose schedule «apply to all» copies — the first open one. */
  const sourceDay = DAY_KEYS.find((d) => week[d].kind !== 'closed');

  const applyToAll = () => {
    if (!sourceDay) return;
    const source = week[sourceDay];
    const copy = (): WeekState[DayKey] =>
      source.kind === 'ranges'
        ? { kind: 'ranges', ranges: source.ranges.map((r) => ({ ...r })) }
        : { ...source };
    setWeek(() => {
      const next = {} as WeekState;
      for (const day of DAY_KEYS) next[day] = copy();
      return next;
    });
  };

  const serialized = serializeWeek(week);
  // Google Business Profile requires the same thing of split hours ("if your
  // first slot ends at 2 PM, your second should begin at 2 PM or later"), and
  // Google's own day-part API names the failure TIME_PERIODS_OVERLAP. Adjacent
  // periods are fine; only true overlaps are refused.
  const overlaps = overlappingDays(week);
  const valid = serialized !== null && hasOpenDay(week) && overlaps.length === 0;

  // Compared through the SAME serializer that saves, so "unchanged" means
  // exactly "the editor still shows what it opened with".
  const initialSerialized = useMemo(() => JSON.stringify(serializeWeek(initial)), [initial]);
  const changed = JSON.stringify(serialized) !== initialSerialized;

  // Two gates from one diff, and they differ on purpose:
  //  - SAVE also opens for a first-time merchant (`!hasStoredHours`): nothing
  //    is stored yet, so one-tap-saving the seeded default week is a real
  //    save, not a no-op. The sheet opened with a live Save on pages with
  //    existing hours — the only editor in the section not gated on a change.
  //  - The CLOSE GUARD uses `changed` alone: on first open the editor equals
  //    its seed, and warning «لديك تغييرات غير محفوظة» with zero edits made
  //    is false — it trains merchants to dismiss the warning.
  const hasStoredHours = !!initialHours && Object.keys(initialHours).length > 0;
  const dirty = !hasStoredHours || changed;

  // Typed-but-unsaved edits never vanish on a stray tap.
  const [confirmClose, setConfirmClose] = useState(false);
  const attemptClose = () => {
    // Mid-save, closing would race the outcome: a failure needs the sheet
    // (the inline error renders here), so close waits the last second out.
    if (saving) return;
    if (changed) setConfirmClose(true);
    else onClose();
  };
  // While the discard confirm is up, ITS Esc handling wins — otherwise one
  // keypress closes the confirm and this hook instantly re-opens it.
  useEscapeKey(attemptClose, !confirmClose);
  // Android hardware back must take the SAME guarded path as X/Esc/swipe.
  // Ref-stabilized so re-renders never re-push this sheet above a stacked
  // ConfirmationModal in the back-handler stack.
  const attemptCloseRef = useRef(attemptClose);
  attemptCloseRef.current = attemptClose;
  const stableAttemptClose = useCallback(() => attemptCloseRef.current(), []);
  useModalBackHandler(true, stableAttemptClose);

  const submit = () => {
    if (saving || !valid || !dirty) return;
    onSave(serialized ?? undefined);
  };

  return (
    <DetailSheet
      fitContent
      onSwipeDismiss={attemptClose}
      panelClassName="sm:max-h-[80vh]"
      dialogProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'hours-sheet-title' }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:p-5 border-b border-theme-border flex-shrink-0">
        <h2 id="hours-sheet-title" className="text-base sm:text-lg font-semibold text-foreground">
          {t('facts.hours')}
        </h2>
        <button
          type="button"
          onClick={attemptClose}
          disabled={saving}
          aria-label={tc('close')}
          className="min-h-[44px] min-w-[44px] -me-2 flex items-center justify-center rounded-lg hover:bg-surface-100 text-surface-500 disabled:opacity-40"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">
        <p className="text-sm text-muted-foreground mb-3">{t('facts.hint_hours')}</p>

        <ul className="divide-y divide-theme-border">
          {DAY_KEYS.map((day) => {
            const state = week[day];
            const isOpen = state.kind !== 'closed';
            const dayLabel = t(`facts.day_${day}`);
            const isExpanded = isOpen && expanded === day;
            const hasOverlap = dayHasOverlap(state);
            const summary = describeDay(state, {
              closed: t('facts.hoursClosed'),
              allDay: t('facts.hoursAllDay'),
            });
            return (
              <li key={day}>
                {/* The toggle is a SIBLING of the expand button, never nested
                    inside it — one tap target must not contain another. */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => isOpen && setExpanded(isExpanded ? null : day)}
                    aria-expanded={isOpen ? isExpanded : undefined}
                    // Closed days have nothing to expand: the toggle is the
                    // only control, so the row must not pretend to be tappable.
                    disabled={!isOpen}
                    className="flex-1 min-w-0 min-h-[56px] flex items-center gap-2 text-start disabled:cursor-default"
                  >
                    <span className="text-sm font-medium text-foreground">{dayLabel}</span>
                    <span
                      className={`flex-1 min-w-0 truncate text-sm ${
                        // A collapsed day must still show it is the reason Save
                        // is disabled — otherwise the merchant hits a dead end.
                        hasOverlap ? 'text-amber-700 dark:text-amber-400'
                          : isOpen ? 'text-muted-foreground' : 'text-subtle'
                      }`}
                      dir={hasOverlap ? undefined : 'ltr'}
                      // Times read LTR in both locales; keep them on the side
                      // the day name isn't, so the column scans cleanly.
                      style={{ textAlign: 'end' }}
                    >
                      {hasOverlap ? t('facts.hoursOverlap') : summary}
                    </span>
                    {isOpen && (
                      <>
                        {/* Names the row's PURPOSE for assistive tech — the
                            visible content alone reads as a bare day + times
                            with no hint that activating it expands anything. */}
                        <span className="sr-only">— {t('facts.hoursToggleDetails')}</span>
                        <ChevronDown
                          className={`w-4 h-4 flex-shrink-0 text-icon-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        />
                      </>
                    )}
                  </button>
                  <Toggle
                    enabled={isOpen}
                    onChange={(next) => toggleDay(day, next)}
                    aria-label={`${dayLabel} — ${isOpen ? t('facts.hoursOpen') : t('facts.hoursClosed')}`}
                  />
                </div>

                {isExpanded && state.kind === 'allDay' && (
                  <div className="pb-3 flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setSpecificTimes(day)}
                      className="min-h-[44px] text-sm font-medium text-brand-600 hover:text-brand-700"
                    >
                      {t('facts.hoursSetTimes')}
                    </button>
                  </div>
                )}

                {isExpanded && state.kind === 'ranges' && (
                  <div className="pb-3 space-y-2">
                    {state.ranges.map((range, i) => {
                      return (
                        // items-end so the dash and the delete button sit on the
                        // inputs' baseline once the captions push them down.
                        <div key={i} className="flex items-end gap-2">
                          <div className="flex-1 min-w-0">
                            {/* Two bare time boxes and a dash left it to the
                                merchant to guess which is which — worse in RTL,
                                where the visual order flips. Google labels both;
                                so do we. TimeSelect (not the native time input)
                                so the value always reads «09:00» like the
                                summaries — see its doc comment. The accessible
                                name carries the DAY too: seven identical
                                «يفتح» labels are indistinguishable in a
                                screen-reader's controls list. */}
                            <span aria-hidden="true" className="block text-[11px] text-muted-foreground mb-1">
                              {t('facts.hoursFrom')}
                            </span>
                            <TimeSelect
                              value={range.from}
                              onChange={(v) => setRange(day, i, 'from', v)}
                              aria-label={`${dayLabel} — ${t('facts.hoursFrom')}`}
                            />
                          </div>
                          <span aria-hidden="true" className="text-muted-foreground pb-3">–</span>
                          <div className="flex-1 min-w-0">
                            <span aria-hidden="true" className="block text-[11px] text-muted-foreground mb-1">
                              {t('facts.hoursTo')}
                            </span>
                            <TimeSelect
                              value={range.to}
                              onChange={(v) => setRange(day, i, 'to', v)}
                              aria-label={`${dayLabel} — ${t('facts.hoursTo')}`}
                            />
                          </div>
                          {state.ranges.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removePeriod(day, i)}
                              aria-label={`${t('facts.hoursRemovePeriod')} — ${dayLabel} ${i + 1}`}
                              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-red-600"
                            >
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {dayHasOverlap(state) && (
                      <p className="text-xs text-amber-700 dark:text-amber-400" role="alert">
                        {t('facts.hoursOverlap')}
                      </p>
                    )}
                    {/* Split shifts are real here (open morning, close midday,
                        reopen evening) and the storage array already holds them. */}
                    <button
                      type="button"
                      onClick={() => addPeriod(day)}
                      className="min-h-[44px] inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      {t('facts.hoursAddPeriod')}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* The uniform-week fast path: set one day, copy it across. */}
        {sourceDay && (
          <button
            type="button"
            onClick={applyToAll}
            className="mt-4 min-h-[44px] inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            <Copy className="w-4 h-4" aria-hidden="true" />
            {t('facts.hoursApplyToAll', { day: t(`facts.day_${sourceDay}`) })}
          </button>
        )}

        {!hasOpenDay(week) && (
          <p className="text-xs text-amber-700 mt-3" role="status">{t('facts.hoursPickDay')}</p>
        )}

        {/* Timezone is SHOWN, never edited here: it is workspace-level and already
            drives the AI's date awareness + the Post-Reply hours gate. A second
            control would give one value two homes (D-043). */}
        {timezone && (
          <p className="text-xs text-muted-foreground mt-4">
            {/* Show the city, not the IANA id: "Asia/Damascus" → "Damascus". */}
            {t('facts.hoursTimezone', { timezone: timezone.split('/').pop()?.replace(/_/g, ' ') ?? timezone })}{' '}
            {/* Deep-link straight to the timezone control — landing at the top
                of Settings and making the merchant hunt broke the promise the
                link text makes. */}
            <Link href="/settings#business-hours-timezone-label" className="text-brand-600 hover:underline underline-offset-2">
              {t('facts.hoursTimezoneChange')}
            </Link>
          </p>
        )}
      </div>

      {/* A failed save reports HERE: the sheet stays open on failure, and a
          toast would render under this very overlay (toasts cap at z-45). */}
      {saveError && (
        <p role="alert" className="flex-shrink-0 mx-4 lg:mx-5 mb-2 rounded-xl alert-error border px-3 py-2 text-sm">
          {saveError}
        </p>
      )}

      <div className="flex-shrink-0 flex items-center justify-end gap-3 px-4 py-3 pb-safe-modal lg:pb-4 lg:px-5 border-t border-theme-border bg-card">
        <Button variant="secondary" size="sm" onClick={attemptClose} disabled={saving} className="max-sm:h-11">
          {tc('cancel')}
        </Button>
        <Button
          size="sm"
          onClick={submit}
          loading={saving}
          disabled={!valid || !dirty}
          icon={<Check className="w-4 h-4" />}
          className="max-sm:h-11 max-sm:px-6 max-sm:flex-1"
        >
          {tc('save')}
        </Button>
      </div>

      <ConfirmationModal
        isOpen={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={onClose}
        title={tc('discardTitle')}
        message={tc('discardMessage')}
        confirmText={tc('discardConfirm')}
        cancelText={tc('keepEditing')}
        variant="warning"
      />
    </DetailSheet>
  );
}
