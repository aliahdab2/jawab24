import React from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';

export const CUSTOMER_TABS = ['overview', 'billing', 'ai', 'team'] as const;
export type CustomerTab = (typeof CUSTOMER_TABS)[number];

/** Coerce an arbitrary ?tab= query value to a valid tab, defaulting to overview. */
export function normalizeTab(value: string | string[] | undefined): CustomerTab {
    const v = Array.isArray(value) ? value[0] : value;
    return (CUSTOMER_TABS as readonly string[]).includes(v ?? '')
        ? (v as CustomerTab)
        : 'overview';
}

const TAB_LABEL_KEYS: Record<CustomerTab, string> = {
    overview: 'customer.tabOverview',
    billing: 'customer.tabBilling',
    ai: 'customer.tabAi',
    team: 'customer.tabTeam',
};

interface Props {
    active: CustomerTab;
    onChange: (tab: CustomerTab) => void;
}

export function CustomerTabs({ active, onChange }: Props) {
    const t = useTranslations('admin');

    return (
        <div
            role="tablist"
            aria-label={t('customer.title')}
            className="flex items-center gap-2 overflow-x-auto border-b border-theme-border pb-px"
        >
            {CUSTOMER_TABS.map((tab) => {
                const isActive = active === tab;
                return (
                    <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => onChange(tab)}
                        className={clsx(
                            'px-3 sm:px-4 py-1.5 sm:py-2 min-h-[44px] sm:min-h-0 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-all duration-200',
                            isActive
                                ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/25'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/80',
                        )}
                    >
                        {t(TAB_LABEL_KEYS[tab] as Parameters<typeof t>[0])}
                    </button>
                );
            })}
        </div>
    );
}
