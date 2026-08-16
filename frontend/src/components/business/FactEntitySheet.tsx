import React, { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Trash2, Plus, CalendarClock, ChevronDown, CalendarDays, Clock, Calendar, Tag, Banknote, AlignLeft } from 'lucide-react';
import { MAX_FACT_ATTR_VALUE_LENGTH, type FactStructuredFieldValue, type FactStructuredValues } from '@jawab24/shared';
import { SidePanel, Button, Select, InfoPopover } from '@/components/ui';
import { formatCatalogPrice } from '@/utils/priceFormat';
import { formatPlainDate } from '@/utils/dateUtils';
import {
  classifyCollectionField, weekdayInfo, parseWeekdays, formatWeekdays,
  formatTimeRangeStorage, durationMinutes, structuredDisplay, parseTimeRangeGuess,
  timeOptions, generationLocale, type ScheduleFieldKind,
} from '@/utils/factScheduleFields';
import { useLanguage } from '@/i18n/hooks';
import { normalizeForGrouping } from '@/utils/factListGrouping';
import type { FactCollectionWithRows, FactEntitySaveBody } from '@/lib/api';
import { collectionAttributeLabels, sessionValueKind, unitHasSchedules, type FactEntityUnit } from '@/utils/factListLayout';
import { ValueLengthFeedback, factValueTooLong } from './ValueLengthFeedback';

interface SessionDraft {
  /** undefined = a new session authored in this sheet. */
  rowId?: string;
  /** Stable identity for React keys and open/closed state — survives removals. */
  draftKey: string;
  values: Record<string, string>;
  /** Structured drafts per label — the write-back contract's machine half.
   *  On save the STRING is regenerated from these; they ride along as shadow. */
  structured: Record<string, FactStructuredFieldValue | null>;
  /** Per-label escape hatch: true = the merchant edits raw text for this
   *  field, and no shadow is written. */
  freeText: Record<string, boolean>;
  /** Labels whose structured draft is an UNCONFIRMED automatic read of the
   *  stored text (recognition over recall) — flagged in the UI; touching the
   *  control clears the flag, saving confirms it. */
  guessed: Record<string, boolean>;
  startsAt: string;
  endsAt: string;
}

interface FactEntitySheetProps {
  unit: FactEntityUnit;
  /** Where the base row lives (or would live) — the first undated collection. */
  baseCollection: FactCollectionWithRows | null;
  saving: boolean;
  onSave: (body: FactEntitySaveBody) => void;
  onClose: () => void;
}

/**
 * The single-form editor, laid out the way the UX review asked (2026-07-31):
 * a SIDE PANEL on desktop (the cards stay visible — no context switch, expert
 * point 6), full sheet on mobile; the form split into labelled sections —
 * General / Pricing / Dates — so pricing is never visually entangled with
 * scheduling (points 2, 7, 11); each date is its own numbered card with its
 * own delete (point 3).
 *
 * Storage stays two collections (measured gating/expiry semantics); saving
 * distributes atomically via PUT /fact-entity. Everything is derived from the
 * merchant's own lists — no hardcoded vocabulary.
 */
