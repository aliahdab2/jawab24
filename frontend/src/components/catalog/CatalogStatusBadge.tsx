import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui';
import {
    computeCatalogStatus as computeStatusShared,
    type CatalogEntityStatus,
} from '@jawab24/shared';
import type { CatalogItem } from '@/lib/api';

// Re-export the canonical computeCatalogStatus so existing callers
// (CatalogItemCard) keep working. Local thin alias accepts the frontend's
// CatalogItem shape directly.
export function computeStatus(
    item: Pick<CatalogItem, 'archivedAt' | 'endsAt'>,
    now: Date = new Date(),
): CatalogEntityStatus {
    return computeStatusShared(item, now);
}

export type CatalogStatus = CatalogEntityStatus;

interface Props {
    status: CatalogEntityStatus;
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
