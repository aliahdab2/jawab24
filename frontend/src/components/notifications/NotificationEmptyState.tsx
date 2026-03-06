import React from 'react';
import { Inbox, Bell } from 'lucide-react';
import { useTranslation } from '@/i18n';

interface NotificationEmptyStateProps {
    variant: 'global' | 'filtered';
    filterName?: string;
}

export function NotificationEmptyState({ variant, filterName }: NotificationEmptyStateProps) {
    const { t } = useTranslation();

    if (variant === 'global') {
        return (
            <div className="py-12 px-6 text-center">
                <div className="w-16 h-16 rounded-2xl bg-surface-100 flex items-center justify-center mx-auto mb-5">
                    <Inbox className="w-8 h-8 text-icon-muted" aria-hidden="true" />
                </div>
                <p className="text-sm font-semibold text-surface-500 mb-1">
                    {t('notifications.empty')}
                </p>
                <p className="text-xs text-muted-foreground max-w-[220px] mx-auto leading-relaxed">
                    {t('notifications.emptyDescription')}
                </p>
            </div>
        );
    }

    return (
        <div className="py-10 px-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-surface-100 flex items-center justify-center mx-auto mb-4">
                <Bell className="w-6 h-6 text-icon-muted" aria-hidden="true" />
            </div>
            <p className="text-sm text-muted-foreground">
                {t('notifications.emptyFiltered', { category: filterName ?? '' })}
            </p>
        </div>
    );
}