export function FactEntitySheet({
  unit,
  baseCollection,
  saving,
  onSave,
  onClose,
}: FactEntitySheetProps) {
  const t = useTranslations('business');
  const tc = useTranslations('common');
  const { intlLocale } = useLanguage();

  const sessionCollection = unit.sessionCollection;
  /**
   * What to call the dated half of this item — the merchant's OWN list name
   * («مواعيد الدورات المعلنة», «عروض موسمية», «مواسم الحصاد»), never a noun we
   * chose for them. A fixed «المواعيد» reads as an appointment book, which is
   * one vertical's meaning of a date among many (owner ruling 2026-08-10: this
   * page must fit ANY business). `lists.sessions` survives only as the fallback
   * for the impossible case of a dated collection with no label.
   */
  const datesSectionLabel = sessionCollection?.label?.trim() || t('lists.sessions');
  const baseRow = unit.base?.row ?? null;

  /** Labels that get dedicated treatment and must not appear as free fields. */
  const reserved = (c: FactCollectionWithRows | null): Set<string> => {
    const s = new Set<string>();
    if (c?.keyAttr) s.add(c.keyAttr);
    if (unit.faceLabel) s.add(unit.faceLabel);
    return s;
  };

  const baseLabels = baseCollection
    ? collectionAttributeLabels(baseCollection).filter((l) => !reserved(baseCollection).has(l))
    : [];
  const sessionLabels = sessionCollection
    ? collectionAttributeLabels(sessionCollection).filter((l) => !reserved(sessionCollection).has(l))
    : [];

  /** What each session field IS — derived from the merchant's own rows
   *  (existing shadows, else majority value shape), never from label words. */
  const fieldKinds = useMemo<Record<string, ScheduleFieldKind>>(
    () => Object.fromEntries(sessionLabels.map((l) => [
      l, sessionCollection ? classifyCollectionField(sessionCollection, l) : 'other',
    ])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionCollection],
  );

  /** One consistent time list for the pickers — Intl labels, same everywhere. */
  const pickerOptions = useMemo(() => timeOptions(intlLocale), [intlLocale]);

  /** Stored-string generation locale per field — follows the DATA's script,
   *  not the viewer's UI language (the byte-contract). */
  const genLocale = (label: string): string =>
    sessionCollection ? generationLocale(sessionCollection, label, intlLocale) : intlLocale;

  /** Initial per-label control state for one session (never guesses into
   *  storage): a stored shadow wins; a COMPLETELY parseable weekday string
   *  seeds the chips; a value the control can't represent starts on the
   *  free-text escape hatch; ambiguous times start empty and keep the string. */
  const seedField = (
    kind: ScheduleFieldKind,
    value: string,
    shadow: FactStructuredFieldValue | undefined,
  ): { structured: FactStructuredFieldValue | null; freeText: boolean; guessed: boolean } => {
    if (shadow) return { structured: shadow, freeText: false, guessed: false };
    if (kind === 'weekday') {
      const days = value ? parseWeekdays(value) : null;
      if (days) return { structured: { kind: 'weekdays', days }, freeText: false, guessed: false };
      return { structured: null, freeText: !!value.trim(), guessed: false };
    }
    if (kind === 'time') {
      // Recognition over recall (round-8): a parseable range PREFILLS the
      // pickers as a flagged guess. Guarded upstream: the guess only exists
      // when it regenerates the stored string byte-identically.
      const guess = value ? parseTimeRangeGuess(value) : null;
      if (guess) return { structured: { kind: 'timeRange', ...guess }, freeText: false, guessed: true };
      return { structured: null, freeText: !!value.trim() && sessionValueKind(value) !== 'time', guessed: false };
    }
    return { structured: null, freeText: false, guessed: false };
  };

  /** The entity's name as loaded — the reference for detecting a real rename,
   *  so an untouched save never rewrites session names (they may be shared
   *  with sibling tiers that carry a different name). */
  const originalName = baseRow?.name ?? unit.sessions[0]?.row.name ?? unit.title;
  const [name, setName] = useState(originalName);
  const [faceValue, setFaceValue] = useState(unit.faceValue ?? '');
  const [price, setPrice] = useState(baseRow?.price ? formatCatalogPrice(baseRow.price) : '');
  const [currency, setCurrency] = useState(baseRow?.currency ?? '');
  const [baseValues, setBaseValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const l of baseLabels) {
      v[l] = baseRow?.attributes?.find((a) => a.label === l)?.value ?? '';
    }
    return v;
  });
  const [sessions, setSessions] = useState<SessionDraft[]>(() =>
    unit.sessions.map((s) => {
      const values = Object.fromEntries(
        sessionLabels.map((l) => [l, s.row.attributes?.find((a) => a.label === l)?.value ?? '']),
      );
      const structured: Record<string, FactStructuredFieldValue | null> = {};
      const freeText: Record<string, boolean> = {};
      const guessed: Record<string, boolean> = {};
      for (const l of sessionLabels) {
        const seeded = seedField(fieldKinds[l], values[l] ?? '', s.row.structured?.[l]);
        structured[l] = seeded.structured;
        freeText[l] = seeded.freeText;
        guessed[l] = seeded.guessed;
      }
      return {
        rowId: s.row.id,
        draftKey: s.row.id,
        values,
        structured,
        freeText,
        guessed,
        startsAt: s.row.startsAt ?? '',
        // endsAt === startsAt is the one-field era's artifact, not merchant intent.
        endsAt: s.row.endsAt && s.row.endsAt !== s.row.startsAt ? s.row.endsAt : '',
      };
    }),
  );
  const [removedSessionIds, setRemovedSessionIds] = useState<string[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Sessions render as summary lines and expand on demand (round-6 expert
  // point 4) — EXCEPT a lone session (nothing to scan past, keep it editable
  // in one tap) and sessions authored in this sheet (they're being typed).
  const [openSessions, setOpenSessions] = useState<Record<string, boolean>>(() =>
    unit.sessions.length === 1 && unit.sessions[0]
      ? { [unit.sessions[0].row.id]: true }
      : {},
  );
  // Notion-model property rows (round 9): each field is a thin
  // «name · value» row that expands IN PLACE to its editing control.
  const [openProps, setOpenProps] = useState<Record<string, boolean>>({});
  const toggleProp = (key: string) =>
    setOpenProps((prev) => ({ ...prev, [key]: !prev[key] }));

  const newDraftSeq = useRef(0);

  const addSession = () => {
    const draftKey = `new-${++newDraftSeq.current}`;
    setSessions((prev) => [...prev, { draftKey, values: {}, structured: {}, freeText: {}, guessed: {}, startsAt: '', endsAt: '' }]);
    setOpenSessions((prev) => ({ ...prev, [draftKey]: true }));
    // A fresh session is being AUTHORED — its rows open ready to fill;
    // existing sessions keep the dense collapsed rows.
    setOpenProps((prev) => {
      const next = { ...prev };
      for (const l of sessionLabels) if (fieldKinds[l] !== 'other') next[`s:${draftKey}:${l}`] = true;
      next[`s:${draftKey}:dates`] = true;
      return next;
    });
  };

  /** A label may render its rich DISPLAY form only when EVERY session showing
   *  a value for it has the structured draft — one row in «12:00–1:00 ظهرًا»
   *  next to four in «1-2» reads as broken, not as migration (round-8:
   *  consistency beats richness). */
  const labelUniformlyStructured = (label: string): boolean =>
    sessions.every((s) => {
      const v = (s.values[label] ?? '').trim();
      if (!v) return true;
      return !s.freeText[label] && !!s.structured[label];
    });

  /** Collapsed summary: the session's own values and start date. Structured
   *  fields render their DISPLAY form here («12:00–1:00 ظهرًا») — presentation
   *  need not mimic the storage format; the stored string stays «12-1». */
  const sessionSummary = (s: SessionDraft): string => {
    const parts = sessionLabels
      .map((l) => {
        const sv = !s.freeText[l] && labelUniformlyStructured(l) ? s.structured[l] : null;
        return (sv ? structuredDisplay(sv, intlLocale) : null) ?? (s.values[l] ?? '').trim();
      })
      .filter(Boolean);
    const date = formatPlainDate(s.startsAt || null, intlLocale);
    if (date) parts.push(t('lists.startsOn', { date }));
    return parts.join(t('lists.listSeparator'));
  };

  /** The write-back contract, applied at save time: an ACTIVE control owns its
   *  field — the stored string is regenerated from the structured draft and
   *  the draft rides along as shadow. Everything else stores exactly what the
   *  text field says, with no shadow. Time controls left empty keep the
   *  original string (we never guess «12-1» into clock times). */
  const resolveSessionField = (
    s: SessionDraft,
    label: string,
  ): { value: string; shadow: FactStructuredFieldValue | null } => {
    const raw = (s.values[label] ?? '').trim();
    if (s.freeText[label]) return { value: raw, shadow: null };
    const sv = s.structured[label];
    if (sv?.kind === 'weekdays') {
      return sv.days.length
        ? { value: formatWeekdays(sv.days, genLocale(label)), shadow: sv }
        : { value: '', shadow: null };
    }
    if (sv?.kind === 'timeRange') {
      const generated = formatTimeRangeStorage(sv.start, sv.end);
      if (generated) return { value: generated, shadow: sv };
    }
    return { value: raw, shadow: null };
  };

  const anyDateInvalid = sessions.some(
    (s) => s.startsAt && s.endsAt && s.endsAt < s.startsAt,
  );

  /** Over-limit guard, counted on exactly what buildBody would SEND
   *  (resolveSessionField / trim), never on raw draft state — a stale long
   *  draft behind an active structured control is not sent, so it must not
   *  block the save either. Fields say so inline (ValueLengthFeedback) and
   *  Save is disabled on the same predicate. */
  const anyValueTooLong =
    factValueTooLong(faceValue) ||
    baseLabels.some((l) => factValueTooLong(baseValues[l] ?? '')) ||
    sessions.some((s) => sessionLabels.some((l) => factValueTooLong(resolveSessionField(s, l).value)));

  /** The session key value carried over to every session row: whatever the
   *  existing sessions already use, so gating keeps finding them. */
  const sessionKeyValue = (): string | null => {
    if (!sessionCollection?.keyAttr) return null;
    for (const s of unit.sessions) {
      const v = s.row.attributes?.find((a) => a.label === sessionCollection.keyAttr)?.value;
      if (v) return v;
    }
    return null;
  };

  const setFieldStructured = (i: number, label: string, sv: FactStructuredFieldValue | null) =>
    setSessions((prev) => prev.map((p, j) => (
      j === i
        ? { ...p, structured: { ...p.structured, [label]: sv }, guessed: { ...p.guessed, [label]: false } }
        : p
    )));

  /** Toggle the escape hatch; entering free text prefills the input with the
   *  string the control was generating, so nothing visibly changes. */
  const setFieldFreeText = (i: number, label: string, ft: boolean, prefill?: string) =>
    setSessions((prev) => prev.map((p, j) => (
      j === i
        ? {
            ...p,
            freeText: { ...p.freeText, [label]: ft },
            values: prefill !== undefined ? { ...p.values, [label]: prefill } : p.values,
          }
        : p
    )));

  const buildBody = (): FactEntitySaveBody => {
    const body: FactEntitySaveBody = { upserts: [], deletes: [] };
    const trimmedName = name.trim();
    const nameEdited = trimmedName !== originalName;

    if (baseCollection) {
      // The server replaces the row WHOLESALE, so this must reconstruct the
      // COMPLETE attribute list. Labels this form gives dedicated treatment or
      // does not display — the collection's key attribute above all (المنطقة
      // on an outlet directory, الدورة on an online-courses list) — are
      // carried through from the original row in their original position;
      // dropping them detaches the row from its group and from reply-time
      // gating (shipped that way once: a no-op save wiped the key).
      const managed = new Set<string>([...(unit.faceLabel ? [unit.faceLabel] : []), ...baseLabels]);
      const managedValue = (label: string): string =>
        label === unit.faceLabel ? faceValue.trim() : (baseValues[label] ?? '').trim();
      const attrs: { label: string; value: string }[] = [];
      const originalAttrs = baseRow?.attributes ?? [];
      for (const a of originalAttrs) {
        if (!managed.has(a.label)) {
          attrs.push({ label: a.label, value: a.value });
          continue;
        }
        const v = managedValue(a.label);
        if (v) attrs.push({ label: a.label, value: v });
      }
      for (const label of managed) {
        if (originalAttrs.some((a) => a.label === label)) continue;
        const v = managedValue(label);
        if (v) attrs.push({ label, value: v });
      }
      // A NEW base row in a keyed collection gets its key from the sessions
      // when both collections share the key label — the only value known to
      // keep the entity joined.
      if (!baseRow && baseCollection.keyAttr && !attrs.some((a) => a.label === baseCollection.keyAttr)) {
        const kv = sessionCollection?.keyAttr === baseCollection.keyAttr ? sessionKeyValue() : null;
        if (kv) attrs.unshift({ label: baseCollection.keyAttr, value: kv });
      }
      // An untouched, still-empty base for a session-only entity is not created.
      const baseHasContent = !!(price.trim() || currency.trim() || attrs.length);
      if (baseRow || baseHasContent) {
        body.upserts.push({
          collectionId: baseCollection.id,
          ...(baseRow ? { rowId: baseRow.id } : {}),
          name: trimmedName,
          attributes: attrs.length ? attrs : null,
          structured: baseRow?.structured ?? null,
          price: price.trim() || null,
          currency: currency.trim() || null,
          startsAt: baseRow?.startsAt ?? null,
          endsAt: baseRow?.endsAt ?? null,
          isAvailable: baseRow?.isAvailable ?? true,
        });
      }
    }

    if (sessionCollection) {
      const keyValue = sessionKeyValue();
      for (const s of sessions) {
        const original = s.rowId ? unit.sessions.find((u) => u.row.id === s.rowId)?.row : undefined;
        const attrs: { label: string; value: string }[] = [];
        const shadows: FactStructuredValues = {};
        if (sessionCollection.keyAttr && keyValue) attrs.push({ label: sessionCollection.keyAttr, value: keyValue });
        if (unit.faceLabel && faceValue.trim()) attrs.push({ label: unit.faceLabel, value: faceValue.trim() });
        for (const l of sessionLabels) {
          const { value, shadow } = resolveSessionField(s, l);
          if (value) attrs.push({ label: l, value });
          if (shadow) shadows[l] = shadow;
        }
        body.upserts.push({
          collectionId: sessionCollection.id,
          ...(s.rowId ? { rowId: s.rowId } : {}),
          // Sessions can be SHARED with sibling tiers under a different name
          // (the form edits one tier). An existing session keeps its own name;
          // it follows a rename only when it carried the entity's original
          // name — so opening tier B and saving never renames tier A's rows.
          // Compared with the SAME folding the card is grouped by: an exact
          // match would leave a variant-spelled session («دوره» vs «دورة»)
          // behind on rename, splitting the entity it visibly belongs to.
          name: original
            ? (nameEdited && normalizeForGrouping(original.name) === normalizeForGrouping(originalName)
              ? trimmedName
              : original.name)
            : trimmedName,
          attributes: attrs.length ? attrs : null,
          structured: Object.keys(shadows).length ? shadows : null,
          price: original?.price ?? null,
          currency: original?.currency ?? null,
          startsAt: s.startsAt || null,
          endsAt: s.endsAt || null,
          isAvailable: original?.isAvailable ?? true,
        });
      }
      body.deletes.push(
        ...removedSessionIds.map((rowId) => ({ collectionId: sessionCollection.id, rowId })),
      );
    }

    return body;
  };

  const submit = () => {
    if (saving || !name.trim() || anyDateInvalid || anyValueTooLong) return;
    const body = buildBody();
    if (body.upserts.length + body.deletes.length === 0) return;
    onSave(body);
  };

  /** The list this row lives in — see the SidePanel title below. */
  const headerTitle = baseCollection?.label ?? sessionCollection?.label ?? t('lists.editItem');
  /** Does this entity carry schedule rows? One named answer, so every piece of
   *  copy that promises date behaviour asks the same question (shared predicate
   *  in factListLayout — see its doc for why this differs from
   *  `sessionCollection`, which asks whether dates are POSSIBLE here). */
  const hasSchedules = unitHasSchedules(unit);
  const deleteLabel = t(hasSchedules ? 'lists.deleteEntity' : 'lists.deleteEntityPlain');

  const deleteEntity = () => {
    const body: FactEntitySaveBody = { upserts: [], deletes: [] };
    if (baseRow && baseCollection) body.deletes.push({ collectionId: baseCollection.id, rowId: baseRow.id });
    if (sessionCollection) {
      for (const s of unit.sessions) body.deletes.push({ collectionId: sessionCollection.id, rowId: s.row.id });
    }
    if (body.deletes.length === 0) return;
    onSave(body);
  };

  // Inputs keep their border (the affordance); everything else sheds one —
  // section titles are type-only and session cards are background-only, so
  // the form stops reading as a grid of competing boxes (expert point 6).
  const inputClass =
    'w-full min-h-[44px] rounded-xl border border-theme-border bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500';
  const labelClass = 'block text-sm text-muted-foreground mb-1.5';

  /** Collapsed row value for a session field — rich display when structured,
   *  the raw string otherwise. */
  const fieldDisplay = (s: SessionDraft, label: string): string => {
    const raw = (s.values[label] ?? '').trim();
    if (s.freeText[label]) return raw;
    const sv = s.structured[label];
    if (sv?.kind === 'weekdays') return sv.days.length ? formatWeekdays(sv.days, intlLocale) : '';
    if (sv?.kind === 'timeRange') return structuredDisplay(sv, intlLocale) ?? raw;
    return raw;
  };
  const datesDisplay = (s: SessionDraft): string => {
    const a = formatPlainDate(s.startsAt || null, intlLocale);
    const b = formatPlainDate(s.endsAt || null, intlLocale);
    return a ? (b ? `${a} – ${b}` : a) : '';
  };

  /** One Notion-style property row: a small TYPE ICON + name (start, muted),
   *  the value (or a light «فارغ») filling the rest — no divider lines, no
   *  chevron; hover background is the affordance, and the control expands in
   *  place with Notion's quick fade-slide. */
  const propertyRow = (
    key: string,
    rowName: string,
    icon: React.ReactNode,
    value: React.ReactNode | null,
    children: React.ReactNode,
    flag?: React.ReactNode,
  ) => {
    const openP = !!openProps[key];
    return (
      <div key={key}>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => toggleProp(key)}
            aria-expanded={openP}
            className="min-w-0 flex-1 min-h-[38px] flex items-center gap-2 px-1.5 py-1 rounded-lg text-start hover:bg-muted/50 transition-colors"
          >
            <span className="w-28 flex-none flex items-center gap-1.5 min-w-0">
              <span className="flex-none text-icon-muted" aria-hidden="true">{icon}</span>
              <span className="min-w-0 text-sm text-muted-foreground truncate" dir="auto">{rowName}</span>
            </span>
            <span className="min-w-0 flex-1 text-sm break-words text-foreground" dir="auto">
              {value}
            </span>
          </button>
          {flag}
        </div>
        {openP && (
          <div className="px-1.5 pb-3 pt-1 animate-in fade-in slide-in-from-top-1 duration-150">
            {children}
          </div>
        )}
      </div>
    );
  };

  /** Notion multi-select look: selected days as small tinted chips in the
   *  collapsed row value. */
  const dayChips = (days: number[]): React.ReactNode => (
    <span className="flex flex-wrap gap-1">
      {weekdayInfo(intlLocale)
        .filter((d) => days.includes(d.index))
        .map((d) => (
          <span key={d.index} className="px-1.5 py-0.5 rounded bg-brand-500/10 text-brand-700 dark:text-brand-300 text-xs font-medium">
            {d.long}
          </span>
        ))}
    </span>
  );

  return (
    <SidePanel
      isOpen
      onClose={onClose}
      // The header names WHERE the merchant is (the list), not WHAT they are
      // doing: they tapped a row and its card opened, so «تعديل العنصر» in
      // 18px bold restated the obvious and pushed the real context — which
      // list this row belongs to — into 12px muted (owner catch, 2026-08-04).
      // The item's own name is the borderless title inside the form, so it is
      // never lost. Falls back to the generic label only when no collection
      // reached us (defensive: every open path passes one today).
      title={headerTitle}
      // …and never echoes it: on a directory list the unit IS the collection,
      // so the old subtitle repeated the new title verbatim.
      subtitle={unit.title === headerTitle ? undefined : unit.title}
      // The date rule («جواب stops quoting a dated row…») explains a mechanic
      // this item doesn't have when it carries no schedule rows — and the same
      // hint already sits inside each date card, where it applies (owner catch,
      // 2026-08-04). Header hint only when the sheet can actually hold dates.
      headerExtra={sessionCollection
        ? <InfoPopover label={datesSectionLabel}>{t('lists.rowDateHint')}</InfoPopover>
        : undefined}
    >
      <div className="p-4 sm:p-5 space-y-6 pb-28">
        {/* ————— Notion model (round 9): a borderless TITLE, then thin
                property rows that expand in place ————— */}
        <section aria-label={t('lists.sectionGeneral')}>
          <input
            id="entity-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={t('lists.rowName')}
            placeholder={t('lists.rowName')}
            dir={name ? 'auto' : undefined}
            className="w-full bg-transparent border-0 p-0 text-2xl font-bold text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-0"
          />
        </section>

        <div className="space-y-0.5">
          {unit.faceLabel && propertyRow(
            'base:face',
            unit.faceLabel,
            <Tag className="w-3.5 h-3.5" />,
            faceValue.trim() || null,
            <>
              <input
                id="entity-face"
                type="text"
                value={faceValue}
                onChange={(e) => setFaceValue(e.target.value)}
                aria-label={unit.faceLabel}
                aria-invalid={factValueTooLong(faceValue) || undefined}
                aria-describedby="entity-face-length"
                dir={faceValue ? 'auto' : undefined}
                className={inputClass}
              />
              <ValueLengthFeedback value={faceValue} fieldId="entity-face" />
            </>,
          )}
          {baseCollection && propertyRow(
            'base:price',
            t('lists.rowPrice'),
            <Banknote className="w-3.5 h-3.5" />,
            price.trim()
              ? `${Number(price) ? Number(price).toLocaleString(intlLocale) : price.trim()}${currency.trim() ? ` ${currency.trim()}` : ''}`
              : null,
            // Compact inline editor — a number and a currency word don't need a
            // full-width row (owner). 16px text stays (iOS zoom rule).
            <div className="flex gap-2">
              <input
                id="entity-price"
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                aria-label={t('lists.rowPrice')}
                placeholder={t('lists.rowPrice')}
                className={`${inputClass} !min-h-[38px] !w-36 flex-none`}
              />
              <input
                id="entity-currency"
                type="text"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                dir={currency ? 'auto' : undefined}
                aria-label={t('lists.rowCurrency')}
                placeholder={t('lists.rowCurrency')}
                className={`${inputClass} !min-h-[38px] !w-32 flex-none`}
              />
            </div>,
          )}
        </div>

        {/* ————— Dates — each one its own numbered card (point 3) ————— */}
        {sessionCollection && (
          <section aria-label={datesSectionLabel}>
            {sessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-theme-border px-4 py-6 text-center">
                <CalendarClock className="w-6 h-6 mx-auto text-icon-muted" aria-hidden="true" />
                <p className="mt-2 text-sm text-muted-foreground">{t('lists.noSessions')}</p>
                <button
                  type="button"
                  onClick={addSession}
                  className="mt-3 min-h-[36px] inline-flex items-center gap-1 rounded-lg bg-brand-500/10 px-3 text-xs font-semibold text-brand-700 dark:text-brand-300 hover:bg-brand-500/20"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('lists.addFirstSession')}
                </button>
              </div>
            ) : (
              <div className="space-y-0.5">
                {sessions.map((s, i) => {
                  const open = !!openSessions[s.draftKey];
                  const summary = sessionSummary(s);
                  return (
                  <div key={s.draftKey}>
                    <div className="flex items-center gap-1">
                      {/* Notion toggle block: chevron + summary line, children
                          indent under a light start-edge rule — no gray box. */}
                      <button
                        type="button"
                        onClick={() => setOpenSessions((prev) => ({ ...prev, [s.draftKey]: !open }))}
                        aria-expanded={open}
                        className="min-w-0 flex-1 min-h-[36px] flex items-center gap-2 px-1.5 rounded-lg text-start hover:bg-muted/50 transition-colors"
                      >
                        <ChevronDown
                          className={`w-3.5 h-3.5 flex-shrink-0 text-icon-muted transition-transform ${open ? '' : 'ltr:-rotate-90 rtl:rotate-90'}`}
                          aria-hidden="true"
                        />
                        {open || !summary ? (
                          <span className="text-xs font-bold text-foreground">
                            {sessions.length === 1 ? t('lists.sessionSingle') : t('lists.sessionN', { n: i + 1 })}
                          </span>
                        ) : (
                          <span className="min-w-0 text-sm text-foreground truncate" dir="auto">{summary}</span>
                        )}
                      </button>
                      {open && (
                      <button
                        type="button"
                        onClick={() => {
                          if (s.rowId) setRemovedSessionIds((prev) => [...prev, s.rowId as string]);
                          setSessions((prev) => prev.filter((_, j) => j !== i));
                        }}
                        aria-label={t('lists.removeSession')}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                      )}
                    </div>
                    {open && (
                    <div className="ms-[13px] border-s border-theme-border/50 ps-3 pt-1 pb-2 space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="space-y-0.5">
                    {sessionLabels.filter((l) => fieldKinds[l] !== 'other').map((label) => {
                      const kind = fieldKinds[label];
                      const ft = !!s.freeText[label];
                      const sv = s.structured[label];
                      const fieldId = `entity-session-${i}-${label}`;
                      const rowKey = `s:${s.draftKey}:${label}`;
                      const switchLink = (toFree: boolean, prefill?: string) => (
                        <button
                          type="button"
                          onClick={() => setFieldFreeText(i, label, toFree, toFree ? prefill : undefined)}
                          className="mt-1 text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 whitespace-nowrap"
                        >
                          {toFree
                            ? t('lists.useFreeText')
                            : t(kind === 'weekday' ? 'lists.useStructuredDays' : 'lists.useStructuredTime')}
                        </button>
                      );
                      const flag = s.guessed[label] && sv ? (
                        <span className="flex-none text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                          {t('lists.autofilledFlag')}
                        </span>
                      ) : undefined;

                      const kindIcon = kind === 'weekday'
                        ? <CalendarDays className="w-3.5 h-3.5" />
                        : <Clock className="w-3.5 h-3.5" />;

                      if (ft) {
                        return propertyRow(rowKey, label, kindIcon, (s.values[label] ?? '').trim() || null, (
                          <>
                            <input
                              id={fieldId}
                              type="text"
                              value={s.values[label] ?? ''}
                              onChange={(e) =>
                                setSessions((prev) => prev.map((p, j) => (j === i ? { ...p, values: { ...p.values, [label]: e.target.value } } : p)))
                              }
                              aria-label={label}
                              aria-invalid={factValueTooLong(s.values[label] ?? '') || undefined}
                              aria-describedby={`${fieldId}-length`}
                              dir={s.values[label] ? 'auto' : undefined}
                              className={inputClass}
                            />
                            <ValueLengthFeedback value={s.values[label] ?? ''} fieldId={fieldId} />
                            {switchLink(false)}
                          </>
                        ));
                      }

                      if (kind === 'weekday') {
                        const days = sv?.kind === 'weekdays' ? sv.days : [];
                        const generated = days.length ? formatWeekdays(days, genLocale(label)) : null;
                        return propertyRow(rowKey, label, kindIcon, days.length ? dayChips(days) : (fieldDisplay(s, label) || null), (
                          <>
                            <span id={fieldId} role="group" aria-label={label} className="flex flex-wrap gap-1.5">
                              {weekdayInfo(intlLocale).map((d) => {
                                const on = days.includes(d.index);
                                return (
                                  <button
                                    key={d.index}
                                    type="button"
                                    aria-pressed={on}
                                    aria-label={d.long}
                                    onClick={() => {
                                      const next = on
                                        ? days.filter((x) => x !== d.index)
                                        : [...days, d.index].sort((a, b) => a - b);
                                      setFieldStructured(i, label, { kind: 'weekdays', days: next });
                                    }}
                                    className={`min-h-[36px] px-3 rounded-full text-xs transition-all ${
                                      on
                                        ? 'bg-brand-600 text-white font-semibold shadow-sm'
                                        : 'bg-card border border-theme-border text-muted-foreground hover:bg-surface-100'
                                    }`}
                                  >
                                    {d.long}
                                  </button>
                                );
                              })}
                            </span>
                            {switchLink(true, generated ?? s.values[label] ?? '')}
                          </>
                        ));
                      }

                      // kind === 'time'
                      const start = sv?.kind === 'timeRange' ? sv.start : '';
                      const end = sv?.kind === 'timeRange' ? sv.end : '';
                      const setTime = (part: 'start' | 'end', v: string) => {
                        const next: FactStructuredFieldValue = {
                          kind: 'timeRange',
                          start: part === 'start' ? v : start,
                          end: part === 'end' ? v : end,
                        };
                        setFieldStructured(i, label, next.start || next.end ? next : null);
                      };
                      const storage = start && end ? formatTimeRangeStorage(start, end) : null;
                      const dur = start && end ? durationMinutes(start, end) : null;
                      const durText = dur === null ? null : (() => {
                        const h = Math.floor(dur / 60);
                        const m = dur % 60;
                        if (h && m) return t('lists.durationBoth', { h: t('lists.durationHours', { count: h }), m: t('lists.durationMinutes', { count: m }) });
                        return h ? t('lists.durationHours', { count: h }) : t('lists.durationMinutes', { count: m });
                      })();
                      return propertyRow(rowKey, label, kindIcon, fieldDisplay(s, label) || null, (
                        <>
                          <span className="grid grid-cols-2 gap-2">
                            <span>
                              <span id={`${fieldId}-from-label`} className="block text-xs text-muted-foreground mb-1">{t('lists.timeFrom')}</span>
                              <Select
                                value={start}
                                onChange={(v) => setTime('start', v)}
                                options={pickerOptions}
                                placeholder={t('lists.timePick')}
                                aria-labelledby={`${fieldId}-from-label`}
                              />
                            </span>
                            <span>
                              <span id={`${fieldId}-to-label`} className="block text-xs text-muted-foreground mb-1">{t('lists.timeTo')}</span>
                              <Select
                                value={end}
                                onChange={(v) => setTime('end', v)}
                                options={pickerOptions}
                                placeholder={t('lists.timePick')}
                                aria-labelledby={`${fieldId}-to-label`}
                              />
                            </span>
                          </span>
                          <span className="block min-h-[40px] mt-1.5 space-y-0.5">
                            {s.guessed[label] && storage && (
                              <p className="text-xs text-amber-700 dark:text-amber-400" dir="auto">
                                {t('lists.autofilledHint')}
                              </p>
                            )}
                            {!storage && (s.values[label] ?? '').trim() && (
                              <p className="text-xs text-muted-foreground" dir="auto">
                                {t('lists.timeCurrentText', { text: (s.values[label] ?? '').trim() })}
                              </p>
                            )}
                            {storage && !s.guessed[label] && (
                              <p className="text-xs text-muted-foreground" dir="auto">
                                {t('lists.previewLabel', { text: storage })}
                              </p>
                            )}
                            {durText && (
                              <p className="text-xs text-muted-foreground">{t('lists.durationLabel', { d: durText })}</p>
                            )}
                          </span>
                          {switchLink(true, storage ?? s.values[label] ?? '')}
                        </>
                      ), flag);
                    })}
                    {propertyRow(`s:${s.draftKey}:dates`, t('lists.rowDate'), <Calendar className="w-3.5 h-3.5" />, datesDisplay(s) || null, (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label htmlFor={`entity-session-${i}-start`} className="block text-sm text-muted-foreground mb-1.5">{t('lists.rowDate')}</label>
                          <input
                            id={`entity-session-${i}-start`}
                            type="date"
                            value={s.startsAt}
                            onChange={(e) => setSessions((prev) => prev.map((p, j) => (j === i ? { ...p, startsAt: e.target.value } : p)))}
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label htmlFor={`entity-session-${i}-end`} className={labelClass}>{t('lists.rowEndDate')}</label>
                          <input
                            id={`entity-session-${i}-end`}
                            type="date"
                            value={s.endsAt}
                            min={s.startsAt || undefined}
                            onChange={(e) => setSessions((prev) => prev.map((p, j) => (j === i ? { ...p, endsAt: e.target.value } : p)))}
                            aria-invalid={(s.startsAt && s.endsAt && s.endsAt < s.startsAt) || undefined}
                            className={inputClass}
                          />
                        </div>
                      </div>
                    ), (
                      <InfoPopover label={t('lists.rowDate')}>{t('lists.rowDateHint')}</InfoPopover>
                    ))}
                    </div>
                    {sessionLabels.filter((l) => fieldKinds[l] === 'other').map((label) => propertyRow(
                      `s:${s.draftKey}:note:${label}`,
                      label,
                      <AlignLeft className="w-3.5 h-3.5" />,
                      (s.values[label] ?? '').trim()
                        ? <span className="block truncate" dir="auto">{(s.values[label] ?? '').trim()}</span>
                        : null,
                      <>
                        <textarea
                          id={`entity-session-${i}-${label}`}
                          value={s.values[label] ?? ''}
                          onChange={(e) =>
                            setSessions((prev) => prev.map((p, j) => (j === i ? { ...p, values: { ...p.values, [label]: e.target.value } } : p)))
                          }
                          aria-label={label}
                          aria-invalid={factValueTooLong(s.values[label] ?? '') || undefined}
                          aria-describedby={`entity-session-${i}-${label}-length`}
                          dir={s.values[label] ? 'auto' : undefined}
                          rows={2}
                          placeholder={t('lists.notePlaceholder')}
                          className={`${inputClass} !min-h-[64px] py-2 resize-y`}
                        />
                        <ValueLengthFeedback value={s.values[label] ?? ''} fieldId={`entity-session-${i}-${label}`} />
                      </>,
                    ))}
                    </div>
                    )}
                  </div>
                  );
                })}
                <button
                  type="button"
                  onClick={addSession}
                  className="w-full min-h-[36px] flex items-center gap-2 px-1.5 rounded-lg text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors text-start"
                >
                  <Plus className="w-4 h-4 text-icon-muted" aria-hidden="true" />
                  {t('lists.addSession')}
                </button>
              </div>
            )}
            {anyDateInvalid && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">{t('lists.dateRangeInvalid')}</p>
            )}
          </section>
        )}

        {/* The Notion body: merchant free-text lives at the BOTTOM as an open
            canvas, not a boxed field (owner: «الملاحظة آخر شي ونكبر الإدخال»). */}
        {baseCollection && baseLabels.length > 0 && (
          <div className="space-y-0.5">
            {baseLabels.map((label) => propertyRow(
              `base:note:${label}`,
              label,
              <AlignLeft className="w-3.5 h-3.5" />,
              (baseValues[label] ?? '').trim()
                ? <span className="block truncate" dir="auto">{(baseValues[label] ?? '').trim()}</span>
                : null,
              <>
                <textarea
                  id={`entity-base-${label}`}
                  value={baseValues[label] ?? ''}
                  onChange={(e) => setBaseValues((prev) => ({ ...prev, [label]: e.target.value }))}
                  aria-label={label}
                  aria-invalid={factValueTooLong(baseValues[label] ?? '') || undefined}
                  aria-describedby={`entity-base-${label}-length`}
                  dir={baseValues[label] ? 'auto' : undefined}
                  rows={3}
                  placeholder={t('lists.notePlaceholder')}
                  className={`${inputClass} !min-h-[88px] py-2.5 resize-y`}
                />
                <ValueLengthFeedback value={baseValues[label] ?? ''} fieldId={`entity-base-${label}`} />
              </>,
            ))}
          </div>
        )}

        {/* Destructive action lives at the END of the form, spatially far from
            Save (round-6 expert point 5: delete beside the primary action is
            dangerous). Two-step confirm as before. */}
        {/* «ومواعيده» only when schedule rows actually ride along — on a plain
            price row it claimed dates that don't exist (owner catch, 2026-08-04). */}
        {(baseRow || hasSchedules) && (
          <section aria-label={deleteLabel} className="danger-zone rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm danger-zone-text">{deleteLabel}</span>
            {confirmingDelete ? (
              <Button variant="danger" size="sm" onClick={deleteEntity} loading={saving}>
                {t('lists.deleteEntityConfirm')}
              </Button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border danger-zone-btn px-3 text-sm font-semibold"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                {tc('delete')}
              </button>
            )}
          </section>
        )}
      </div>

      {/* Sticky footer inside the panel's scroll area */}
      <div className="sticky bottom-0 inset-x-0 px-4 py-3 pb-safe-modal lg:pb-4 lg:px-5 border-t border-theme-border bg-card">
        {/* Why Save is dead, said WHERE the merchant is looking: the offending
            field can sit inside a collapsed row, so its inline alert alone can
            leave a mysteriously disabled button. */}
        {anyValueTooLong && (
          <p role="alert" className="mb-2 text-xs text-red-600 dark:text-red-400">
            {t('lists.valueTooLong', { max: MAX_FACT_ATTR_VALUE_LENGTH })}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={onClose} className="max-sm:hidden">
            {tc('cancel')}
          </Button>
          {/* The primary action owns the footer (expert point 8): full remaining
              width and a verb that says what it saves, on every viewport. */}
          <Button
            size="sm"
            onClick={submit}
            loading={saving && !confirmingDelete}
            disabled={!name.trim() || anyDateInvalid || anyValueTooLong}
            icon={<Check className="w-4 h-4" />}
            className="flex-1 h-11"
          >
            {t('lists.saveChanges')}
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}
