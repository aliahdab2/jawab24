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
    // A severed WhatsApp link outranks "replying": the token still validates
    // and the toggle reads on, but no webhook arrives — the state that kept
    // this console saying "All good" through the 27h Z net outage (2026-09-01).
    // Guarded on `whatsappConnected`, the SAME guard computeHealthFlags applies:
    // a card whose WhatsApp was disconnected entirely (token cleared) can keep a
    // stale reason, and a red reconnect pill on a card with no WhatsApp channel
    // — no badge, no dot — would send support hunting a number that isn't there.
    const waNeedsReconnect = page.whatsappConnected && page.whatsappNeedsReconnect;

    return (
        <>
            <span
                className={clsx(
                    'text-xs px-2 py-0.5 rounded-full border whitespace-nowrap',
                    page.disconnected || waNeedsReconnect
                        ? 'status-error'
                        : replying
                            ? 'status-success'
                            : 'status-warning',
                )}
            >
                {page.disconnected
                    ? t('customer.pageDisconnected')
                    : waNeedsReconnect
                        ? t('customer.pageWhatsappReconnect')
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
