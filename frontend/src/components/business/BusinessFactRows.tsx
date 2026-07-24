import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Clock, MapPin, Truck, CreditCard, Phone, Globe, Check } from 'lucide-react';
import { unwrapBusinessProfile } from '@jawab24/shared';
import type { Page } from '@jawab24/shared';
import type { LucideIcon } from 'lucide-react';

interface BusinessFactRowsProps {
  page: Page;
  /** Focus the free-text editor — the current way to answer a missing fact. */
  onAnswerMissing: () => void;
}

interface FactRow {
  key: string;
  icon: LucideIcon;
  label: string;
  /** Display value; null = not set. */
  value: string | null;
}

/**
 * Structured business facts as read-only rows (B1). Values come from the
 * CONFIRMED merchant half of the business profile only — the same authority
 * the reply pipeline uses. Missing facts show «أجب» pointing the merchant at
 * the editor (the Phase-D interview later replaces this with per-fact
 * questions).
 */
export function BusinessFactRows({ page, onAnswerMissing }: BusinessFactRowsProps) {
  const t = useTranslations('business');

  const rows: FactRow[] = useMemo(() => {
    const { merchant = {} } = unwrapBusinessProfile(page.businessProfile);
    const hasHours = !!merchant.hours && Object.values(merchant.hours).some((v) => Array.isArray(v) && v.length > 0);
    const phones = (merchant.phones ?? []).filter((p) => p?.trim());
    const addressValue = [merchant.address, merchant.city].filter((v) => v?.trim()).join('، ');
    return [
      // Hours are a Record<day, ranges> — a faithful textual summary needs the
      // Phase-D hours editor; until then presence is shown, values are not.
      { key: 'hours', icon: Clock, label: t('facts.hours'), value: hasHours ? '' : null },
      { key: 'address', icon: MapPin, label: t('facts.address'), value: addressValue || null },
      { key: 'phone', icon: Phone, label: t('facts.phone'), value: phones.length ? phones.join(' · ') : null },
      { key: 'website', icon: Globe, label: t('facts.website'), value: merchant.website?.trim() || null },
      { key: 'delivery', icon: Truck, label: t('facts.delivery'), value: merchant.policies?.shipping?.trim() || null },
      { key: 'payment', icon: CreditCard, label: t('facts.payment'), value: merchant.policies?.payment?.trim() || null },
    ];
  }, [page.businessProfile, t]);

  return (
    <section aria-label={t('facts.title')} className="rounded-2xl border border-theme-border bg-card p-4 sm:p-5">
      <h2 className="text-base sm:text-lg font-semibold text-foreground">{t('facts.title')}</h2>
      <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 mb-3">{t('facts.hint')}</p>

      <ul className="divide-y divide-theme-border">
        {rows.map((row) => {
          const Icon = row.icon;
          const isSet = row.value !== null;
          return (
            <li key={row.key} className="flex items-center gap-3 py-2.5">
              <Icon className="w-4 h-4 text-icon-muted flex-shrink-0" aria-hidden="true" />
              <span className="text-sm font-medium text-foreground min-w-[7rem]">{row.label}</span>
              {isSet ? (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground min-w-0 truncate" dir="auto">
                  <Check className="w-3.5 h-3.5 text-brand-600 flex-shrink-0" aria-hidden="true" />
                  {row.value || null}
                </span>
              ) : (
                <>
                  <span className="ms-auto text-xs text-subtle">{t('facts.notSet')}</span>
                  <button
                    type="button"
                    onClick={onAnswerMissing}
                    className="text-xs font-medium text-brand-600 hover:text-brand-700 underline-offset-2 hover:underline"
                  >
                    {t('facts.answerPrompt')}
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
