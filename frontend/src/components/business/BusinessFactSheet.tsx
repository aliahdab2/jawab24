import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, Check } from 'lucide-react';
import { DetailSheet, Button } from '@/components/ui';
import { VoiceRecordButton } from '@/components/knowledge-base/VoiceRecordButton';
import { useEscapeKey } from '@/hooks/useEscapeKey';

/** Facts editable through the single-field sheet. `hours` is NOT here — it is a
 *  structured Record<day, ranges[]> and needs the Phase-D day/range editor. */
export type EditableFactKey = 'address' | 'phone' | 'website' | 'delivery' | 'payment';

/** Multi-line facts get a textarea; the rest a single-line input. */
const MULTILINE: ReadonlyArray<EditableFactKey> = ['delivery', 'payment'];

const INPUT_MODE: Partial<Record<EditableFactKey, 'tel' | 'url' | 'text'>> = {
  phone: 'tel',
  website: 'url',
};

interface BusinessFactSheetProps {
  factKey: EditableFactKey;
  /** Localized field label — the sheet title. */
  label: string;
  initialValue: string;
  saving: boolean;
  onSave: (value: string) => void;
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
  saving,
  onSave,
  onClose,
}: BusinessFactSheetProps) {
  const t = useTranslations('business');
  const tc = useTranslations('common');
  const [value, setValue] = useState(initialValue);

  useEscapeKey(onClose, true);

  const isMultiline = MULTILINE.includes(factKey);
  const inputId = `fact-${factKey}`;
  const dirty = value.trim() !== initialValue.trim();

  const submit = () => {
    if (saving) return;
    onSave(value.trim());
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

        <div className="flex items-start gap-2">
          {isMultiline ? (
            <textarea
              id={inputId}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              dir="auto"
              rows={4}
              autoFocus
              placeholder={t(`facts.placeholder_${factKey}`)}
              className="flex-1 min-w-0 rounded-xl border border-theme-border bg-card px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
            />
          ) : (
            <input
              id={inputId}
              type="text"
              inputMode={INPUT_MODE[factKey] ?? 'text'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
              dir="auto"
              autoFocus
              placeholder={t(`facts.placeholder_${factKey}`)}
              className="flex-1 min-w-0 rounded-xl border border-theme-border bg-card px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          )}
          {/* Voice: appends, never overwrites (VoiceRecordButton's contract) */}
          <VoiceRecordButton
            onTranscribed={(text) => setValue((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))}
            disabled={saving}
          />
        </div>
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
