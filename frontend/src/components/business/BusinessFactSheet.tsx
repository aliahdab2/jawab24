import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, Check, Plus, Trash2 } from 'lucide-react';
import { DetailSheet, Button, WhatsAppIcon } from '@/components/ui';
import { VoiceRecordButton } from '@/components/knowledge-base/VoiceRecordButton';
import { useEscapeKey } from '@/hooks/useEscapeKey';

/** Facts editable through the single-field sheet. `hours` is NOT here — it is a
 *  structured Record<day, ranges[]> and needs the Phase-D day/range editor. */
export type EditableFactKey = 'address' | 'phone' | 'website' | 'delivery' | 'payment';

/** Multi-line facts get a textarea; the rest a single-line input. `address`
 *  is here because a real one runs long — «دمشق، البرامكة، فوق مكتبة الحافظ،
 *  الطابق الأول» does not fit a single line on a 390px screen, and a merchant
 *  should be able to see the whole thing while editing it. */
const MULTILINE: ReadonlyArray<EditableFactKey> = ['address', 'delivery', 'payment'];

/** Facts that offer voice input — free-text ONLY. Kept separate from MULTILINE
 *  on purpose: the mic APPENDS, which is right when composing a paragraph and
 *  wrong when correcting a structured value like an address (dictating a new
 *  one would concatenate it onto the old). */
const VOICE: ReadonlyArray<EditableFactKey> = ['delivery', 'payment'];

/**
 * One-tap answers for facts where "no" is itself a real customer answer.
 *
 * Not every field applies to every merchant — an online-only store has no
 * branch, a walk-in shop may not deliver. The tempting fix is to hide those
 * rows, but a hidden field tells the AI NOTHING: `formatBusinessInfoPrompt`
 * renders an absent policy as [NOT_PROVIDED], i.e. "unknown", so a customer
 * asking «بتوصلوا؟» gets "I don't have that information" instead of a plain
 * no. Recording the negative turns a nag into an answer, greens the readiness
 * chip, and needs no schema change — it is just the fact, stated.
 *
 * The preset FILLS the field; it never locks it. The merchant can edit the
 * wording, which matters because these are their words to their customers.
 */
const PRESETS: Partial<Record<EditableFactKey, readonly string[]>> = {
  address: ['presetOnlineOnly'],
  delivery: ['presetNoDelivery'],
};

/** Facts that hold MULTIPLE values — rendered as one input per value. */
const MULTI: ReadonlyArray<EditableFactKey> = ['phone'];

const INPUT_MODE: Partial<Record<EditableFactKey, 'tel' | 'url' | 'text'>> = {
  phone: 'tel',
  website: 'url',
};

