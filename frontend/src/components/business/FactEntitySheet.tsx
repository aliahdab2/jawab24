import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, Check, Trash2, Plus } from 'lucide-react';
import { DetailSheet, Button } from '@/components/ui';
import { useEscapeKey } from '@/hooks/useEscapeKey';
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
 * The single-form editor: ONE item on ONE screen — name once, its price and
 * descriptive fields once, its dates as a repeating block — exactly the record
 * the merchant thinks in («اسم الدورة، سعرها، أوقاتها، بدايتها، وصفها»).
 * Storage stays two collections (measured gating/expiry semantics); the save
 * is distributed atomically by PUT /fact-entity.
 *
 * Everything here is derived from the merchant's own lists: the base fields
 * are the base collection's label union, the session fields the dated
 * collection's, the face field the discovered cross-list tier. No hardcoded
 * vocabulary — an outlet directory gets name+area, a size list gets its own
 * columns, and pages with no dated list never see a dates block.
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

  useEscapeKey(onClose, true);

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

  const titleId = 'fact-entity-sheet-title';
  const inputClass =
    'w-full min-h-[44px] rounded-xl border border-theme-border bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500';
  const labelClass = 'block text-sm text-muted-foreground mb-1.5';

  return (
    <DetailSheet
      panelClassName="sm:max-h-[85vh]"
      dialogProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:p-5 border-b border-theme-border flex-shrink-0">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base sm:text-lg font-semibold text-foreground truncate">
            {t('lists.editItem')}
          </h2>
          <p className="text-xs text-muted-foreground truncate" dir="auto">{unit.title}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={tc('close')}
          className="min-h-[44px] min-w-[44px] -me-2 flex items-center justify-center rounded-lg hover:bg-surface-100 text-surface-500"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
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

        {baseCollection && (
          <>
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
            {baseLabels.map((label) => (
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
          </>
        )}

        {sessionCollection && (
          <div>
            <p className="text-sm font-semibold text-foreground mb-2">{t('lists.sessions')}</p>
            <div className="space-y-3">
              {sessions.map((s, i) => (
                <div key={s.rowId ?? `new-${i}`} className="rounded-xl border border-theme-border p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">{i + 1}</span>
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
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setSessions((prev) => [...prev, { values: {}, startsAt: '', endsAt: '' }])}
              className="mt-2 min-h-[36px] inline-flex items-center gap-1 rounded-lg text-xs font-medium text-brand-600 hover:text-brand-700 px-2 -ms-2"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              {t('lists.addSession')}
            </button>
            <p className="mt-1.5 text-xs text-muted-foreground">{t('lists.rowDateHint')}</p>
            {anyDateInvalid && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">{t('lists.dateRangeInvalid')}</p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 pb-safe-modal lg:pb-4 lg:px-5 border-t border-theme-border bg-card">
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
    </DetailSheet>
  );
}
