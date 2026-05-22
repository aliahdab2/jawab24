import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui';
import type { CatalogItem } from '@/lib/api';

export type CatalogStatus = 'active' | 'expiring_soon' | 'expired' | 'archived';

const EXPIRING_SOON_DAYS = 7;

/** Client-side status derivation — mirrors backend computeStatus(). */
export function computeStatus(item: Pick<CatalogItem, 'archivedAt' | 'endsAt'>, now: Date = new Date()): CatalogStatus {
    if (item.archivedAt) return 'archived';
    if (!item.endsAt) return 'active';
    const endsAt = new Date(item.endsAt);
    if (endsAt <= now) return 'expired';
    const msUntilEnd = endsAt.getTime() - now.getTime();
    if (msUntilEnd <= EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000) return 'expiring_soon';
    return 'active';
}

interface Props {
    status: CatalogStatus;
}

export function CatalogStatusBadge({ status }: Props) {
    const t = useTranslations('catalog');
    const variant: 'success' | 'warning' | 'default' = status === 'active'
        ? 'success'
        : status === 'expiring_soon'
            ? 'warning'
            : 'default';
    const labelKey = status === 'expiring_soon' ? 'expiringSoon' : status;
    return <Badge variant={variant} size="sm">{t(`status.${labelKey}`)}</Badge>;
}
