import React, { useCallback, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Check, CircleAlert, Sparkles, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui';
import {
  computeReadiness,
  READINESS_AREAS,
  type ReadinessAreaKey,
} from '@/utils/businessCoverage';
import type { PageDetail } from '@jawab24/shared';

interface BusinessReadinessCardProps {
  page: PageDetail;
  /** Catalog item count; undefined while loading. */
  productsCount: number | undefined;
  /** LIVE fact-collection rows on this page (undefined while loading) — the
   *  second product source the readiness must not contradict. */
  factRowsCount: number | undefined;
  onTryReply: () => void;
  /**
   * Tap an uncovered chip to fix it on the spot. Without this the merchant has
   * to scroll past the whole product list to reach the fact rows — measured at
   * 4–6 screens on a 390px viewport for a 27-item catalog.
   */
  /**
   * Omit for a view-only member: every chip's destination is an admin-only
   * editor, and the card's own rule below — "a tappable-looking chip that does
   * nothing is worse than a plain one" — applies exactly as much to a chip that
   * would land on a 403.
   */
  onFixChip?: (key: FixableChipKey) => void;
}

/** Chips the merchant can act on. The four facts open their editor;
 *  `products` scrolls to the products section (owner catch 2026-08-05: it was
 *  the one amber chip styled like the tappable four that ignored the tap). */
export type FixableChipKey = 'hours' | 'address' | 'delivery' | 'payment' | 'products';

interface Chip {
  key: ReadinessAreaKey;
  label: string;
  covered: boolean;
  /** Set when tapping the chip should open the matching fact editor. */
  fixKey?: FixableChipKey;
}

/** Ring geometry. r is in the 0–36 viewBox, so the SVG scales with its box. */
const RING_RADIUS = 15.5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * The readiness ring. Purely decorative to assistive tech (`aria-hidden`): the
 * percentage next to it carries `role="progressbar"` + `aria-valuenow`, so a
 * screen-reader user gets the number and never an unlabelled SVG.
 *
 * Fills clockwise from 12 o'clock in BOTH directions. A percentage dial is not a
 * text run — mirroring it in RTL would make «60%» read as 40% to anyone who has
 * seen the LTR build, and no platform mirrors this control.
 */
function ReadinessRing({ percent }: { percent: number }) {
  return (
    <svg viewBox="0 0 36 36" className="w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0 -rotate-90" aria-hidden="true">
      <circle
        cx="18"
        cy="18"
        r={RING_RADIUS}
        fill="none"
        strokeWidth="3.5"
        className="stroke-muted"
      />
      <circle
        cx="18"
        cy="18"
        r={RING_RADIUS}
        fill="none"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={RING_CIRCUMFERENCE * (1 - percent / 100)}
        className="stroke-brand-500 transition-[stroke-dashoffset] duration-500"
      />
    </svg>
  );
}

/**
 * «ما الذي يستطيع «جواب» الإجابة عنه؟» — the top-of-page readiness summary (B1).
 * Green chips = Jawab holds this info; amber = customers may ask and get no
 * answer. Coverage comes from `computeReadiness` — the same module, and the same
 * per-field rules, the fact rows badge themselves from, so the ring and the
 * badges below it can never disagree about a field.
 */
export function BusinessReadinessCard({ page, productsCount, factRowsCount, onTryReply, onFixChip }: BusinessReadinessCardProps) {
  const t = useTranslations('business');
  const locale = useLocale();

  const { covered, score } = useMemo(
    () => computeReadiness(page, productsCount, factRowsCount),
    [page, productsCount, factRowsCount],
  );
  /** No score until the catalog count lands. One flag, so the ring and the chips
   *  can never announce different busy states for the same wait. */
  const loading = score === null;

  /** Chip label per scored area. For `products` this is a COUNT readout («لا
   *  منتجات بعد» / «٣ منتجات»), which is what a chip should show. A page whose
   *  products live in the G1b lists instead says so — never «لا منتجات بعد»
   *  above 245 list rows. */
  const labelFor = useCallback((key: ReadinessAreaKey): string => {
    if (key !== 'products') return t(`readiness.${key}Chip`);
    if (page.ecommerceStoreId) return t('readiness.productsChipStore');
    if ((productsCount ?? 0) === 0 && (factRowsCount ?? 0) > 0) return t('readiness.productsChipLists');
    return t('readiness.productsChip', { count: productsCount ?? 0 });
  }, [t, page.ecommerceStoreId, productsCount, factRowsCount]);

  /**
   * The area's NAME, for the gap sentence. Identical to the chip label wherever
   * that label is already a name, so one field is never called two things on one
   * screen («الدفع» in a chip vs «طرق الدفع» in the sentence).
   *
   * `products` is the one exception, and it has to be: its chip shows a COUNT, so
   * feeding the chip label into the sentence produced «أضف لا منتجات بعد ليصبح
   * جاهزًا بالكامل» — "Add no products yet to be fully ready", which is not a
   * sentence in either language. A count is a status; a list of things to add
   * needs a noun.
   */
  const areaNameFor = useCallback(
    (key: ReadinessAreaKey): string => (key === 'products' ? t('readiness.productsArea') : labelFor(key)),
    [t, labelFor],
  );

  // The four facts open a sheet that is always mounted; `products` instead
  // SCROLLS to the catalog section — which `shouldShowProductsSection` holds
  // back until both counts land. While `loading`, `covered.products` is false
  // (both counts read as 0) so the chip is amber, but its scroll target does
  // not exist yet: leaving it tappable there is the very dead tap this chip
  // was made tappable to remove. It arms with the rest of the card.
  const chips: Chip[] = READINESS_AREAS.map((key) => ({
    key,
    label: labelFor(key),
    covered: covered[key],
    ...(key === 'products' && loading ? {} : { fixKey: key }),
  }));

  // Intl.ListFormat renders the locale's own conjunction — never a hand-built
  // «a، b و c». Memoized because the card re-renders on every unrelated
  // /business state change (opening a sheet, toggling the info panel), and an
  // Intl constructor is not free.
  const missingList = useMemo(
    () => (score
      ? new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(score.missing.map(areaNameFor))
      : ''),
    [score, locale, areaNameFor],
  );

  return (
    <section
      aria-label={t('readiness.title')}
      className="rounded-2xl border border-theme-border bg-card p-4 sm:p-5"
    >
      {/* Title and action share ONE row; the hint spans the full card beneath
          them. Previously the hint sat inside the flex row, so once the card was
          narrowed to the reading column the whole row wrapped and dropped the
          button onto a line of its own, floating above the ring. Pairing the
          button with the title instead keeps it anchored at every width — and
          puts it beside the thing it tests rather than a viewport away. */}
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base sm:text-lg font-semibold text-foreground min-w-0">
          {t('readiness.title')}
        </h2>
        <Button type="button" variant="secondary" size="sm" onClick={onTryReply} className="flex-shrink-0">
          <Sparkles className="w-3.5 h-3.5 me-1.5" aria-hidden="true" />
          {t('readiness.tryButton')}
        </Button>
      </div>
      <p className="text-xs sm:text-sm text-muted-foreground mt-1">
        {t('readiness.hint')}
      </p>

      {/* The ring is the mock's headline, but it is never the only carrier of the
          number: the percentage sits beside it as text with role="progressbar".
          The block keeps its footprint whether or not the number is known, so the
          chips below never shift when the count lands (CLS). */}
      <div className="mt-4 flex items-center gap-4" aria-busy={loading}>
        {/* The meter itself is the progressbar. The percentage sentence beside it
            stays PLAIN text: role="progressbar" takes its accessible name from
            aria-label, not from its content, so wrapping the sentence in the role
            would have hidden the words it is made of. */}
        <div
          className="relative flex-shrink-0"
          {...(score
            ? {
              role: 'progressbar',
              'aria-valuenow': score.percent,
              'aria-valuemin': 0,
              'aria-valuemax': 100,
              'aria-label': t('readiness.percentLabel', { percent: score.percent }),
            }
            : {})}
        >
          <ReadinessRing percent={score?.percent ?? 0} />
          {/* The number inside the ring, matching the mock. Hidden from assistive
              tech — the labelled progressbar and the sentence beside it already
              say it, and hearing "60%" three times is noise. */}
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center text-lg sm:text-xl font-semibold text-foreground tabular-nums"
          >
            {score ? `${score.percent}%` : ''}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          {/* The percentage and the fraction were stacked on separate lines, so
              the same fact appeared three times down the card (ring, «80%
              ready», «4 of 5»). The fraction earns its place — it is what makes
              the ring reconcilable against the chips — but as a trailing detail
              on the same line, not as its own claim. */}
          <p className="text-sm font-medium text-foreground">
            {score ? t('readiness.percentLabel', { percent: score.percent }) : ' '}
            {score && (
              <span className="font-normal text-muted-foreground tabular-nums ms-2">
                {t('readiness.coveredOf', { covered: score.covered, total: score.total })}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {score
              ? (score.missing.length > 0
                ? t('readiness.completeAll', { items: missingList })
                : t('readiness.allCovered'))
              : ' '}
          </p>
        </div>
      </div>

      <ul className="flex flex-wrap gap-2 mt-4" aria-busy={loading}>
        {chips.map((chip) => {
          const Icon = chip.covered ? Check : CircleAlert;
          // Five equally-loud pills gave the four settled facts the same visual
          // shout as the one thing left to do. Covered areas go QUIET (the answer
          // to the card's question, stated once) so the amber gaps — the only
          // tappable chips here — carry the emphasis they earn. The per-field
          // detail lives in the fact rows' badges; this row is the summary.
          const chipClass = `inline-flex items-center gap-1.5 rounded-full text-xs font-medium border ${
            chip.covered
              ? 'border-transparent bg-transparent text-muted-foreground'
              : 'status-warning'
          }`;
          const body = (
            <>
              {/* The ICON is what carries covered-vs-gap without colour (check
                  vs alert), so the quiet style below stays WCAG 1.4.1-safe. */}
              <Icon
                className={`w-3.5 h-3.5 flex-shrink-0 ${chip.covered ? 'text-brand-600' : ''}`}
                aria-hidden="true"
              />
              {chip.label}
              <span className="sr-only">
                — {chip.covered ? t('state.covered') : t('state.missing')}
              </span>
            </>
          );
          // An UNCOVERED chip is the shortcut: tap it to fix the gap right here.
          // Covered chips stay inert — nothing to do, and a tappable-looking
          // chip that does nothing is worse than a plain one.
          return (
            <li key={chip.key}>
              {!chip.covered && chip.fixKey && onFixChip ? (
                <button
                  type="button"
                  onClick={() => onFixChip(chip.fixKey!)}
                  aria-label={`${chip.label} — ${t('state.missing')}`}
                  className={`${chipClass} min-h-[44px] ps-3 pe-2.5 hover:brightness-95 active:brightness-90 transition`}
                >
                  {body}
                  <ChevronLeft className="w-3.5 h-3.5 rtl:rotate-180" aria-hidden="true" />
                </button>
              ) : (
                <span className={`${chipClass} px-3 py-1.5`}>{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
