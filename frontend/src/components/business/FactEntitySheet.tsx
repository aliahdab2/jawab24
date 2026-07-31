import React, { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Trash2, Plus, CalendarClock, ChevronDown } from 'lucide-react';
import { SidePanel, Button } from '@/components/ui';
import { formatCatalogPrice } from '@/utils/priceFormat';
import { formatPlainDate } from '@/utils/dateUtils';
import { useLanguage } from '@/i18n/hooks';
import type { FactCollectionWithRows, FactEntitySaveBody } from '@/lib/api';
import { collectionAttributeLabels, type FactEntityUnit } from '@/utils/factListLayout';

interface SessionDraft {
  /** undefined = a new session authored in this sheet. */
  rowId?: string;
  /** Stable identity for React keys and open/closed state — survives removals. */
  draftKey: string;
  values: Record<string, string>;
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

  const [name, setName] = useState(baseRow?.name ?? unit.sessions[0]?.row.name ?? unit.title);
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
    unit.sessions.map((s) => ({
      rowId: s.row.id,
      draftKey: s.row.id,
      values: Object.fromEntries(
        sessionLabels.map((l) => [l, s.row.attributes?.find((a) => a.label === l)?.value ?? '']),
      ),
      startsAt: s.row.startsAt ?? '',
      // endsAt === startsAt is the one-field era's artifact, not merchant intent.
      endsAt: s.row.endsAt && s.row.endsAt !== s.row.startsAt ? s.row.endsAt : '',
    })),
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
  const newDraftSeq = useRef(0);

  const addSession = () => {
    const draftKey = `new-${++newDraftSeq.current}`;
    setSessions((prev) => [...prev, { draftKey, values: {}, startsAt: '', endsAt: '' }]);
    setOpenSessions((prev) => ({ ...prev, [draftKey]: true }));
  };

  /** Collapsed summary: the session's own values and start date — what the
   *  expert's sketch shows («الأحد والثلاثاء · 12–1 · يبدأ 3 أغسطس»). */
  const sessionSummary = (s: SessionDraft): string => {
    const parts = sessionLabels.map((l) => (s.values[l] ?? '').trim()).filter(Boolean);
    const date = formatPlainDate(s.startsAt || null, intlLocale);
    if (date) parts.push(t('lists.startsOn', { date }));
    return parts.join(' · ');
  };

  const anyDateInvalid = sessions.some(
    (s) => s.startsAt && s.endsAt && s.endsAt < s.startsAt,
  );

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

  const buildBody = (): FactEntitySaveBody => {
    const body: FactEntitySaveBody = { upserts: [], deletes: [] };

    if (baseCollection) {
      const attrs: { label: string; value: string }[] = [];
      if (unit.faceLabel && faceValue.trim()) attrs.push({ label: unit.faceLabel, value: faceValue.trim() });
      for (const l of baseLabels) {
        const v = (baseValues[l] ?? '').trim();
        if (v) attrs.push({ label: l, value: v });
      }
      // An untouched, still-empty base for a session-only entity is not created.
      const baseHasContent = !!(price.trim() || currency.trim() || attrs.length);
      if (baseRow || baseHasContent) {
        body.upserts.push({
          collectionId: baseCollection.id,
          ...(baseRow ? { rowId: baseRow.id } : {}),
          name: name.trim(),
          attributes: attrs.length ? attrs : null,
          price: price.trim() || null,
          currency: currency.trim() || null,
          startsAt: baseRow?.startsAt ?? null,
          endsAt: baseRow?.endsAt ?? null,
        });
      }
    }

    if (sessionCollection) {
      const keyValue = sessionKeyValue();
      for (const s of sessions) {
        const attrs: { label: string; value: string }[] = [];
        if (sessionCollection.keyAttr && keyValue) attrs.push({ label: sessionCollection.keyAttr, value: keyValue });
        if (unit.faceLabel && faceValue.trim()) attrs.push({ label: unit.faceLabel, value: faceValue.trim() });
        for (const l of sessionLabels) {
          const v = (s.values[l] ?? '').trim();
          if (v) attrs.push({ label: l, value: v });
        }
        body.upserts.push({
          collectionId: sessionCollection.id,
          ...(s.rowId ? { rowId: s.rowId } : {}),
          name: name.trim(),
          attributes: attrs.length ? attrs : null,
          price: null,
          currency: null,
          startsAt: s.startsAt || null,
          endsAt: s.endsAt || null,
        });
      }
      body.deletes.push(
        ...removedSessionIds.map((rowId) => ({ collectionId: sessionCollection.id, rowId })),
      );
    }

    return body;
  };

  const submit = () => {
    if (saving || !name.trim() || anyDateInvalid) return;
    const body = buildBody();
    if (body.upserts.length + body.deletes.length === 0) return;
    onSave(body);
  };

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
  const sectionTitleClass =
    'text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-3';

