import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Check, CircleAlert, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui';
import { unwrapBusinessProfile } from '@jawab24/shared';
import type { Page } from '@jawab24/shared';

interface BusinessReadinessCardProps {
  page: Page;
  /** Catalog item count; undefined while loading. */
  productsCount: number | undefined;
  onTryReply: () => void;
}

interface Chip {
  key: string;
  label: string;
  covered: boolean;
}

/**
 * «عمّ يستطيع جواب أن يجيب؟» — the top-of-page readiness summary (B1).
 * Green chips = Jawab holds this info; amber = customers may ask and get no
 * answer. Reads only the CONFIRMED merchant half of the business profile
 * (same authority rule as the reply pipeline — suggestions never count as
 * covered) plus the catalog count for products.
 */
export function BusinessReadinessCard({ page, productsCount, onTryReply }: BusinessReadinessCardProps) {
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
      { key: 'hours', label: t('readiness.hoursChip'), covered: hasHours },
      { key: 'address', label: t('readiness.addressChip'), covered: !!merchant.address?.trim() },
      { key: 'delivery', label: t('readiness.deliveryChip'), covered: !!merchant.policies?.shipping?.trim() },
      { key: 'payment', label: t('readiness.paymentChip'), covered: !!merchant.policies?.payment?.trim() },
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
        {chips.map((chip) => (
          <li
            key={chip.key}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
              chip.covered
                ? 'status-active border-transparent'
                : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800/40'
            }`}
          >
            {chip.covered ? (
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <CircleAlert className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {chip.label}
            <span className="sr-only">
              — {chip.covered ? t('readiness.covered') : t('readiness.missing')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
