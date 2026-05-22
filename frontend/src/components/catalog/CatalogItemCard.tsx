import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui';
import { useLanguage } from '@/i18n/hooks';
import { CatalogStatusBadge, computeStatus } from './CatalogStatusBadge';
import type { CatalogItem } from '@/lib/api';

interface Props {
    item: CatalogItem;
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

export function CatalogItemCard({ item }: Props) {
    const t = useTranslations('catalog');
    const { language } = useLanguage();
    const status = computeStatus(item);
    const price = formatPrice(item.priceMinor, item.currency, language);
    const startsAt = formatDate(item.startsAt, language);
    const endsAt = formatDate(item.endsAt, language);
    const enrollmentClosesAt = formatDate(item.enrollmentClosesAt, language);

    return (
        <Card className="p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-base text-surface-900 truncate">{item.name}</h3>
                    {item.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
                    )}
                </div>
                <CatalogStatusBadge status={status} />
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-semibold text-surface-900">
                    {price ?? <span className="text-muted-foreground italic">{t('card.freePrice')}</span>}
                </span>
                {startsAt && <span className="text-muted-foreground">{t('card.startsAt', { date: startsAt })}</span>}
                {endsAt && <span className="text-muted-foreground">{t('card.endsAt', { date: endsAt })}</span>}
                {enrollmentClosesAt && (
                    <span className="text-muted-foreground">{t('card.enrollmentCloses', { date: enrollmentClosesAt })}</span>
                )}
            </div>
        </Card>
    );
}