interface BusinessFactSheetProps {
  factKey: EditableFactKey;
  /** Localized field label — the sheet title. */
  label: string;
  initialValue: string;
  /** `phone` only: which of the numbers is the merchant's WhatsApp, if any. */
  initialWhatsapp?: string;
  saving: boolean;
  /** `whatsapp` is passed for `phone` only — the number flagged in the sheet. */
  onSave: (value: string, whatsapp?: string) => void;
  onClose: () => void;
}

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
  saving,
  onSave,
  onClose,
}: BusinessFactSheetProps) {
  const t = useTranslations('business');
  const tc = useTranslations('common');
  const [value, setValue] = useState(initialValue);
  const isMulti = MULTI.includes(factKey);
  // Repeatable facts arrive joined ("a, b"); split into rows so the merchant
  // never types a separator. Always keep at least one row to type into.
  const [values, setValues] = useState<string[]>(() => {
    const parts = initialValue.split(/[,،]/).map((p) => p.trim()).filter(Boolean);
    return parts.length ? parts : [''];
  });
  // Which number is on WhatsApp. In this market it is nearly always one of the
  // numbers the merchant already listed — a separate field made them type the
  // same digits twice and keep two copies in sync. `channels.whatsapp` holds a
  // single value, so the flag is exclusive.
  const [waIndex, setWaIndex] = useState<number>(() => {
    const wa = initialWhatsapp?.trim();
    if (!wa) return -1;
    return values.findIndex((v) => v.trim() === wa);
  });

  useEscapeKey(onClose, true);

  const isMultiline = MULTILINE.includes(factKey);
  const hasVoice = VOICE.includes(factKey);
  const inputId = `fact-${factKey}`;
  const joined = values.map((v) => v.trim()).filter(Boolean).join(', ');
  const whatsapp = waIndex >= 0 ? values[waIndex]?.trim() || undefined : undefined;
  const dirty = isMulti
    ? joined !== initialValue.trim() || whatsapp !== (initialWhatsapp?.trim() || undefined)
    : value.trim() !== initialValue.trim();

  const addValue = () => setValues((prev) => [...prev, '']);

  const removeValue = (i: number) => {
    setValues((prev) => prev.filter((_, j) => j !== i));
    // Keep the flag pinned to the same NUMBER, not the same slot.
    setWaIndex((prev) => (prev === i ? -1 : prev > i ? prev - 1 : prev));
  };

  const submit = () => {
    if (saving) return;
    if (isMulti) onSave(joined, whatsapp);
    else onSave(value.trim());
  };

  return (
    <DetailSheet
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
          onClick={onClose}
          aria-label={tc('close')}
          className="min-h-[44px] min-w-[44px] -me-2 flex items-center justify-center rounded-lg hover:bg-surface-100 text-surface-500"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">
        <label htmlFor={inputId} className="block text-sm text-muted-foreground mb-2">
          {t(`facts.hint_${factKey}`)}
        </label>

        {isMulti ? (
          /* Repeatable values (phone): one input per number — a merchant should
             never have to remember a separator. Joined with ", " on save; the
             page splits it back into the `phones` array. */
          <div className="space-y-3">
            {values.map((v, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode={INPUT_MODE[factKey] ?? 'text'}
                    value={v}
                    onChange={(e) => setValues((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addValue(); } }}
                    dir={v ? 'auto' : undefined}
                    autoFocus={i === 0}
                    placeholder={t(`facts.placeholder_${factKey}`)}
                    aria-label={`${label} ${i + 1}`}
                    className="flex-1 min-w-0 min-h-[44px] rounded-xl border border-theme-border bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  {values.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeValue(i)}
                      aria-label={`${tc('delete')} ${label} ${i + 1}`}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                {/* Marking the number rather than re-entering it: a merchant's
                    WhatsApp is nearly always a SIM they already listed. */}
                <button
                  type="button"
                  onClick={() => setWaIndex((prev) => (prev === i ? -1 : i))}
                  disabled={!v.trim()}
                  aria-pressed={waIndex === i}
                  className={`min-h-[36px] inline-flex items-center gap-1.5 rounded-full ps-2 pe-3 text-xs font-medium border transition disabled:opacity-40 ${
                    waIndex === i
                      ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 border-brand-500'
                      : 'bg-card text-muted-foreground border-theme-border hover:bg-surface-100'
                  }`}
                >
                  <WhatsAppIcon size={14} aria-hidden="true" />
                  {t('facts.phoneIsWhatsapp')}
                  {waIndex === i && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addValue}
              className="min-h-[44px] inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              {t(`facts.addAnother_${factKey}`)}
            </button>
          </div>
        ) : isMultiline ? (
          <div className="flex items-start gap-2">
            <textarea
              id={inputId}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              dir={value ? 'auto' : undefined}
              rows={factKey === 'address' ? 3 : 4}
              autoFocus
              placeholder={t(`facts.placeholder_${factKey}`)}
              className="flex-1 min-w-0 rounded-xl border border-theme-border bg-card px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
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
            never a suggestion layered over something they already wrote. */}
        {!isMulti && !value.trim() && PRESETS[factKey] && (
          <div className="mt-3 flex flex-wrap gap-2">
            {PRESETS[factKey]!.map((presetKey) => (
              <button
                key={presetKey}
                type="button"
                onClick={() => setValue(t(`facts.${presetKey}`))}
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
        <Button variant="secondary" size="sm" onClick={onClose} className="max-sm:hidden">
          {tc('cancel')}
        </Button>
        <Button
          size="sm"
          onClick={submit}
          loading={saving}
          disabled={!dirty}
          icon={<Check className="w-4 h-4" />}
          className="max-sm:h-11 max-sm:px-6 max-sm:flex-1"
        >
          {tc('save')}
        </Button>
      </div>
    </DetailSheet>
  );
}
