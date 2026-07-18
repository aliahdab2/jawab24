import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Users } from 'lucide-react';
import clsx from 'clsx';
import { Card } from '@/components/ui';
import { getRoleBadgeColor } from '@/utils/workspaceRole';
import { type CustomerDetail, ROLE_LABEL_KEYS } from './types';

interface Props {
    customer: CustomerDetail;
    isRTL: boolean;
}

export function TeamSection({ customer, isRTL }: Props) {
    const t = useTranslations('admin');

    return (
        <div className="space-y-6">
            {/* Membership / Workspace — clarifies whether this user owns a workspace or
                is a team member in someone else's (which is why they may show no pages
                or plan of their own). The owner link jumps to the billable account. */}
            <Card>
                <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Users className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                    {t('customer.membershipTitle')}
                </h3>
                {customer.workspaces && customer.workspaces.length > 0 ? (
                    <ul className="space-y-3">
                        {customer.workspaces.map((ws) => (
                            <li key={ws.id} className="p-3 border border-theme-border rounded-lg">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-foreground truncate">{ws.name}</span>
                                    <span className={clsx(
                                        'inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full shrink-0',
                                        getRoleBadgeColor(ws.role)
                                    )}>
                                        {t(ROLE_LABEL_KEYS[ws.role] as Parameters<typeof t>[0])}
                                    </span>
                                </div>
                                {ws.isOwner ? (
                                    <p className="text-sm text-muted-foreground mt-1">
                                        {t('customer.membershipOwnerLabel')}
                                        {' · '}
                                        {t('customer.membershipMemberCount', { count: ws.memberCount })}
                                    </p>
                                ) : (
                                    <div className="mt-1">
                                        <p className="text-sm text-muted-foreground" dir="auto">
                                            {t('customer.membershipMemberOf', { owner: ws.ownerName || ws.ownerEmail || '—' })}
                                        </p>
                                        <Link
                                            href={`/admin/customers/detail?userId=${ws.ownerId}`}
                                            className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 hover:underline mt-1"
                                        >
                                            {t('customer.membershipViewOwner')}
                                            <ArrowLeft className={clsx('w-3.5 h-3.5', !isRTL && 'rotate-180')} aria-hidden="true" />
                                        </Link>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-muted-foreground">{t('customer.noWorkspace')}</p>
                )}
            </Card>
        </div>
    );
}
