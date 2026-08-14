import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Clock, MapPin, Truck, CreditCard, Phone, Globe, Mail } from 'lucide-react';
import { WhatsAppIcon } from '@/components/ui';
import type { Page, BusinessPhoneEntry } from '@jawab24/shared';
import type { LucideIcon } from 'lucide-react';
import type { EditableFactKey } from './BusinessFactSheet';
import { computeFactCoverage, isScoredFactKey, isStorePolicyKey, type BusinessFactKey } from '@/utils/businessCoverage';
import { parseWeek, summarizeWeek, type DayKey } from '@/utils/businessHours';

/** Plain-text form of one contact line, for the row's `value` (used by the
 *  collapsed summary and by anything reading the row as a string). */
const describePhone = (p: BusinessPhoneEntry) =>
  p.description ? `${p.number} (${p.description})` : p.number;

interface BusinessFactRowsProps {
  page: Page;
  /** Open the single-field sheet for an editable fact. */
  onEditFact: (key: EditableFactKey) => void;
  /** Open the structured day/range hours sheet. */
  onEditHours: () => void;
  /**
   * View-only (workspace `member`). Writing a fact is `PUT /pages/:id`, which is
   * `requireRole('admin')` — so the rows keep their value and their coverage
   * badge (the answer to "does Jawab know this?" is the same for everyone) and
   * stop being tap targets.
   */
  readOnly?: boolean;
}

interface FactRow {
  /** The coverage key IS the row key — one union, not a second copy that has to
   *  be kept in step. That every non-`hours` key is also an `EditableFactKey` is
   *  proved by the `onEditFact(row.key)` call below, which will not compile if a
   *  coverage key has no single-field editor. */
  key: BusinessFactKey;
  /** Widened from LucideIcon: WhatsApp needs its own brand mark, and a generic
   *  phone glyph would read as "call", which is the wrong affordance. */
  icon: LucideIcon | React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  /** Display value; null = not set. */
  value: string | null;
  /** Richer rendering when plain text can't carry the meaning (the WhatsApp
   *  mark on a phone number). `value` still drives the is-set logic. */
  valueNode?: React.ReactNode;
  /** An UNCONFIRMED value (Facebook-synced / unreviewed) exists for this fact.
   *  Rendered as «من فيسبوك: …» with a review badge — visible but never
   *  presented as settled. Only set when `value` is null: a confirmed value
   *  always wins the row. */
  suggestedValue?: string | null;
  /** Jawab can answer about this — the merchant's value or the connected store. */
  covered: boolean;
  /** A connected store answers this fact and the merchant wrote nothing. */
  storeAnswered: boolean;
}

/**
 * Business facts as tappable rows (B1 part 2 — mobile-first rewrite).
 *
 * The first version rendered a read-only table whose only action was a 19×16px
 * «حدّد» link — measured on a 390px viewport, roughly a sixth of the 44px
 * minimum tap target, and the owner mis-tapped it immediately. This replaces it
 * with the iOS-Settings row pattern merchants already know from their phone:
 * the WHOLE row is the target (56px), and the prompt text sits where the value
 * will appear — so one line does the job of the old value + action pair.
 *
 * Coverage comes from `computeFactCoverage`, the same module (and the same
 * per-field rules) the readiness ring scores from, so a row's badge can never
 * contradict the percentage above it. Values come from that module too — from the
 * CONFIRMED merchant half only, the same authority the reply pipeline uses
 * (suggestions never count as set).
 */
