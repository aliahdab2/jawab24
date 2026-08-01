import React, { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { X, Check, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { DetailSheet, Button, WhatsAppIcon, ConfirmationModal } from '@/components/ui';
import { VoiceRecordButton } from '@/components/knowledge-base/VoiceRecordButton';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useTextareaAutoResize } from '@/hooks/useTextareaAutoResize';

/** Facts editable through the single-field sheet. `hours` is NOT here — it is a
 *  structured Record<day, ranges[]> and needs the Phase-D day/range editor. */
export type EditableFactKey = 'address' | 'phone' | 'website' | 'delivery' | 'payment';

/** Multi-line facts get a textarea; the rest a single-line input. `address`
 *  is here because a real one runs long — «دمشق، البرامكة، فوق مكتبة الحافظ،
 *  الطابق الأول» does not fit a single line on a 390px screen, and a merchant
 *  should be able to see the whole thing while editing it. */
const MULTILINE: ReadonlyArray<EditableFactKey> = ['address', 'delivery', 'payment'];

/** Facts that offer voice input — every free-text field. The mic APPENDS, and
 *  with the textarea auto-growing the merchant sees exactly what landed and
 *  can edit it in place — which is why `address` (the longest free text in
 *  the section) is included despite being a value one usually corrects rather
 *  than composes. */
const VOICE: ReadonlyArray<EditableFactKey> = ['address', 'delivery', 'payment'];

/**
 * One-tap answers for facts where "no" is itself a real customer answer.
 *
 * Not every field applies to every merchant — an online-only store has no
 * branch, a walk-in shop may not deliver, most local merchants have a page
 * rather than a website. The tempting fix is to hide those rows, but a hidden
 * field tells the AI NOTHING: `formatBusinessInfoPrompt` renders an absent
 * policy as [NOT_PROVIDED], i.e. "unknown", so a customer asking «بتوصلوا؟»
 * gets "I don't have that information" instead of a plain no. Recording the
 * negative turns a nag into an answer, greens the readiness chip, and needs
 * no schema change — it is just the fact, stated.
 *
 * The preset FILLS the field; it never locks it. The merchant can edit the
 * wording, which matters because these are their words to their customers.
 *
 * A preset states ONE negative and stops. It must not append a second fact the
 * merchant never gave us: "we do not deliver" was once "…— pickup only", which
 * asserts a shop to collect from. That is false for an online-only or a service
 * business, and it can flatly contradict the address preset («متجر إلكتروني —
 * لا يوجد فرع») on the same page. Whatever this text says goes verbatim into
 * BUSINESS_INFO and is then told to customers as fact, so the safe form is the
 * bare negative — the merchant adds the pickup detail themselves if it is true.
 */
const PRESETS: Partial<Record<EditableFactKey, readonly string[]>> = {
  address: ['presetOnlineOnly'],
  delivery: ['presetNoDelivery'],
  website: ['presetNoWebsite'],
};

/** Facts that hold MULTIPLE values — rendered as one input per value. */
const MULTI: ReadonlyArray<EditableFactKey> = ['phone'];

const INPUT_MODE: Partial<Record<EditableFactKey, 'tel' | 'url' | 'text'>> = {
  phone: 'tel',
  website: 'url',
};

/** `type="tel"` (not just `inputMode`) so mobile keyboards, autofill and
 *  password managers all treat the field as a phone number. `website` stays
 *  `text` + `inputMode="url"` on purpose: `type="url"` rejects bare
 *  «example.com» in some browsers, and merchants paste exactly that. */
const INPUT_TYPE: Partial<Record<EditableFactKey, 'tel'>> = { phone: 'tel' };

/**
 * Structured first-fill for facts whose free-text prompt used to ask three
 * questions in one box («هل توصّل؟ إلى أين، وكم التكلفة والمدة؟») — merchants
 * answered by restating the field name inside the value. The intake asks one
 * question at a time and COMPOSES the same plain text the free path saves, so
 * the stored shape, the prompt block and the AI see no new format. Shown only
 * while the fact is EMPTY: existing text can't be parsed back into fields, so
 * editing stays free-text.
 */
const PAYMENT_METHODS = ['cash', 'shamcash', 'transfer', 'card'] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

interface BusinessFactSheetProps {
  factKey: EditableFactKey;
  /** Localized field label — the sheet title. */
  label: string;
  initialValue: string;
  /** `phone` only: which listed numbers are on WhatsApp. Legacy data may hold
   *  a single string — any subset of the numbers is valid. */
  initialWhatsapp?: string | string[];
  /** A connected store already answers this fact — writing here is an override. */
  storeAnswered?: boolean;
  saving: boolean;
  /** `whatsapp` is passed for `phone` only — the numbers flagged in the sheet. */
  onSave: (value: string, whatsapp?: string[]) => void;
  onClose: () => void;
}

/** Digits-and-plus view of a number, for duplicate detection only — never for
 *  storage. «0911 22 33 44» and «0911-223344» are the same SIM. */
const normalizePhone = (v: string) => v.replace(/[^\d+]/g, '');

/**
 * Single-field bottom sheet for editing one business fact (B1 part 2).
 *
 * Mobile-first by design (owner directive 2026-07-25: «التعديل سهل ومريح على
 * الجوال» — most merchants use the app): ONE field per sheet, a 44px+ save
 * button, and voice input, so filling a fact is a two-tap job instead of a
 * hunt through a 16k-char free-text editor. Built on `DetailSheet`, which
 * already handles the keyboard-height offset — never hand-roll that (see the
 * `--keyboard-height` single-writer rule in AI_INSTRUCTIONS).
 */
export function BusinessFactSheet({
  factKey,
  label,
  initialValue,
  initialWhatsapp,
  storeAnswered = false,
  saving,
  onSave,
  onClose,
}: BusinessFactSheetProps) {
  const t = useTranslations('business');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [value, setValue] = useState(initialValue);
  const isMulti = MULTI.includes(factKey);

  // Repeatable facts arrive joined ("a, b"); split into rows so the merchant
  // never types a separator. Always keep at least one row to type into.
  // Each row carries its own WhatsApp flag: any number can be on WhatsApp,
  // independently of the others — the old single-mark model made tapping the
  // badge on one number silently clear it from another (radio semantics the
  // merchant never asked for).
  const [entries, setEntries] = useState<{ value: string; wa: boolean }[]>(() => {
    const wa = (Array.isArray(initialWhatsapp) ? initialWhatsapp : initialWhatsapp ? [initialWhatsapp] : [])
      .map((n) => n.trim())
      .filter(Boolean);
    const parts = initialValue.split(/[,،]/).map((p) => p.trim()).filter(Boolean);
    const rows = parts.map((p) => ({ value: p, wa: wa.includes(p) }));
    return rows.length ? rows : [{ value: '', wa: false }];
  });

  /** Two-tap delete: first tap arms this row, second executes. A number is one
   *  mistap from gone otherwise — same pattern as `ListRowSheet`'s footer. */
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);

  // ── Structured first-fill (delivery / payment) ────────────────────────────
  const canIntake = (factKey === 'delivery' || factKey === 'payment') && !initialValue.trim();
  /** Escape hatch out of the intake into the plain textarea. */
  const [freeText, setFreeText] = useState(false);
  const intake = canIntake && !freeText;
  const [deliveryAnswer, setDeliveryAnswer] = useState<'yes' | null>(null);
  const [deliveryAreas, setDeliveryAreas] = useState('');
  const [deliveryCost, setDeliveryCost] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('');
  const [payMethods, setPayMethods] = useState<ReadonlySet<PaymentMethod>>(new Set());
  const [payNote, setPayNote] = useState('');

  const isMultiline = MULTILINE.includes(factKey);
  const hasVoice = VOICE.includes(factKey);
  const inputId = `fact-${factKey}`;

  // Address runs ~3 lines, policies ~4 — same floors the fixed `rows` gave,
  // but the box now grows with the text instead of clipping it mid-line.
  const { ref: textareaRef, autoResize } = useTextareaAutoResize(factKey === 'address' ? 72 : 96, 320);
  useEffect(() => {
    if (isMultiline && !isMulti && !intake) autoResize();
  }, [isMultiline, isMulti, intake, autoResize]);

  const joined = entries.map((e) => e.value.trim()).filter(Boolean).join(', ');
  const waList = entries.filter((e) => e.wa && e.value.trim()).map((e) => e.value.trim());
  const initialWaList = useMemo(() => {
    const wa = (Array.isArray(initialWhatsapp) ? initialWhatsapp : initialWhatsapp ? [initialWhatsapp] : [])
      .map((n) => n.trim())
      .filter(Boolean);
    // Only marks on numbers the sheet can show count as the baseline — a
    // legacy mark on an unlisted number is not representable here and would
    // otherwise hold the sheet permanently dirty.
    const listed = initialValue.split(/[,،]/).map((p) => p.trim()).filter(Boolean);
    return wa.filter((n) => listed.includes(n));
  }, [initialWhatsapp, initialValue]);

  /** Same SIM typed twice — blocks Save and marks the later row. Without this
   *  a duplicate also renders the WhatsApp mark on both copies in the row list. */
  const duplicateIndexes = useMemo(() => {
    const dup = new Set<number>();
    const seen = new Set<string>();
    entries.forEach((e, i) => {
      const n = normalizePhone(e.value);
      if (!n) return;
      if (seen.has(n)) dup.add(i);
      else seen.add(n);
    });
    return dup;
  }, [entries]);
  const hasDuplicates = isMulti && duplicateIndexes.size > 0;

  const listFormat = useMemo(
    () => new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }),
    [locale],
  );

  /** The intake composes the SAME plain text the free path saves. */
  const composed = (): string => {
    if (factKey === 'delivery') {
      if (deliveryAnswer !== 'yes') return '';
      const lines = [t('facts.deliveryYesLine')];
      if (deliveryAreas.trim()) lines.push(`${t('facts.deliveryAreasLabel')}: ${deliveryAreas.trim()}`);
      if (deliveryCost.trim()) lines.push(`${t('facts.deliveryCostLabel')}: ${deliveryCost.trim()}`);
      if (deliveryTime.trim()) lines.push(`${t('facts.deliveryTimeLabel')}: ${deliveryTime.trim()}`);
      return lines.join('\n');
    }
    const methods = PAYMENT_METHODS.filter((m) => payMethods.has(m)).map((m) => t(`facts.pay_${m}`));
    const lines: string[] = [];
    if (methods.length) lines.push(`${t('facts.paymentLine')}: ${listFormat.format(methods)}`);
    if (payNote.trim()) lines.push(payNote.trim());
    return lines.join('\n');
  };

  const dirty = isMulti
    ? joined !== initialValue.trim()
      || JSON.stringify([...waList].sort()) !== JSON.stringify([...initialWaList].sort())
    : intake
      ? composed().trim() !== ''
      : value.trim() !== initialValue.trim();

  // ── Close guard: typed-but-unsaved edits never vanish on a stray tap ─────
  const [confirmClose, setConfirmClose] = useState(false);
  const attemptClose = () => {
    if (dirty && !saving) setConfirmClose(true);
    else onClose();
  };
  // While the discard confirm is up, ITS Esc handling wins — otherwise one
  // keypress closes the confirm and this hook instantly re-opens it.
  useEscapeKey(attemptClose, !confirmClose);

  const addEntry = () => {
    setConfirmingDelete(null);
    setEntries((prev) => [...prev, { value: '', wa: false }]);
  };

  const removeEntry = (i: number) => {
    setConfirmingDelete(null);
    setEntries((prev) => prev.filter((_, j) => j !== i));
  };

  const setEntryValue = (i: number, v: string) => {
    setConfirmingDelete(null);
    setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, value: v } : e)));
  };

  const toggleWa = (i: number) =>
    setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, wa: !e.wa } : e)));

  /** Leave the intake for the plain textarea, carrying anything already typed. */
  const switchToFreeText = () => {
    const drafted = composed();
    if (drafted) setValue(drafted);
    setFreeText(true);
  };

  const submit = () => {
    if (saving || !dirty || hasDuplicates) return;
    if (isMulti) onSave(joined, waList);
    else if (intake) onSave(composed().trim());
    else onSave(value.trim());
  };

  const intakeFieldClass =
    'w-full min-h-[44px] rounded-xl border border-theme-border bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <DetailSheet
      fitContent
      onSwipeDismiss={attemptClose}
      panelClassName="sm:max-h-[70vh]"
      dialogProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': `${inputId}-title` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:p-5 border-b border-theme-border flex-shrink-0">
        <h2 id={`${inputId}-title`} className="text-base sm:text-lg font-semibold text-foreground">
          {label}
        </h2>
        <button
          type="button"
          onClick={attemptClose}
          aria-label={tc('close')}
          className="min-h-[44px] min-w-[44px] -me-2 flex items-center justify-center rounded-lg hover:bg-surface-100 text-surface-500"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">
        {/* The intake carries its own question text; a second generic hint
            above it would ask the merchant the same thing twice. */}
        {!intake && (
          <label
            // In multi mode no single input owns the id, so the htmlFor would
            // dangle; the per-row inputs carry their own aria-labels.
            htmlFor={isMulti ? undefined : inputId}
            className="block text-sm text-muted-foreground mb-2"
          >
            {t(`facts.hint_${factKey}`)}
          </label>
        )}

        {/* Only while empty: once the merchant has written an override, telling
            them the store also answers is noise. */}
        {storeAnswered && !value.trim() && (
          <p className="mb-3 rounded-xl bg-muted border border-theme-border px-3 py-2 text-xs text-muted-foreground">
            {t('facts.storeAnsweredHint')}
          </p>
        )}

        {isMulti ? (
          /* Repeatable values (phone): one input per number — a merchant should
             never have to remember a separator. Joined with ", " on save; the
             page splits it back into the `phones` array. */
          <div className="space-y-3">
            {entries.map((e, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    type={INPUT_TYPE[factKey] ?? 'text'}
                    inputMode={INPUT_MODE[factKey] ?? 'text'}
                    value={e.value}
                    onChange={(ev) => setEntryValue(i, ev.target.value)}
                    onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addEntry(); } }}
                    dir={e.value ? 'auto' : undefined}
                    autoFocus={i === 0}
                    placeholder={t(`facts.placeholder_${factKey}`)}
                    aria-label={`${label} ${i + 1}`}
                    aria-invalid={duplicateIndexes.has(i) || undefined}
                    className={clsx(
                      'flex-1 min-w-0 min-h-[44px] rounded-xl border bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500',
                      duplicateIndexes.has(i) ? 'border-red-400 dark:border-red-700' : 'border-theme-border',
                    )}
                  />
                  {entries.length > 1 && (
                    confirmingDelete === i ? (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => removeEntry(i)}
                        className="flex-shrink-0"
                      >
                        {t('facts.deleteNumberConfirm')}
                      </Button>
                    ) : (
                      <button
                        type="button"
                        // An empty row holds nothing to lose; a filled one arms
                        // first (two-tap) so a number is never one mistap from
                        // gone — nothing here is undoable before Save.
                        onClick={() => (e.value.trim() ? setConfirmingDelete(i) : removeEntry(i))}
                        aria-label={`${tc('delete')} ${label} ${i + 1}`}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )
                  )}
                </div>
                {duplicateIndexes.has(i) && (
                  <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                    {t('facts.duplicateNumber')}
                  </p>
                )}
                {/* A real checkbox, not a status pill: each number carries its
                    own independent flag, and the box makes "this is tappable"
                    visible — the old badge read as a label. */}
                <label
                  className={clsx(
                    'min-h-[36px] inline-flex items-center gap-1.5 rounded-full ps-2.5 pe-3 text-xs font-medium border transition select-none focus-within:ring-2 focus-within:ring-brand-500',
                    !e.value.trim()
                      ? 'opacity-40'
                      : 'cursor-pointer',
                    e.wa
                      ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 border-brand-500'
                      : 'bg-card text-muted-foreground border-theme-border hover:bg-surface-100',
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={e.wa}
                    disabled={!e.value.trim()}
                    onChange={() => toggleWa(i)}
                    aria-label={`${t('facts.phoneIsWhatsapp')} — ${label} ${i + 1}`}
                  />
                  <span
                    aria-hidden="true"
                    className={clsx(
                      'flex h-4 w-4 items-center justify-center rounded border',
                      e.wa ? 'bg-brand-600 border-brand-600 text-white' : 'border-theme-border bg-card',
                    )}
                  >
                    {e.wa && <Check className="w-3 h-3" />}
                  </span>
                  <WhatsAppIcon size={14} aria-hidden="true" />
                  {t('facts.phoneIsWhatsapp')}
                </label>
              </div>
            ))}
            <button
              type="button"
              onClick={addEntry}
              className="min-h-[44px] inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              {t(`facts.addAnother_${factKey}`)}
            </button>
          </div>
        ) : intake && factKey === 'delivery' ? (
          /* First fill: one question at a time instead of three in one box. */
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">{t('facts.deliveryQuestion')}</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('facts.deliveryQuestion')}>
              <button
                type="button"
                aria-pressed={deliveryAnswer === 'yes'}
                onClick={() => setDeliveryAnswer('yes')}
                className={clsx(
                  'min-h-[44px] rounded-full border px-4 text-sm font-medium transition',
                  deliveryAnswer === 'yes'
                    ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 border-brand-500'
                    : 'bg-card text-muted-foreground border-theme-border hover:bg-surface-100',
                )}
              >
                {t('facts.deliveryYes')}
              </button>
              <button
                type="button"
                onClick={() => { setValue(t('facts.presetNoDelivery')); setFreeText(true); }}
                className="min-h-[44px] rounded-full border border-theme-border bg-card px-4 text-sm font-medium text-muted-foreground hover:bg-surface-100"
              >
                {t('facts.deliveryNo')}
              </button>
            </div>
            {deliveryAnswer === 'yes' && (
              <div className="space-y-3">
                <div>
                  <label htmlFor={`${inputId}-areas`} className="block text-sm text-muted-foreground mb-1.5">
                    {t('facts.deliveryAreasLabel')}
                  </label>
                  <input
                    id={`${inputId}-areas`}
                    type="text"
                    value={deliveryAreas}
                    onChange={(ev) => setDeliveryAreas(ev.target.value)}
                    dir={deliveryAreas ? 'auto' : undefined}
                    autoFocus
                    placeholder={t('facts.deliveryAreasPlaceholder')}
                    className={intakeFieldClass}
                  />
                </div>
                <div>
                  <label htmlFor={`${inputId}-cost`} className="block text-sm text-muted-foreground mb-1.5">
                    {t('facts.deliveryCostLabel')}
                  </label>
                  <input
                    id={`${inputId}-cost`}
                    type="text"
                    value={deliveryCost}
                    onChange={(ev) => setDeliveryCost(ev.target.value)}
                    dir={deliveryCost ? 'auto' : undefined}
                    placeholder={t('facts.deliveryCostPlaceholder')}
                    className={intakeFieldClass}
                  />
                </div>
                <div>
                  <label htmlFor={`${inputId}-time`} className="block text-sm text-muted-foreground mb-1.5">
                    {t('facts.deliveryTimeLabel')}
                  </label>
                  <input
                    id={`${inputId}-time`}
                    type="text"
                    value={deliveryTime}
                    onChange={(ev) => setDeliveryTime(ev.target.value)}
                    dir={deliveryTime ? 'auto' : undefined}
                    placeholder={t('facts.deliveryTimePlaceholder')}
                    className={intakeFieldClass}
                  />
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={switchToFreeText}
              className="min-h-[44px] text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              {t('facts.freeTextInstead')}
            </button>
          </div>
        ) : intake && factKey === 'payment' ? (
          /* First fill: the accepted methods as toggles, not prose structure
             the merchant has to invent («طرق الدفع كاش بالمركز او عن طريق شام
             كاش» — the field name restated inside its own value). */
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">{t('facts.paymentQuestion')}</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('facts.paymentQuestion')}>
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={payMethods.has(m)}
                  onClick={() =>
                    setPayMethods((prev) => {
                      const next = new Set(prev);
                      if (next.has(m)) next.delete(m);
                      else next.add(m);
                      return next;
                    })}
                  className={clsx(
                    'min-h-[44px] rounded-full border px-4 text-sm font-medium transition',
                    payMethods.has(m)
                      ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 border-brand-500'
                      : 'bg-card text-muted-foreground border-theme-border hover:bg-surface-100',
                  )}
                >
                  {payMethods.has(m) && <Check className="w-3.5 h-3.5 inline-block me-1" aria-hidden="true" />}
                  {t(`facts.pay_${m}`)}
                </button>
              ))}
            </div>
            <div>
              <label htmlFor={`${inputId}-note`} className="block text-sm text-muted-foreground mb-1.5">
                {t('facts.paymentNoteLabel')}
              </label>
              <input
                id={`${inputId}-note`}
                type="text"
                value={payNote}
                onChange={(ev) => setPayNote(ev.target.value)}
                dir={payNote ? 'auto' : undefined}
                placeholder={t('facts.paymentNotePlaceholder')}
                className={intakeFieldClass}
              />
            </div>
            <button
              type="button"
              onClick={switchToFreeText}
              className="min-h-[44px] text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              {t('facts.freeTextInstead')}
            </button>
          </div>
        ) : isMultiline ? (
          <div className="flex items-start gap-2">
            <textarea
              ref={textareaRef}
              id={inputId}
              value={value}
              onChange={(e) => { setValue(e.target.value); autoResize(); }}
              dir={value ? 'auto' : undefined}
              rows={factKey === 'address' ? 3 : 4}
              autoFocus
              placeholder={t(`facts.placeholder_${factKey}`)}
              // resize-none: the box tracks its content by itself; a manual
              // drag handle on top of that fights the auto height.
              className="flex-1 min-w-0 rounded-xl border border-theme-border bg-card px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
            {hasVoice && (
              <VoiceRecordButton
                onTranscribed={(text) => setValue((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))}
                disabled={saving}
              />
            )}
          </div>
        ) : (
          <input
            id={inputId}
            type="text"
            inputMode={INPUT_MODE[factKey] ?? 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            dir={value ? 'auto' : undefined}
            autoFocus
            placeholder={t(`facts.placeholder_${factKey}`)}
            className="w-full rounded-xl border border-theme-border bg-card px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        )}

        {/* Shown only while the field is EMPTY: a shortcut for the merchant who
            has nothing to put here because the fact does not apply to them —
            never a suggestion layered over something they already wrote. The
            delivery intake hides it: its «لا نوصّل» button IS this preset. */}
        {!isMulti && !intake && !value.trim() && PRESETS[factKey] && (
          <div className="mt-3 flex flex-wrap gap-2">
            {PRESETS[factKey]!.map((presetKey) => (
              <button
                key={presetKey}
                type="button"
                onClick={() => { setValue(t(`facts.${presetKey}`)); autoResize(); }}
                className="min-h-[36px] rounded-full border border-theme-border bg-card px-3 text-xs font-medium text-muted-foreground hover:bg-surface-100 hover:text-foreground"
              >
                {t(`facts.${presetKey}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex items-center justify-end gap-3 px-4 py-3 pb-safe-modal lg:pb-4 lg:px-5 border-t border-theme-border bg-card">
        <Button variant="secondary" size="sm" onClick={attemptClose} className="max-sm:h-11">
          {tc('cancel')}
        </Button>
        <Button
          size="sm"
          onClick={submit}
          loading={saving}
          disabled={!dirty || hasDuplicates}
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
