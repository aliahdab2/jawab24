import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Clock, MapPin, Truck, CreditCard, Phone, Globe, ChevronLeft } from 'lucide-react';
import { unwrapBusinessProfile } from '@jawab24/shared';
import type { Page } from '@jawab24/shared';
import type { LucideIcon } from 'lucide-react';
import type { EditableFactKey } from './BusinessFactSheet';

/** Row keys = the editable facts plus `hours`, which routes to the free-text
 *  editor until the Phase-D day/range editor exists. */
export type FactRowKey = EditableFactKey | 'hours';

interface BusinessFactRowsProps {
  page: Page;
  /** Open the single-field sheet for an editable fact. */
  onEditFact: (key: EditableFactKey) => void;
  /** `hours` has no sheet yet — hand it to the free-text Business Info editor. */
  onEditHours: () => void;
}

interface FactRow {
  key: FactRowKey;
  icon: LucideIcon;
  /** Display value; null = not set. Empty string = set but not renderable (hours). */
  value: string | null;
}

/**
 * Business facts as tappable rows (B1 part 2 — mobile-first rewrite).
 *
 * The first version rendered a read-only table whose only action was a 19×16px
 * «حدّد» link — measured on a 390px viewport, roughly a sixth of the 44px
 * minimum tap target, and the owner mis-tapped it immediately. This replaces it
 * with the iOS-Settings row pattern merchants already know from their phone:
 * the WHOLE row is the target (56px), a chevron signals "this opens something",
 * and the prompt text sits where the value will appear — so one line does the
 * job of the old value + action pair.
 *
 * Values come from the CONFIRMED merchant half only — the same authority the
 * reply pipeline uses (suggestions never count as set).
 */
export function BusinessFactRows({ page, onEditFact, onEditHours }: BusinessFactRowsProps) {
  const t = useTranslations('business');

  const rows: FactRow[] = useMemo(() => {
    const { merchant = {} } = unwrapBusinessProfile(page.businessProfile);
    const hasHours = !!merchant.hours && Object.values(merchant.hours).some((v) => Array.isArray(v) && v.length > 0);
    const phones = (merchant.phones ?? []).filter((p) => p?.trim());
    const addressValue = [merchant.address, merchant.city].filter((v) => v?.trim()).join('، ');
    return [
      { key: 'hours', icon: Clock, value: hasHours ? '' : null },
      { key: 'address', icon: MapPin, value: addressValue || null },
      { key: 'phone', icon: Phone, value: phones.length ? phones.join(' · ') : null },
      { key: 'website', icon: Globe, value: merchant.website?.trim() || null },
      { key: 'delivery', icon: Truck, value: merchant.policies?.shipping?.trim() || null },
      { key: 'payment', icon: CreditCard, value: merchant.policies?.payment?.trim() || null },
    ];
  }, [page.businessProfile]);

  return (
    <section aria-label={t('facts.title')} className="rounded-2xl border border-theme-border bg-card p-4 sm:p-5">
      <h2 className="text-base sm:text-lg font-semibold text-foreground">{t('facts.title')}</h2>
      <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 mb-2">{t('facts.hint')}</p>

      <ul className="divide-y divide-theme-border -mx-4 sm:-mx-5">
        {rows.map((row) => {
          const Icon = row.icon;
          const isSet = row.value !== null;
          return (
            <li key={row.key}>
              <button
                type="button"
                onClick={() => (row.key === 'hours' ? onEditHours() : onEditFact(row.key))}
                // 56px row: the whole thing is the tap target (was a 19×16px link).
                className="w-full min-h-[56px] flex items-center gap-3 px-4 sm:px-5 py-2.5 text-start hover:bg-surface-100 active:bg-surface-200 transition-colors"
              >
                <Icon
                  className={`w-5 h-5 flex-shrink-0 ${isSet ? 'text-brand-600' : 'text-icon-muted'}`}
                  aria-hidden="true"
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    {t(`facts.${row.key}`)}
                  </span>
                  {/* The prompt sits where the value will be — one line does the
                      job of the old "not set" + "set" pair. */}
                  {/* No dir="auto" here: a digits-only value (a phone number) has
                      no STRONG directional character, so `auto` falls back to LTR
                      and left-aligns the whole row's value in an RTL page. Letting
                      it inherit the page direction keeps every row aligned, while
                      bidi still renders the digit run itself left-to-right. */}
                  <span
                    className={`block text-xs truncate ${isSet ? 'text-muted-foreground' : 'text-brand-600'}`}
                  >
                    {isSet ? (row.value || t('facts.isSet')) : t(`facts.add_${row.key}`)}
                  </span>
                </span>
                <ChevronLeft
                  className="w-4 h-4 text-icon-muted flex-shrink-0 rtl:rotate-180"
                  aria-hidden="true"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