export function BusinessFactRows({ page, onEditFact, onEditHours, readOnly = false }: BusinessFactRowsProps) {
  const t = useTranslations('business');

  const rows: FactRow[] = useMemo(() => {
    const { values, suggested, covered, storeAnswered } = computeFactCoverage(page);

    // Show the actual week, grouped — a merchant with different Friday hours
    // needs to SEE that from the row, not discover it by opening the sheet.
    const summarize = (week: NonNullable<typeof values.hours>) =>
      summarizeWeek(parseWeek(week), {
        closed: t('facts.hoursClosed'),
        allDay: t('facts.hoursAllDay'),
        day: (key: DayKey) => t(`facts.day_${key}`),
      });
    const hoursValue = values.hours ? summarize(values.hours) : null;
    const { phones, whatsapp } = values;

    const row = (key: BusinessFactKey, extra: Omit<FactRow, 'key' | 'covered' | 'storeAnswered'>): FactRow => ({
      key,
      covered: covered[key],
      storeAnswered: isStorePolicyKey(key) && storeAnswered[key],
      ...extra,
    });

    return [
      row('hours', {
        icon: Clock,
        value: hoursValue,
        suggestedValue: suggested.hours ? summarize(suggested.hours) : null,
      }),
      row('address', { icon: MapPin, value: values.address, suggestedValue: suggested.address ?? null }),
      // WhatsApp is a MARK on a number, not a row of its own: in this market it
      // is nearly always a SIM the merchant already listed, so a second row meant
      // the same digits typed twice and two copies to keep in sync.
      row('phone', {
        icon: Phone,
        value: phones.length ? phones.map(describePhone).join(' · ') : null,
        suggestedValue: suggested.phones?.length ? suggested.phones.map(describePhone).join(' · ') : null,
        valueNode: phones.length ? (
          <span className="inline-flex items-center gap-1 min-w-0">
            {phones.map((p, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                {i > 0 && <span aria-hidden="true" className="text-subtle">·</span>}
                <span>{p.number}</span>
                {/* The purpose the merchant gave this line, muted so the number
                    stays the thing the eye lands on. */}
                {p.description && (
                  <span className="text-muted-foreground text-xs">{p.description}</span>
                )}
                {/* The mark belongs to the NUMBER — never compare an entry. */}
                {whatsapp.includes(p.number) && (
                  <WhatsAppIcon size={12} className="text-brand-600 flex-shrink-0" aria-label={t('facts.whatsapp')} />
                )}
              </span>
            ))}
          </span>
        ) : undefined,
      }),
      // Delivery and payment sit above website on purpose: customers ask about
      // both constantly, while nobody messages a shop to ask whether it has a
      // website. Ordering by question volume, not by field type.
      // When the store genuinely answers these, an empty value is NOT a gap — so
      // the row says so instead of nagging, and the badge reads مكتمل. It stays
      // tappable: writing a value is a deliberate override.
      row('delivery', { icon: Truck, value: values.delivery, suggestedValue: suggested.delivery ?? null }),
      row('payment', { icon: CreditCard, value: values.payment, suggestedValue: suggested.payment ?? null }),
      row('website', { icon: Globe, value: values.website, suggestedValue: suggested.website ?? null }),
      // Last, by the same question-volume rule: customers ask for an email far
      // less often than for hours, an address or a number.
      row('email', { icon: Mail, value: values.email, suggestedValue: suggested.email ?? null }),
    ];
  }, [page, t]);

  return (
    <section aria-label={t('facts.title')} className="rounded-2xl border border-theme-border bg-card p-4 sm:p-5">
      <h2 className="text-base sm:text-lg font-semibold text-foreground">{t('facts.title')}</h2>
      <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 mb-2">{t('facts.hint')}</p>

      <ul className="divide-y divide-theme-border -mx-4 sm:-mx-5">
        {rows.map((row) => {
          const Icon = row.icon;
          const isSet = row.value !== null;
          const hasSuggestion = !isSet && !!row.suggestedValue;
          // Unscored facts (phone, website) never badge «ناقص»: the readiness
          // counter above doesn't count them, and an amber "missing" on a row
          // the score ignores is the two-scoreboards contradiction this module
          // family exists to prevent. They read «اختياري» in neutral gray.
          // A Facebook-synced suggestion outranks both idle states — scored or
          // not, an unreviewed value waiting on the row IS the errand (the
          // hidden-UAE-phone lesson): show it and ask for review.
          const badge = row.covered
            ? { className: 'status-success', label: t('state.covered') }
            : hasSuggestion
              ? { className: 'status-warning', label: t('state.reviewNeeded') }
              : isScoredFactKey(row.key)
                ? { className: 'status-warning', label: t('state.missing') }
                : { className: 'bg-muted text-muted-foreground border-theme-border', label: t('state.optional') };
          // Identical content whether the row is a control or plain text — a
          // view-only row must read the same, minus the action pill.
          const rowContent = (
            <>
                <Icon
                  className={`w-5 h-5 flex-shrink-0 ${row.covered ? 'text-brand-600' : 'text-icon-muted'}`}
                  aria-hidden="true"
                />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-foreground truncate">
                      {t(`facts.${row.key}`)}
                    </span>
                    {/* Not decoration. Without it, covered-vs-missing is carried
                        by COLOUR alone (brand teal vs muted), which fails WCAG
                        1.4.1 Use of Colour. The legend below names both dots. */}
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium flex-shrink-0 ${badge.className}`}
                    >
                      <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-current" />
                      {badge.label}
                    </span>
                  </span>
                  {/* The prompt sits where the value will be — one line does the
                      job of the old "not set" + "set" pair. */}
                  {/* No dir="auto" here: a digits-only value (a phone number) has
                      no STRONG directional character, so `auto` falls back to LTR
                      and left-aligns the whole row's value in an RTL page. Letting
                      it inherit the page direction keeps every row aligned, while
                      bidi still renders the digit run itself left-to-right. */}
                  <span
                    className={`block text-xs truncate mt-0.5 ${row.covered ? 'text-muted-foreground' : 'text-brand-600'}`}
                  >
                    {isSet
                      ? (row.valueNode ?? (row.value || t('facts.isSet')))
                      : hasSuggestion
                        // The value the merchant never typed, shown AS what it
                        // is — a Facebook copy awaiting review. Members see it
                        // too (it's state, not an errand).
                        ? t('facts.fromFacebook', { value: row.suggestedValue ?? '' })
                        : row.storeAnswered
                          ? t('facts.storeAnswered')
                          : readOnly
                            // «أضف عنوانك» is an instruction to the person who
                            // can. A member gets the state, not the errand.
                            ? t('facts.notSet')
                            : t(`facts.add_${row.key}`)}
                  </span>
                </span>
                {/* Visual affordance only — see the row's className note. It is
                    inside the button, so its text joins the row's accessible
                    name: "Working hours, Complete, Sat–Thu 9–5, Edit".
                    Styled by COVERAGE but labelled by whether a merchant value
                    exists: a store-answered row is not a gap, so it must not wear
                    the highlighted call-to-action, yet «إضافة» is still the honest
                    label — there is no merchant text to edit, only one to add as
                    a deliberate override. */}
                {!readOnly && (
                  <span
                    className={`flex-shrink-0 inline-flex items-center justify-center min-w-[64px] rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                      row.covered ? 'border-theme-border text-muted-foreground' : 'status-brand'
                    }`}
                  >
                    {isSet ? t('facts.edit') : hasSuggestion ? t('facts.review') : t('facts.add')}
                  </span>
                )}
            </>
          );
          return (
            <li key={row.key}>
              {readOnly ? (
                <div className="w-full min-h-[56px] flex items-center gap-3 px-4 sm:px-5 py-2.5 text-start">
                  {rowContent}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => (row.key === 'hours' ? onEditHours() : onEditFact(row.key))}
                  // 56px row: the WHOLE thing is the tap target (was a 19×16px
                  // link). The mock draws the action as a ~70px button at the row
                  // end; that button is rendered above as a plain <span> — a real
                  // nested <button> is invalid HTML and would shrink a full-width
                  // target down to 70px on the viewport where it matters most.
                  className="w-full min-h-[56px] flex items-center gap-3 px-4 sm:px-5 py-2.5 text-start hover:bg-surface-100 active:bg-surface-200 transition-colors"
                >
                  {rowContent}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* ⛔ No colour legend here — removed 2026-08-13 (owner: «the explaining
          text is useless»), and the code agreed.
          Every row already renders its state as a WORD next to the colour
          («مكتمل» / «ناقص» / «اختياري» / «بحاجة إلى مراجعة», see the badge above),
          so a legend explaining the colour restated a meaning the badge was
          never carrying alone. Two of its three lines — «ناقص — يحتاج إدخالك»,
          «مكتمل — يستخدمه جواب» — were pure restatement, permanently on screen
          for something a merchant needs at most once.
          It also carried a maintenance trap worth losing: its swatches were
          literal emerald/amber that had to be kept in step BY HAND with the
          `status-success` / `status-warning` classes, which are 50/700
          background+text pairs with no solid-fill token to borrow.
          The words stay on the badges, so nothing is lost for colour-blind
          readers either — the swatches were `aria-hidden` and the label was
          always doing the accessible work. */}
    </section>
  );
}
