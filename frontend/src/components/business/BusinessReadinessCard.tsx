import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Check, CircleAlert, Sparkles, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui';
import { unwrapBusinessProfile } from '@jawab24/shared';
import type { Page } from '@jawab24/shared';

interface BusinessReadinessCardProps {
  page: Page;
  /** Catalog item count; undefined while loading. */
  productsCount: number | undefined;
  onTryReply: () => void;
  /**
   * Tap an uncovered chip to fix it on the spot. Without this the merchant has
   * to scroll past the whole product list to reach the fact rows — measured at
   * 4–6 screens on a 390px viewport for a 27-item catalog.
   */
  onFixChip: (key: FixableChipKey) => void;
}

/** Chips that map to a fact the merchant can fill. `products` is not one. */
export type FixableChipKey = 'hours' | 'address' | 'delivery' | 'payment';

interface Chip {
  key: string;
  label: string;
  covered: boolean;
  /** Set when tapping the chip should open the matching fact editor. */
  fixKey?: FixableChipKey;
}

/**
 * «عمّ يستطيع جواب أن يجيب؟» — the top-of-page readiness summary (B1).
 * Green chips = Jawab holds this info; amber = customers may ask and get no
 * answer. Reads only the CONFIRMED merchant half of the business profile
 * (same authority rule as the reply pipeline — suggestions never count as
 * covered) plus the catalog count for products.
 */
export function BusinessReadinessCard({ page, productsCount, onTryReply, onFixChip }: BusinessReadinessCardProps) {
  const t = useTranslations('business');

  const chips: Chip[] = useMemo(() => {
    const { merchant = {} } = unwrapBusinessProfile(page.businessProfile);
    const hasHours = !!merchant.hours && Object.values(merchant.hours).some((v) => Array.isArray(v) && v.length > 0);
    return [
      {
        key: 'products',
        label: t('readiness.productsChip', { count: productsCount ?? 0 }),
        covered: (productsCount ?? 0) > 0,
      },
      { key: 'hours', label: t('readiness.hoursChip'), covered: hasHours, fixKey: 'hours' },
      { key: 'address', label: t('readiness.addressChip'), covered: !!merchant.address?.trim(), fixKey: 'address' },
      { key: 'delivery', label: t('readiness.deliveryChip'), covered: !!merchant.policies?.shipping?.trim(), fixKey: 'delivery' },
      { key: 'payment', label: t('readiness.paymentChip'), covered: !!merchant.policies?.payment?.trim(), fixKey: 'payment' },
    ];
  }, [page.businessProfile, productsCount, t]);

  return (
    <section
      aria-label={t('readiness.title')}
      className="rounded-2xl border border-theme-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-foreground">
            {t('readiness.title')}
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {t('readiness.hint')}
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onTryReply}>
          <Sparkles className="w-3.5 h-3.5 me-1.5" aria-hidden="true" />
          {t('readiness.tryButton')}
        </Button>
      </div>

      <ul className="flex flex-wrap gap-2 mt-3" aria-busy={productsCount === undefined}>
        {chips.map((chip) => {
          const Icon = chip.covered ? Check : CircleAlert;
          const chipClass = `inline-flex items-center gap-1.5 rounded-full text-xs font-medium border ${
            chip.covered
              ? 'status-active border-transparent'
              : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800/40'
          }`;
          const body = (
            <>
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              {chip.label}
              <span className="sr-only">
                — {chip.covered ? t('readiness.covered') : t('readiness.missing')}
              </span>
            </>
          );
          // An UNCOVERED chip is the shortcut: tap it to fix the gap right here.
          // Covered chips stay inert — nothing to do, and a tappable-looking
          // chip that does nothing is worse than a plain one.
          return (
            <li key={chip.key}>
              {!chip.covered && chip.fixKey ? (
                <button
                  type="button"
                  onClick={() => onFixChip(chip.fixKey!)}
                  aria-label={`${chip.label} — ${t('readiness.missing')}`}
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
