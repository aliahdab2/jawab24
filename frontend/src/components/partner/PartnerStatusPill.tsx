import React from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import type { PartnerMerchantStatus } from '@/lib/api';

/**
 * The merchant-status pill shown in the partner portal.
 *
 * Shared by the merchant list and the merchant detail page so the two can never
 * disagree on a label or a colour — the status itself is derived once on the
 * server (partnerPortal.deriveStatus) and rendered once here.
 */
const STATUS_STYLE: Record<PartnerMerchantStatus, string> = {
    trialing: 'status-info',
    trial_expired: 'status-warning',
    active: 'status-success',
    expired: 'bg-muted text-muted-foreground',
    past_due: 'status-error',
    canceled: 'status-error',
    paused: 'bg-muted text-muted-foreground',
    none: 'bg-muted text-muted-foreground',
};

const STATUS_KEY: Record<PartnerMerchantStatus, string> = {
    trialing: 'statusTrialing',
    trial_expired: 'statusTrialExpired',
    active: 'statusActive',
    expired: 'statusExpired',
    past_due: 'statusPastDue',
    canceled: 'statusCanceled',
    paused: 'statusPaused',
    none: 'statusNone',
};

export function PartnerStatusPill({ status }: { status: PartnerMerchantStatus }) {
    const t = useTranslations('partner');
    const style = STATUS_STYLE[status] ?? STATUS_STYLE.none;
    const key = STATUS_KEY[status] ?? STATUS_KEY.none;

    return (
        <span className={clsx('inline-flex px-2 py-1 text-xs font-medium rounded-full whitespace-nowrap', style)}>
            {t(key as Parameters<typeof t>[0])}
        </span>
    );
}