  return (
    <SidePanel isOpen onClose={onClose} title={t('lists.editItem')} subtitle={unit.title}>
      <div className="p-4 sm:p-5 space-y-8 pb-28">
        {/* ————— General ————— */}
        <section aria-label={t('lists.sectionGeneral')}>
          <h3 className={sectionTitleClass}>{t('lists.sectionGeneral')}</h3>
          <div className="space-y-4">
            <div>
              <label htmlFor="entity-name" className={labelClass}>{t('lists.rowName')}</label>
              <input
                id="entity-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                dir={name ? 'auto' : undefined}
                className={inputClass}
              />
            </div>
            {unit.faceLabel && (
              <div>
                <label htmlFor="entity-face" className={labelClass} dir="auto">{unit.faceLabel}</label>
                <input
                  id="entity-face"
                  type="text"
                  value={faceValue}
                  onChange={(e) => setFaceValue(e.target.value)}
                  dir={faceValue ? 'auto' : undefined}
                  className={inputClass}
                />
              </div>
            )}
            {baseCollection && baseLabels.map((label) => (
              <div key={label}>
                <label htmlFor={`entity-base-${label}`} className={labelClass} dir="auto">{label}</label>
                <input
                  id={`entity-base-${label}`}
                  type="text"
                  value={baseValues[label] ?? ''}
                  onChange={(e) => setBaseValues((prev) => ({ ...prev, [label]: e.target.value }))}
                  dir={baseValues[label] ? 'auto' : undefined}
                  className={inputClass}
                />
              </div>
            ))}
          </div>
        </section>

        {/* ————— Pricing — deliberately its own section, never mixed with
                dates (UX review point 2) ————— */}
        {baseCollection && (
          <section aria-label={t('lists.sectionPricing')}>
            <h3 className={sectionTitleClass}>{t('lists.sectionPricing')}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="entity-price" className={labelClass}>{t('lists.rowPrice')}</label>
                <input
                  id="entity-price"
                  type="text"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder={t('lists.rowPriceOptional')}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="entity-currency" className={labelClass}>{t('lists.rowCurrency')}</label>
                <input
                  id="entity-currency"
                  type="text"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  dir={currency ? 'auto' : undefined}
                  placeholder={t('lists.rowCurrencyPlaceholder')}
                  className={inputClass}
                />
              </div>
            </div>
          </section>
        )}

        {/* ————— Dates — each one its own numbered card (point 3) ————— */}
        {sessionCollection && (
          <section aria-label={t('lists.sessions')}>
            <h3 className={sectionTitleClass}>{t('lists.sessions')}</h3>
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
              <div className="space-y-3">
                {sessions.map((s, i) => {
                  const open = !!openSessions[s.draftKey];
                  const summary = sessionSummary(s);
                  return (
                  <div key={s.draftKey} className={`rounded-xl bg-muted/40 ${open ? 'p-3 space-y-3' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      {/* The header is the collapse toggle: a summary line when
                          closed, the plain label when open. Users don't care
                          that it's number 1 — the ordinal appears only once
                          there are peers to tell apart. */}
                      <button
                        type="button"
                        onClick={() => setOpenSessions((prev) => ({ ...prev, [s.draftKey]: !open }))}
                        aria-expanded={open}
                        className={`min-w-0 flex-1 min-h-[40px] flex items-center gap-2 text-start ${open ? '' : 'px-3'}`}
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
                    {open && sessionLabels.map((label) => (
                      <div key={label}>
                        <label htmlFor={`entity-session-${i}-${label}`} className={labelClass} dir="auto">{label}</label>
                        <input
                          id={`entity-session-${i}-${label}`}
                          type="text"
                          value={s.values[label] ?? ''}
                          onChange={(e) =>
                            setSessions((prev) => prev.map((p, j) => (j === i ? { ...p, values: { ...p.values, [label]: e.target.value } } : p)))
                          }
                          dir={s.values[label] ? 'auto' : undefined}
                          className={inputClass}
                        />
                      </div>
                    ))}
                    {open && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor={`entity-session-${i}-start`} className={labelClass}>{t('lists.rowDate')}</label>
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
                    )}
                  </div>
                  );
                })}
                <button
                  type="button"
                  onClick={addSession}
                  className="min-h-[40px] w-full inline-flex items-center justify-center gap-1 rounded-xl border border-dashed border-theme-border text-xs font-semibold text-brand-600 hover:text-brand-700 hover:bg-surface-100"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('lists.addSession')}
                </button>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">{t('lists.rowDateHint')}</p>
            {anyDateInvalid && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">{t('lists.dateRangeInvalid')}</p>
            )}
          </section>
        )}

        {/* Destructive action lives at the END of the form, spatially far from
            Save (round-6 expert point 5: delete beside the primary action is
            dangerous). Two-step confirm as before. */}
        {(baseRow || unit.sessions.length > 0) && (
          <section aria-label={t('lists.deleteEntity')} className="danger-zone rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm danger-zone-text">{t('lists.deleteEntity')}</span>
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
      <div className="sticky bottom-0 inset-x-0 flex items-center gap-3 px-4 py-3 pb-safe-modal lg:pb-4 lg:px-5 border-t border-theme-border bg-card">
        <Button variant="secondary" size="sm" onClick={onClose} className="max-sm:hidden">
          {tc('cancel')}
        </Button>
        {/* The primary action owns the footer (expert point 8): full remaining
            width and a verb that says what it saves, on every viewport. */}
        <Button
          size="sm"
          onClick={submit}
          loading={saving && !confirmingDelete}
          disabled={!name.trim() || anyDateInvalid}
          icon={<Check className="w-4 h-4" />}
          className="flex-1 h-11"
        >
          {t('lists.saveChanges')}
        </Button>
      </div>
    </SidePanel>
  );
}
