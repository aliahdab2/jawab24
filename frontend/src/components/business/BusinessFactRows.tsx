import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Clock, MapPin, Truck, CreditCard, Phone, Globe, ChevronLeft } from 'lucide-react';
import { WhatsAppIcon } from '@/components/ui';
import { unwrapBusinessProfile } from '@jawab24/shared';
import type { Page } from '@jawab24/shared';
import type { LucideIcon } from 'lucide-react';
import type { EditableFactKey } from './BusinessFactSheet';
import { parseWeek, summarizeWeek, type DayKey } from '@/utils/businessHours';

/** Row keys = the editable facts plus `hours`, which has its own day/range sheet. */
export type FactRowKey = EditableFactKey | 'hours';

interface BusinessFactRowsProps {
  page: Page;
  /** Open the single-field sheet for an editable fact. */
  onEditFact: (key: EditableFactKey) => void;
  /** Open the structured day/range hours sheet. */
  onEditHours: () => void;
}

interface FactRow {
  key: FactRowKey;
  /** Widened from LucideIcon: WhatsApp needs its own brand mark, and a generic
   *  phone glyph would read as "call", which is the wrong affordance. */
  icon: LucideIcon | React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  /** Display value; null = not set. Empty string = set but not renderable (hours). */
  value: string | null;
  /** Richer rendering when plain text can't carry the meaning (the WhatsApp
   *  mark on a phone number). `value` still drives the is-set logic. */
  valueNode?: React.ReactNode;
  /** A connected store already answers this fact when the merchant hasn't. */
  storeAnswered?: boolean;
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
    // Show the actual week, grouped — a merchant with different Friday hours
    // needs to SEE that from the row, not discover it by opening the sheet.
    const hoursValue = hasHours
      ? summarizeWeek(parseWeek(merchant.hours), {
        closed: t('facts.hoursClosed'),
        allDay: t('facts.hoursAllDay'),
        day: (key: DayKey) => t(`facts.day_${key}`),
      })
      : null;
    const phones = (merchant.phones ?? []).filter((p) => p?.trim());
    const whatsapp = merchant.channels?.whatsapp?.trim();
    const addressValue = [merchant.address, merchant.city].filter((v) => v?.trim()).join('، ');
    return [
      { key: 'hours', icon: Clock, value: hoursValue },
      { key: 'address', icon: MapPin, value: addressValue || null },
      // WhatsApp is a MARK on a number, not a row of its own: in this market it
      // is nearly always a SIM the merchant already listed, so a second row meant
      // the same digits typed twice and two copies to keep in sync.
      {
        key: 'phone',
        icon: Phone,
        value: phones.length ? phones.join(' · ') : null,
        valueNode: phones.length ? (
          <span className="inline-flex items-center gap-1 min-w-0">
            {phones.map((p, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                {i > 0 && <span aria-hidden="true" className="text-subtle">·</span>}
                <span>{p}</span>
                {whatsapp && p.trim() === whatsapp && (
                  <WhatsAppIcon size={12} className="text-brand-600 flex-shrink-0" aria-label={t('facts.whatsapp')} />
                )}
              </span>
            ))}
          </span>
        ) : undefined,
      },
      // Delivery and payment sit above website on purpose: customers ask about
      // both constantly, while nobody messages a shop to ask whether it has a
      // website. Ordering by question volume, not by field type.
      // When the store genuinely answers these, an empty value is NOT a gap — so
      // the row says so instead of nagging. It stays tappable: writing a value is
      // a deliberate override.
      // Keyed on `storeAnswersPolicies`, NOT on `ecommerceStoreId`: the id stays
      // set after a platform-side uninstall and on a store that synced no policy
      // text, and in both cases the model receives nothing. Claiming an answer
      // there would talk the merchant out of writing the one fact their customers
      // ask about most.
      {
        key: 'delivery',
        icon: Truck,
        value: merchant.policies?.shipping?.trim() || null,
        storeAnswered: !!page.storeAnswersPolicies,
      },
      {
        key: 'payment',
        icon: CreditCard,
        value: merchant.policies?.payment?.trim() || null,
        storeAnswered: !!page.storeAnswersPolicies,
      },
      { key: 'website', icon: Globe, value: merchant.website?.trim() || null },
    ];
  }, [page.businessProfile, page.storeAnswersPolicies, t]);

  return (
    <section aria-label={t('facts.title')} className="rounded-2xl border border-theme-border bg-card p-4 sm:p-5">
      <h2 className="text-base sm:text-lg font-semibold text-foreground">{t('facts.title')}</h2>
      <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 mb-2">{t('facts.hint')}</p>

      <ul className="divide-y divide-theme-border -mx-4 sm:-mx-5">
        {rows.map((row) => {
          const Icon = row.icon;
          const isSet = row.value !== null;
          const storeAnswers = !isSet && !!row.storeAnswered;
          return (
            <li key={row.key}>
              <button
                type="button"
                onClick={() => (row.key === 'hours' ? onEditHours() : onEditFact(row.key))}
                // 56px row: the whole thing is the tap target (was a 19×16px link).
                className="w-full min-h-[56px] flex items-center gap-3 px-4 sm:px-5 py-2.5 text-start hover:bg-surface-100 active:bg-surface-200 transition-colors"
              >
                <Icon
                  className={`w-5 h-5 flex-shrink-0 ${isSet || storeAnswers ? 'text-brand-600' : 'text-icon-muted'}`}
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
                    className={`block text-xs truncate ${isSet || storeAnswers ? 'text-muted-foreground' : 'text-brand-600'}`}
                  >
                    {isSet
                      ? (row.valueNode ?? (row.value || t('facts.isSet')))
                      : storeAnswers
                        ? t('facts.storeAnswered')
                        : t(`facts.add_${row.key}`)}
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
