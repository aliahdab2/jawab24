import React from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { isAnyChannelReplying } from '@jawab24/shared';
import { ChannelBadges } from '@/components/ui';
import { useChannelBadgeLabels } from '@/hooks';
import { type CustomerDetail, PAGE_OFF_REASON_KEYS } from './types';

type CustomerPage = CustomerDetail['pages'][number];

/**
 * The reply state of one page card on the support console: a summary pill
 * (disconnected / replying / off, with the recorded reason when there is one)
 * followed by the per-channel fingerprint — colored = replying, muted =
 * connected but off, absent = not connected.
 *
 * The pill asks the CONNECTED channels (`isAnyChannelReplying`), never the
 * Facebook column alone: a WhatsApp-only card has `autoReplyEnabled=false` by
 * definition, and keying on it labelled a merchant whose WhatsApp answered
 * every message as "Auto-reply off" (2026-08-29). The badges exist so support
 * can see WHICH channel is off without a second lookup.
 */
export function PageChannelStatus({ page }: { page: CustomerPage }) {
    const t = useTranslations('admin');
    const labels = useChannelBadgeLabels(page);
    const replying = isAnyChannelReplying(page);

    return (
        <>
            <span
                className={clsx(
                    'text-xs px-2 py-0.5 rounded-full border whitespace-nowrap',
                    page.disconnected
                        ? 'status-error'
                        : replying
                            ? 'status-success'
                            : 'status-warning',
                )}
            >
                {page.disconnected
                    ? t('customer.pageDisconnected')
                    : replying
                        ? t('customer.pageReplyOn')
                        : t(
                            (page.autoReplyDisabledReason && PAGE_OFF_REASON_KEYS[page.autoReplyDisabledReason])
                            || 'customer.pageReplyOff',
                        )}
            </span>
            <ChannelBadges page={page} labels={labels} />
        </>
    );
}
