import { useTranslations } from 'next-intl';
import { Pencil, Archive, RotateCcw, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui';
import { useLanguage } from '@/i18n/hooks';
import { CatalogStatusBadge, computeStatus } from './CatalogStatusBadge';
import type { CatalogItem } from '@/lib/api';

interface Props {
    item: CatalogItem;
    onEdit?: () => void;
    onArchive?: () => void;
    onRestore?: () => void;
    onDeletePermanent?: () => void;
}

function formatPrice(priceMinor: number | null | undefined, currency: string | null | undefined, locale: string): string | null {
    if (priceMinor == null || !currency) return null;
    const amount = priceMinor / 100;
    try {
        return new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en', {
            style: 'currency',
            currency,
            maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
        }).format(amount);
    } catch {
        return `${amount} ${currency}`;
    }
}

function formatDate(iso: string | null | undefined, locale: string): string | null {
    if (!iso) return null;
    try {
        return new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        }).format(new Date(iso));
    } catch {
        return iso;
    }
}

export function CatalogItemCard({ item, onEdit, onArchive, onRestore, onDeletePermanent }: Props) {
    const t = useTranslations('catalog');
    const { language } = useLanguage();
    const status = computeStatus(item);
    const price = formatPrice(item.priceMinor, item.currency, language);
    const startsAt = formatDate(item.startsAt, language);
    const endsAt = formatDate(item.endsAt, language);
    const enrollmentClosesAt = formatDate(item.enrollmentClosesAt, language);
    const isArchived = status === 'archived';

    return (
        <Card className="p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-base text-foreground truncate">{item.name}</h3>
                    {item.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
                    )}
                </div>
                <CatalogStatusBadge status={status} />
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-semibold text-foreground">
                    {price ?? <span className="text-muted-foreground italic">{t('card.freePrice')}</span>}
                </span>
                {startsAt && <span className="text-muted-foreground">{t('card.startsAt', { date: startsAt })}</span>}
                {endsAt && <span className="text-muted-foreground">{t('card.endsAt', { date: endsAt })}</span>}
                {enrollmentClosesAt && (
                    <span className="text-muted-foreground">{t('card.enrollmentCloses', { date: enrollmentClosesAt })}</span>
                )}
            </div>

            {(onEdit || (onArchive && !isArchived) || (onRestore && isArchived) || (onDeletePermanent && isArchived)) && (
                <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-theme-border">
                    {/* Permanent-delete is only surfaced for archived items —
                        two-step gate that matches backend enforcement (409 on
                        non-archived). Keep it visually distinct from Archive. */}
                    {onDeletePermanent && isArchived && (
                        <button
                            type="button"
                            onClick={onDeletePermanent}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-error hover:bg-error/10 rounded-md transition-colors"
                        >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            {t('card.deletePermanent')}
                        </button>
                    )}
                    {onEdit && (
                        <button
                            type="button"
                            onClick={onEdit}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                        >
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                            {t('card.edit')}
                        </button>
                    )}
                    {onArchive && !isArchived && (
                        <button
                            type="button"
                            onClick={onArchive}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-muted-foreground hover:text-error hover:bg-muted rounded-md transition-colors"
                        >
                            <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                            {t('card.archive')}
                        </button>
                    )}
                    {onRestore && isArchived && (
                        <button
                            type="button"
                            onClick={onRestore}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-brand-600 hover:text-brand-700 hover:bg-muted rounded-md transition-colors"
                        >
                            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                            {t('card.restore')}
                        </button>
                    )}
                </div>
            )}
        </Card>
    );
}
