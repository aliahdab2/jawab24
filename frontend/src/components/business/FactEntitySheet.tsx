import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Trash2, Plus, CalendarClock } from 'lucide-react';
import { SidePanel, Button } from '@/components/ui';
import { formatCatalogPrice } from '@/utils/priceFormat';
import type { FactCollectionWithRows, FactEntitySaveBody } from '@/lib/api';
import { collectionAttributeLabels, type FactEntityUnit } from '@/utils/factListLayout';

interface SessionDraft {
  /** undefined = a new session authored in this sheet. */
  rowId?: string;
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

  const inputClass =
    'w-full min-h-[44px] rounded-xl border border-theme-border bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500';
  const labelClass = 'block text-sm text-muted-foreground mb-1.5';
  const sectionTitleClass =
    'text-[11px] font-bold uppercase tracking-wide text-muted-foreground border-b border-theme-border pb-1.5 mb-4';

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
                  onClick={() => setSessions([{ values: {}, startsAt: '', endsAt: '' }])}
                  className="mt-3 min-h-[36px] inline-flex items-center gap-1 rounded-lg bg-brand-500/10 px-3 text-xs font-semibold text-brand-700 dark:text-brand-300 hover:bg-brand-500/20"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('lists.addFirstSession')}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {sessions.map((s, i) => (
                  <div key={s.rowId ?? `new-${i}`} className="rounded-xl bg-muted/40 border border-theme-border/60 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-foreground">{t('lists.sessionN', { n: i + 1 })}</span>
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
                    </div>
                    {sessionLabels.map((label) => (
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
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setSessions((prev) => [...prev, { values: {}, startsAt: '', endsAt: '' }])}
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
      </div>

      {/* Sticky footer inside the panel's scroll area */}
      <div className="sticky bottom-0 inset-x-0 flex items-center gap-3 px-4 py-3 pb-safe-modal lg:pb-4 lg:px-5 border-t border-theme-border bg-card">
        {(baseRow || unit.sessions.length > 0) && (
          confirmingDelete ? (
            <Button variant="danger" size="sm" onClick={deleteEntity} loading={saving} className="max-sm:h-11">
              {t('lists.deleteEntityConfirm')}
            </Button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              aria-label={t('lists.deleteEntity')}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-red-600"
            >
              <Trash2 className="w-5 h-5" aria-hidden="true" />
            </button>
          )
        )}
        <span className="flex-1" />
        <Button variant="secondary" size="sm" onClick={onClose} className="max-sm:hidden">
          {tc('cancel')}
        </Button>
        <Button
          size="sm"
          onClick={submit}
          loading={saving && !confirmingDelete}
          disabled={!name.trim() || anyDateInvalid}
          icon={<Check className="w-4 h-4" />}
          className="max-sm:h-11 max-sm:px-6 max-sm:flex-1"
        >
          {tc('save')}
        </Button>
      </div>
    </SidePanel>
  );
}
