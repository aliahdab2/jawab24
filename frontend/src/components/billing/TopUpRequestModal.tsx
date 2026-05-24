import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { Check, MessageCircle, CreditCard } from 'lucide-react';
import { Modal, Button } from '@/components/ui';
import { subscriptionApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { buildWhatsAppUrl } from '@/lib/whatsapp';

type Pack = '5k' | '10k';

interface TopupConfig {
    packs: Record<string, { repliesAdded: number; priceCents: number }>;
    currency: string;
    whatsappNumber: string;
}

interface TopUpRequestModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** User's primary email for the prefilled WhatsApp message. */
    userEmail?: string;
}

const PACKS_ORDER: Pack[] = ['5k', '10k'];

/**
 * Modal that lets a paying user request a top-up pack.
 *
 * v0 ships ONLY the manual / WhatsApp path. Card payment is stubbed visually
 * as "coming soon" so users see the future direction. PR 2b will wire the
 * actual Stripe PaymentElement here.
 */
export function TopUpRequestModal({ isOpen, onClose, userEmail }: TopUpRequestModalProps) {
    const t = useTranslations('topup');
    const [selectedPack, setSelectedPack] = useState<Pack>('5k');
    const [config, setConfig] = useState<TopupConfig | null>(null);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setLoadError(false);
        subscriptionApi.getTopupConfig()
            .then((res) => setConfig(res.data.data))
            .catch((err) => {
                captureError(err, 'Failed to load top-up config');
                setLoadError(true);
            });
    }, [isOpen]);

    // Three explicit render states: loading (skeleton), error (graceful message),
    // ready (full UI). No hardcoded pricing fallbacks — backend config is the
    // sole source of truth for pack pricing and pack-to-replies mapping.
    const isLoading = !config && !loadError;
    const pack = config?.packs[selectedPack];

    const whatsappUrl = config?.whatsappNumber && pack
        ? buildWhatsAppUrl(
            config.whatsappNumber,
            t('modal.whatsappMessage', {
                repliesCount: pack.repliesAdded,
                pack: selectedPack,
                priceUsd: pack.priceCents / 100,
                email: userEmail ?? '',
            }),
        )
        : null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('modal.title')} size="md">
            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    {t('modal.subtitle')}
                </p>

                {/* Pack picker */}
                <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t('modal.selectPack')}
                    </p>
                    <div className="grid grid-cols-2 gap-3" aria-busy={isLoading}>
                        {isLoading
                            ? PACKS_ORDER.map((p) => <PackSkeleton key={p} />)
                            : PACKS_ORDER.map((p) => (
                                <PackOption
                                    key={p}
                                    pack={p}
                                    priceCents={config?.packs[p]?.priceCents}
                                    selected={selectedPack === p}
                                    onSelect={() => setSelectedPack(p)}
                                />
                            ))}
                    </div>
                    <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        {t('modal.neverExpires')}
                    </p>
                </div>

                {/* Payment methods */}
                <div className="space-y-2 pt-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t('modal.contactToBuy')}
                    </p>

                    {/* Card payment — disabled stub (PR 2b will enable) */}
                    <div
                        className="flex items-start gap-3 p-3 rounded-lg border border-surface-200 dark:border-surface-700 opacity-60"
                        aria-disabled="true"
                    >
                        <CreditCard className="w-5 h-5 text-icon-muted shrink-0 mt-0.5" aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold">{t('method.card')}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{t('method.cardSubtitle')}</p>
                        </div>
                    </div>

                    {/* WhatsApp manual path */}
                    {whatsappUrl ? (
                        <a
                            href={whatsappUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-start gap-3 p-3 rounded-lg border border-emerald-300 hover:border-emerald-400 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30 transition-colors"
                        >
                            <MessageCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold">{t('method.whatsapp')}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">{t('method.whatsappSubtitle')}</p>
                            </div>
                        </a>
                    ) : (
                        <p className="text-sm text-rose-700 dark:text-rose-300 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/30">
                            {t('errors.noContactChannel')}
                        </p>
                    )}

                    {loadError && (
                        <p className="text-xs text-rose-600 dark:text-rose-400">
                            {t('errors.noContactChannel')}
                        </p>
                    )}
                </div>

                <div className="flex justify-end pt-2">
                    <Button variant="secondary" size="sm" onClick={onClose}>
                        {t('modal.close')}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

interface PackOptionProps {
    pack: Pack;
    /** Price in cents from backend config. Undefined while loading. */
    priceCents: number | undefined;
    selected: boolean;
    onSelect: () => void;
}

function PackOption({ pack, priceCents, selected, onSelect }: PackOptionProps) {
    const t = useTranslations('topup');
    const isBestValue = pack === '10k';
    // Backend is the source of truth for pricing; the i18n 'price' string is
    // only a presentational fallback (used if the dollar amount stays stable
    // and we want locale-formatted currency). Backend `priceCents` wins when
    // present so an env override propagates without a code change.
    const priceLabel = priceCents !== undefined
        ? `$${priceCents / 100}`
        : (pack === '5k' ? t('pack5k.price') : t('pack10k.price'));

    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            className={clsx(
                'relative p-4 rounded-lg border-2 text-start transition-colors',
                selected
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                    : 'border-surface-200 hover:border-surface-300 dark:border-surface-700 dark:hover:border-surface-600',
            )}
        >
            {isBestValue && (
                <span className="absolute -top-2 end-2 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {t('pack10k.bestValue')}
                </span>
            )}
            <p className="text-sm font-semibold">{pack === '5k' ? t('pack5k.name') : t('pack10k.name')}</p>
            <p className="text-xl font-bold mt-1">{priceLabel}</p>
        </button>
    );
}

function PackSkeleton() {
    return (
        <div
            aria-hidden="true"
            className="p-4 rounded-lg border-2 border-surface-200 dark:border-surface-700 animate-pulse"
        >
            <div className="h-3.5 w-24 bg-surface-200 dark:bg-surface-700 rounded mb-2" />
            <div className="h-6 w-14 bg-surface-200 dark:bg-surface-700 rounded" />
        </div>
    );
}

