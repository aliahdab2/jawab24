import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { X, Check, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { DetailSheet, Button, WhatsAppIcon, ConfirmationModal } from '@/components/ui';
import { VoiceRecordButton } from '@/components/knowledge-base/VoiceRecordButton';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useModalBackHandler } from '@/hooks/useModalBackHandler';
import { useTextareaAutoResize } from '@/hooks/useTextareaAutoResize';
import { normalizePhoneEntries, isUsablePhoneEntry, MAX_PHONE_DESCRIPTION_LENGTH } from '@jawab24/shared';
import type { BusinessPhone, BusinessPhoneEntry } from '@jawab24/shared';

/** Facts editable through the single-field sheet. `hours` is NOT here — it is a
 *  structured Record<day, ranges[]> and needs the Phase-D day/range editor. */
export type EditableFactKey = 'address' | 'phone' | 'website' | 'delivery' | 'payment' | 'email';

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

const INPUT_MODE: Partial<Record<EditableFactKey, 'tel' | 'url' | 'email' | 'text'>> = {
  phone: 'tel',
  website: 'url',
  email: 'email',
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
// Generic methods only — no country-specific brands (owner ruling 2026-08-01:
// شام كاش is Syrian while merchants span Libya and beyond; local wallets go in
// the free note, which composes into the same text).
const PAYMENT_METHODS = ['cash', 'transfer', 'card', 'cod'] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];


/*
 * ⛔ No suggestion chips for the phone purpose — removed 2026-08-13, measured.
 *
 * A curated list of six («الإدارة، المبيعات، خدمة العملاء، الشكاوى، الحجوزات،
 * مبيعات الجملة») shipped here first. Across the 16 labelled contact lines in
 * the whole fleet, THREE of the six matched nothing at all, and the three
 * commonest things merchants actually write — «للتواصل» (5), «واتساب» (4),
 * «للاستفسار» (4) — were none of them.
 *
 * The industry split decides it. A fixed taxonomy is right when the vocabulary
 * is UNIVERSAL — iOS/Google Contacts ship Home/Work/Mobile because every human
 * has those. It is wrong when the vocabulary is per-business, and ours is:
 * «صالة الأعراس», «قسم المشاريع», «العيادات الخارجية», «خدمة ما بعد البيع».
 * There the standard is Notion's Select — free text whose options accumulate
 * from what THIS workspace has used, with no vendor-supplied list. schema.org
 * agrees: `contactType` is free text whose suggested values illustrate the
 * concept rather than enumerate it.
 *
 * And the costs are asymmetric. A missing chip costs a merchant a few seconds
 * of typing. A wrong-but-offered chip invites «المبيعات» where they meant
 * «قسم المشاريع» — a mislabelled number, which is the exact defect this whole
 * contact standard exists to repair.
 *
 * If suggestions return, source them from the merchant's OWN data (their KB
 * already contains their labels), never from a list maintained here.
 */

/**
 * What Save hands back. `phone` is its own variant because a number carries a
 * description and a WhatsApp mark — squeezing that through the single text
 * field the other facts use would mean inventing a separator that a merchant's
 * own description could contain.
 */
export type FactSavePayload =
  | { kind: 'text'; value: string }
  /** Already canonical (see `normalizePhoneEntries`) — bare strings for lines
   *  with no description, objects for the rest. */
  | { kind: 'phones'; entries: BusinessPhone[]; whatsapp: string[] };

interface BusinessFactSheetProps {
  factKey: EditableFactKey;
  /** Localized field label — the sheet title. */
  label: string;
  /** Every fact except `phone`, which uses `initialEntries`. */
  initialValue: string;
  /** `phone` only: the stored contact lines, each with its description. */
  initialEntries?: BusinessPhoneEntry[];
  /** `phone` only: which listed numbers are on WhatsApp. Legacy data may hold
   *  a single string — any subset of the numbers is valid. */
  initialWhatsapp?: string | string[];
  /** A connected store already answers this fact — writing here is an override. */
  storeAnswered?: boolean;
  /** The prefilled value is an UNCONFIRMED Facebook-synced copy: the sheet says
   *  so above the input, and Save stays enabled even with no edit — saving an
   *  unchanged value here is the explicit confirmation the reply pipeline
   *  requires before it will use the value. */
  fbSuggested?: boolean;
  saving: boolean;
  /** Save failure, rendered INSIDE the sheet: toasts are capped below the
   *  modal tier (z-45 < z-50) so they can never block a footer again — which
   *  also means a toast can no longer carry this message. */
  saveError?: string | null;
  onSave: (payload: FactSavePayload) => void;
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
  initialEntries,
  initialWhatsapp,
  storeAnswered = false,
  fbSuggested = false,
  saving,
  saveError = null,
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
  const [entries, setEntries] = useState<{ value: string; description: string; wa: boolean }[]>(() => {
    const wa = (Array.isArray(initialWhatsapp) ? initialWhatsapp : initialWhatsapp ? [initialWhatsapp] : [])
      .map((n) => n.trim())
      .filter(Boolean);
    const rows = (initialEntries ?? []).map((e) => ({
      value: e.number,
      description: e.description ?? '',
      // The mark belongs to the NUMBER, never to the entry object.
      wa: wa.includes(e.number),
    }));
    return rows.length ? rows : [{ value: '', description: '', wa: false }];
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
  // Keyed on `value` so EVERY way the text changes resizes the box — typing,
  // a preset tap, a voice transcription landing — after React commits, not
  // before (a synchronous call in the click handler measured the old DOM).
  const { ref: textareaRef, autoResize } = useTextareaAutoResize(factKey === 'address' ? 72 : 96, 320);
  useEffect(() => {
    if (isMultiline && !isMulti && !intake) autoResize();
  }, [value, isMultiline, isMulti, intake, autoResize]);

  /** What Save would store — canonicalized here so "did anything change?" is
   *  asked against the exact value the server will hold, not the raw rows. */
  const phoneEntries = useMemo(
    () => normalizePhoneEntries(entries.map((e) => ({ number: e.value, description: e.description }))),
    [entries],
  );
  const initialPhoneEntries = useMemo(
    () => normalizePhoneEntries(initialEntries ?? []),
    [initialEntries],
  );
  const waList = entries.filter((e) => e.wa && e.value.trim()).map((e) => e.value.trim());
  const initialWaList = useMemo(() => {
    const wa = (Array.isArray(initialWhatsapp) ? initialWhatsapp : initialWhatsapp ? [initialWhatsapp] : [])
      .map((n) => n.trim())
      .filter(Boolean);
    // Only marks on numbers the sheet can show count as the baseline — a
    // legacy mark on an unlisted number is not representable here and would
    // otherwise hold the sheet permanently dirty.
    const listed = (initialEntries ?? []).map((e) => e.number);
    return wa.filter((n) => listed.includes(n));
  }, [initialWhatsapp, initialEntries]);

  /**
   * Numbers ALREADY STORED when this sheet opened — grandfathered, exactly as
   * the server grandfathers them (`merchantBusinessProfileSchema`).
   *
   * Without this the two sides disagree in the worst direction: the server would
   * accept the save and the UI would still refuse to send it, so a merchant with
   * one bad legacy row — which Facebook sync or the KB extractor can write, both
   * bypassing the merchant rule by design — could never edit their address again.
   * They can delete such a row or leave it; it must not disable Save.
   */
  const grandfatheredNumbers = useMemo(
    () => new Set((initialEntries ?? []).map((e) => e.number.trim()).filter(Boolean)),
    [initialEntries],
  );

  /**
   * A row whose number slot holds something that is not a number — the class
   * that let «رقم الجملة فقط يطلب مبيعات جملة» be stored AS a phone and
   * published in every prompt. `isUsablePhoneEntry` is the only judge (NOT
   * `extractPhones`, whose 9-digit prose floor rejected a real landline).
   *
   * ⭐⭐ MARKING and BLOCKING are two different questions, and collapsing them is
   * how the first cut of the grandfathering fix traded a loud bug for a silent
   * one. Grandfathering the row out of THIS set unblocked Save and also removed
   * its red border, its `aria-invalid` and its inline message — so the merchant
   * had no indication that a line of prose was still being published to their
   * customers as a phone number. The lockout was gone and so was the warning.
   *
   * ⇒ `invalidIndexes` answers "is this row wrong?" and includes grandfathered
   * rows, so they stay VISIBLE. `blockingIndexes` answers "may Save proceed?" and
   * excludes them. Marked but not blocked is strictly better than either of the
   * two states this code has been in, and it is where PR B's «انقله إلى الوصف»
   * hint lands.
   */
  const invalidIndexes = useMemo(() => {
    const bad = new Set<number>();
    if (!isMulti) return bad;
    entries.forEach((e, i) => {
      const v = e.value.trim();
      if (v && !isUsablePhoneEntry(v)) bad.add(i);
    });
    return bad;
  }, [entries, isMulti]);

  /** Of those, the ones the merchant is ADDING or CHANGING — the only rows that
   *  may hold Save back. Mirrors the server's grandfathering exactly. */
  const blockingIndexes = useMemo(() => {
    const blocking = new Set<number>();
    invalidIndexes.forEach((i) => {
      if (!grandfatheredNumbers.has(entries[i].value.trim())) blocking.add(i);
    });
    return blocking;
  }, [invalidIndexes, entries, grandfatheredNumbers]);
  const hasInvalid = blockingIndexes.size > 0;

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
    ? JSON.stringify(phoneEntries) !== JSON.stringify(initialPhoneEntries)
      || JSON.stringify([...waList].sort()) !== JSON.stringify([...initialWaList].sort())
    : intake
      ? composed().trim() !== ''
      : value.trim() !== initialValue.trim();

  // ── Close guard: typed-but-unsaved edits never vanish on a stray tap ─────
  const [confirmClose, setConfirmClose] = useState(false);
  const attemptClose = () => {
    // Mid-save, closing would race the outcome: a failure needs the sheet
    // (the inline error renders here), so close waits the last second out.
    if (saving) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  };
  // While the discard confirm is up, ITS Esc handling wins — otherwise one
  // keypress closes the confirm and this hook instantly re-opens it.
  useEscapeKey(attemptClose, !confirmClose);
  // Android hardware back must take the SAME guarded path as X/Esc/swipe.
  // Ref-stabilized: useModalBackHandler re-registers when its callback
  // identity changes, and a re-render while the discard confirm is stacked
  // on top would push this sheet back above it — back would then close the
  // sheet under the confirm.
  const attemptCloseRef = useRef(attemptClose);
  attemptCloseRef.current = attemptClose;
  const stableAttemptClose = useCallback(() => attemptCloseRef.current(), []);
  useModalBackHandler(true, stableAttemptClose);

  const addEntry = () => {
    setConfirmingDelete(null);
    setEntries((prev) => [...prev, { value: '', description: '', wa: false }]);
  };

  const removeEntry = (i: number) => {
    setConfirmingDelete(null);
    setEntries((prev) => prev.filter((_, j) => j !== i));
  };

  const setEntryValue = (i: number, v: string) => {
    setConfirmingDelete(null);
    // Clearing a number clears its mark too — a checked-but-disabled box on
    // an empty row claimed a WhatsApp number that no longer exists.
    setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, value: v, wa: v.trim() ? e.wa : false } : e)));
  };

  const toggleWa = (i: number) =>
    setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, wa: !e.wa } : e)));

  /**
   * Contacts grouped by PURPOSE for display only — storage stays the flat
   * `entries` array, so two numbers sharing a purpose are simply two entries
   * with the same description and the canonical form is untouched.
   *
   * A purpose genuinely owns several numbers in real data: 2 of MES's 3
   * departments carry a «هاتف بديل», and Shahin's KB gives two lines for
   * booking confirmation («عبر 0189955 أو 0982414141»). Without grouping the
   * merchant has to type the same purpose twice and then reads two rows
   * carrying the same label.
   *
   * ⚠️ Only ADJACENT entries group, and an empty purpose never groups: two
   * blank rows are two contacts not yet labelled, not one contact with two
   * numbers. Grouping them would silently merge unrelated lines the moment a
   * merchant added a row.
   */
  const groups = useMemo(() => {
    const out: { description: string; idxs: number[] }[] = [];
    entries.forEach((e, i) => {
      const d = e.description.trim();
      const last = out[out.length - 1];
      if (last && d !== '' && last.description === d) last.idxs.push(i);
      else out.push({ description: d, idxs: [i] });
    });
    return out;
  }, [entries]);

  /** Editing a shared purpose rewrites it on every number that carries it. */
  const setGroupDescription = (idxs: readonly number[], v: string) => {
    setConfirmingDelete(null);
    const target = new Set(idxs);
    setEntries((prev) => prev.map((e, j) => (target.has(j) ? { ...e, description: v } : e)));
  };

  /** Another number under the SAME purpose — inserted directly after the
   *  group's last row so the grouping (which is adjacency-based) holds. */
  const addToGroup = (idxs: readonly number[], description: string) => {
    setConfirmingDelete(null);
    const at = idxs[idxs.length - 1] + 1;
    setEntries((prev) => [
      ...prev.slice(0, at),
      { value: '', description, wa: false },
      ...prev.slice(at),
    ]);
  };

  /** Leave the intake for the plain textarea, carrying anything already typed. */
  const switchToFreeText = () => {
    const drafted = composed();
    if (drafted) setValue(drafted);
    setFreeText(true);
  };

  const submit = () => {
    if (saving || !dirty || hasDuplicates || hasInvalid) return;
    if (isMulti) onSave({ kind: 'phones', entries: phoneEntries, whatsapp: waList });
    else if (intake) onSave({ kind: 'text', value: composed().trim() });
    else onSave({ kind: 'text', value: value.trim() });
  };

  const intakeFieldClass =
    'w-full min-h-[44px] rounded-xl border border-theme-border bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500';
  /** Same Enter-saves behavior as the single-line fields. */
  const submitOnEnter = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Enter') { ev.preventDefault(); submit(); }
  };
  // The backend caps each policy at 500 chars; these caps keep the COMPOSED
  // text (labels + all fields) under it so a long answer can't fail at save.
  const INTAKE_FIELD_MAX = 120;
  const INTAKE_NOTE_MAX = 200;

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
          disabled={saving}
          aria-label={tc('close')}
          className="min-h-[44px] min-w-[44px] -me-2 flex items-center justify-center rounded-lg hover:bg-surface-100 text-surface-500 disabled:opacity-40"
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

        {/* The prefill is a Facebook copy the merchant never typed — say so,
            or saving it unseen re-creates the laundering this sheet's
            confirm-flow exists to prevent (MES «+971556087128», 2026-08-08). */}
        {fbSuggested && (
          <p className="mb-3 rounded-xl alert-warning border px-3 py-2 text-xs">
            {t('facts.fromFacebookHint')}
          </p>
        )}

        {isMulti ? (
          /* Repeatable values (phone): one input per number — a merchant should
             never have to remember a separator. Joined with ", " on save; the
             page splits it back into the `phones` array. */
          <div className="space-y-3">
            {/* Labelled ONCE for the whole list. The purpose field's only label
                used to be its placeholder, which disappears the moment a value
                is typed — so a filled sheet showed unlabelled text. A column
                header costs one line instead of one per row. Hidden below `sm`,
                where the fields stack and the header would sit over the wrong
                one; the placeholder carries an empty field there. */}
            <div className="hidden sm:flex items-center gap-2 px-1 text-xs text-muted-foreground">
              <span className="flex-1 min-w-[8rem]">{t('facts.phoneDescription')}</span>
              <span className="w-[9.5rem]">{label}</span>
              <span className="w-[44px]" aria-hidden="true" />
            </div>
            {groups.map((g) => {
              const first = g.idxs[0];
              return (
              /* One CARD per PURPOSE, its numbers stacked inside. The old flat
                 stack separated fields within a contact by 6px and contacts
                 from each other by 12px, so nothing but proximity said which
                 purpose belonged to which number — five numbers read as
                 fifteen unrelated boxes. Grouping also gives a main line and
                 its fallback one label instead of two identical ones. */
              <div key={first} className="rounded-xl border border-theme-border bg-card p-2 space-y-1.5">
                {/* PURPOSE FIRST, then the number(s). Every labelled contact
                    line in the fleet is written that way — «للشكاوي :
                    0931671111», «📞 الإدارة: 0126543210» — 16 of 16, and the
                    only number-first string anywhere is the one a merchant was
                    forced to cram into a number field.
                    Wraps to stacked below `sm`: at 390px two inputs plus the
                    delete button leave ~148px for the purpose, which truncates
                    «خدمات المسبح والجاكوزي» before it can be read. */}
                <div className="flex flex-wrap items-start gap-2">
                  <input
                    type="text"
                    value={entries[first].description}
                    onChange={(ev) => setGroupDescription(g.idxs, ev.target.value)}
                    onKeyDown={submitOnEnter}
                    /* Conditional, like every other field in this sheet — and
                       the reason that pattern exists. Per the HTML spec, `auto`
                       resolves by the first STRONG character of the value, and
                       when there is none "the directionality of the element is
                       ltr". So an unconditional `auto` on an EMPTY input renders
                       its Arabic placeholder «ما الغرض من هذا الرقم؟»
                       left-aligned inside an RTL sheet. Inheriting while empty
                       keeps the placeholder in the page's direction; `auto`
                       once there is content lets Arabic and Latin each sit
                       correctly. */
                    dir={entries[first].description ? 'auto' : undefined}
                    maxLength={MAX_PHONE_DESCRIPTION_LENGTH}
                    placeholder={t('facts.phoneDescriptionPlaceholder')}
                    aria-label={`${t('facts.phoneDescription')} — ${label} ${first + 1}`}
                    /* Secondary by design: lighter border, smaller type, no
                       fill, so the number stays the primary value. Previously
                       both carried identical 44px/rounded-xl/bordered styling
                       and the annotation read as a second number field. */
                    className="w-full sm:w-auto sm:flex-1 sm:min-w-[8rem] min-h-[44px] rounded-xl border border-theme-border/60 bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />

                  <div className="w-full sm:w-auto sm:flex-none space-y-1.5">
                    {g.idxs.map((i) => {
                      const e = entries[i];
                      return (
                        <div key={i} className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <input
                              type={INPUT_TYPE[factKey] ?? 'text'}
                              inputMode={INPUT_MODE[factKey] ?? 'text'}
                              value={e.value}
                              onChange={(ev) => setEntryValue(i, ev.target.value)}
                              onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addEntry(); } }}
                              /* ⭐ The app's existing phone convention, copied
                                 from `auth/PhoneInput.tsx` rather than invented
                                 here: the control is `dir="ltr"` AND its
                                 placeholder is a digit MASK («09XX XXX XXX»,
                                 mirroring PhoneInput's «5XX XXX XXXX»).
                                 Why `ltr` is required: digits are directionally
                                 NEUTRAL, so `auto` finds no strong character in
                                 «0982414141», falls back to the surrounding RTL,
                                 and bidi lays each digit GROUP out
                                 right-to-left — «963 472 924» paints as
                                 «924 472 963». Same class `renderMessageText`
                                 fixes with `<span dir="ltr">` (PR #658).
                                 Why the mask matters: it is direction-neutral,
                                 so an LTR field no longer drags an Arabic word
                                 to the wrong edge — which is what made a
                                 conditional `dir` (and a `::placeholder`
                                 override) look necessary. Neither is.
                                 ⚠️ jsdom does no bidi layout — a test can assert
                                 this attribute, never the painted order. That
                                 needs real Chrome. */
                              dir="ltr"
                              autoFocus={i === 0}
                              placeholder={t(`facts.placeholder_${factKey}`)}
                              aria-label={`${label} ${i + 1}`}
                              aria-invalid={duplicateIndexes.has(i) || invalidIndexes.has(i) || undefined}
                              aria-describedby={clsx(
                                duplicateIndexes.has(i) && `${inputId}-dup-${i}`,
                                invalidIndexes.has(i) && `${inputId}-invalid-${i}`,
                              ) || undefined}
                              className={clsx(
                                // Fixed basis, not flex-1: a phone number has a
                                // known length, and letting it eat the row is
                                // what pushed the delete button a screen-width
                                // away from its own field.
                                'w-full sm:w-[9.5rem] min-w-0 min-h-[44px] rounded-xl border bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500',
                                duplicateIndexes.has(i) || invalidIndexes.has(i)
                                  ? 'border-red-400 dark:border-red-700'
                                  : 'border-theme-border',
                              )}
                            />
                            {entries.length > 1 && (
                              confirmingDelete === i ? (
                                <Button
                                  variant="danger"
                                  size="sm"
                                  onClick={() => removeEntry(i)}
                                  className="flex-shrink-0 min-h-[44px]"
                                >
                                  {t('facts.deleteNumberConfirm')}
                                </Button>
                              ) : (
                                <button
                                  type="button"
                                  // An empty row holds nothing to lose; a filled
                                  // one arms first (two-tap) so a number is never
                                  // one mistap from gone — nothing here is
                                  // undoable before Save.
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
                            <p id={`${inputId}-dup-${i}`} role="alert" className="text-xs text-red-600 dark:text-red-400">
                              {t('facts.duplicateNumber')}
                            </p>
                          )}
                          {invalidIndexes.has(i) && (
                            <p id={`${inputId}-invalid-${i}`} role="alert" className="text-xs text-red-600 dark:text-red-400">
                              {t('facts.phoneInvalid')}
                            </p>
                          )}
                          {/* Keeps its words — an unlabelled icon reads as
                              "call", not "WhatsApp" (owner call). What it loses
                              is the CHROME: as a bordered pill it outweighed the
                              number it describes, and because its row was
                              `justify-between` it landed under the DELETE button
                              in RTL instead of under its own field. */}
                          <label
                            className={clsx(
                              'min-h-[36px] max-sm:min-h-[44px] inline-flex items-center gap-1.5 rounded-lg px-1 text-xs transition select-none focus-within:ring-2 focus-within:ring-brand-500',
                              !e.value.trim() ? 'opacity-40' : 'cursor-pointer',
                              e.wa ? 'text-brand-700 dark:text-brand-300 font-medium' : 'text-muted-foreground',
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
                            {t('facts.phoneIsWhatsapp')}
                            {/* AFTER the label text, not between the box and it.
                                Flex follows the page direction, so in Arabic
                                the mark lands at the end of the phrase and the
                                row reads ☐ «هذا الرقم على واتساب» ⟨mark⟩ instead
                                of clustering two glyphs before the words. The
                                same DOM order gives LTR «Also on WhatsApp» ⟨mark⟩.
                                aria-hidden, so this is purely visual — the
                                checkbox's own aria-label carries the meaning. */}
                            <WhatsAppIcon size={14} aria-hidden="true" />
                          </label>
                        </div>
                      );
                    })}

                    {/* Another line for the SAME purpose. Only offered once the
                        purpose is named — under a blank label it would produce
                        two unlabelled rows that then cannot be told apart. */}
                    {g.description !== '' && (
                      <button
                        type="button"
                        onClick={() => addToGroup(g.idxs, entries[first].description)}
                        className="min-h-[44px] inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('facts.addNumberSamePurpose')}
                      </button>
                    )}
                  </div>
                </div>

              </div>
              );
            })}
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
                // A real toggle: pressing again un-answers and folds the
                // detail fields away — aria-pressed promises exactly that.
                onClick={() => setDeliveryAnswer((prev) => (prev === 'yes' ? null : 'yes'))}
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
                    maxLength={INTAKE_FIELD_MAX}
                    onChange={(ev) => setDeliveryAreas(ev.target.value)}
                    onKeyDown={submitOnEnter}
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
                    maxLength={INTAKE_FIELD_MAX}
                    onChange={(ev) => setDeliveryCost(ev.target.value)}
                    onKeyDown={submitOnEnter}
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
                    maxLength={INTAKE_FIELD_MAX}
                    onChange={(ev) => setDeliveryTime(ev.target.value)}
                    onKeyDown={submitOnEnter}
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
                maxLength={INTAKE_NOTE_MAX}
                onChange={(ev) => setPayNote(ev.target.value)}
                onKeyDown={submitOnEnter}
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
              onChange={(e) => setValue(e.target.value)}
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
                onClick={() => setValue(t(`facts.${presetKey}`))}
                className="min-h-[36px] rounded-full border border-theme-border bg-card px-3 text-xs font-medium text-muted-foreground hover:bg-surface-100 hover:text-foreground"
              >
                {t(`facts.${presetKey}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* A failed save reports HERE: the sheet stays open on failure, and a
          toast would render under this very overlay (toasts cap at z-45). */}
      {saveError && (
        <p role="alert" className="flex-shrink-0 mx-4 lg:mx-5 mb-2 rounded-xl alert-error border px-3 py-2 text-sm">
          {saveError}
        </p>
      )}

      {/* Footer */}
      <div className="flex-shrink-0 flex items-center justify-end gap-3 px-4 py-3 pb-safe-modal lg:pb-4 lg:px-5 border-t border-theme-border bg-card">
        <Button variant="secondary" size="sm" onClick={attemptClose} disabled={saving} className="max-sm:h-11">
          {tc('cancel')}
        </Button>
        <Button
          size="sm"
          onClick={submit}
          loading={saving}
          // An fb-suggested prefill may be saved UNCHANGED — that save is the
          // merchant's explicit confirmation, which is the whole point.
          disabled={(!dirty && !fbSuggested) || hasDuplicates || hasInvalid}
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
