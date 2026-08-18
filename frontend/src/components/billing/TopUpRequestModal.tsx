import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import clsx from 'clsx';
import { Check, MessageCircle, CreditCard, AlertCircle, ChevronRight } from 'lucide-react';
// Direct imports, NOT the '@/components/ui' barrel — reached from a public
// page. See components/layout/PublicLayout.tsx.
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { subscriptionApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { buildWhatsAppUrl, DEFAULT_SUPPORT_WHATSAPP_NUMBER } from '@/lib/whatsapp';

type Pack = '5k' | '10k';

interface TopupConfig {
    /** Card top-up kill-switch. When false, only the manual WhatsApp path shows. */
    enabled: boolean;
    packs: Record<string, { repliesAdded: number; priceCents: number }>;
    currency: string;
    whatsappNumber: string;
}

interface TopUpRequestModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** User's primary email for the prefilled WhatsApp/email message. */
    userEmail?: string;
}

const PACKS_ORDER: Pack[] = ['5k', '10k'];

/**
 * Modal that lets a paying user buy a top-up pack.
 *
 * The modal is only a PACK PICKER + payment-method launcher — it does not host
 * the Stripe form. Card payment links to the shared /checkout page (the same
 * flow pricing uses), which enforces every payment rule in one place: sanctions
 * block, iOS→web redirect, login gate, and the branded Stripe PaymentElement.
 * Keeping the payment UI on /checkout (instead of re-embedding Stripe here)
 * avoids duplicating those rules.
 *
 * Render states:
 *  - loading: skeleton placeholders
 *  - available: pack picker + "Pay with card" link + (WhatsApp manual path when
 *    a support number is configured — the MENA bank-transfer / USDT / cash
 *    fallback)
 *  - unavailable: config failed to load — shows a WhatsApp fallback so the user
 *    always has an actionable next step
 */
export function TopUpRequestModal({ isOpen, onClose, userEmail }: TopUpRequestModalProps) {
    const t = useTranslations('topup');
    const [selectedPack, setSelectedPack] = useState<Pack>('5k');
    const [config, setConfig] = useState<TopupConfig | null>(null);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        // Reset both before fetching so stale data from a previous open doesn't
        // flash through before the new request resolves.
        setConfig(null);
        setLoadError(false);
        subscriptionApi.getTopupConfig()
            .then((res) => setConfig(res.data.data))
            .catch((err) => {
                captureError(err, 'Failed to load top-up config');
                setLoadError(true);
            });
    }, [isOpen]);

    const isLoading = !config && !loadError;

    // Loading state: skeleton inside the same modal shell so the user sees the
    // title immediately and doesn't perceive a layout shift when config lands.
    if (isLoading) {
        return (
            <Modal isOpen={isOpen} onClose={onClose} title={t('modal.title')} size="md">
                <div className="space-y-4" aria-busy="true">
                    <div className="h-4 w-3/4 bg-surface-200 dark:bg-surface-300 rounded animate-pulse" />
                    <div className="grid grid-cols-2 gap-3">
                        {PACKS_ORDER.map((p) => <PackSkeleton key={p} />)}
                    </div>
                    <div className="h-16 bg-surface-100 dark:bg-surface-300 rounded animate-pulse" />
                </div>
            </Modal>
        );
    }

    // Unavailable state: config failed to load, so we can't show pack prices.
    // Card payment lives on /checkout regardless, but without prices the picker
    // is meaningless — fall back to a WhatsApp contact path.
    if (loadError || !config) {
        return (
            <Modal isOpen={isOpen} onClose={onClose} title={t('unavailable.title')} size="md">
                <UnavailableState onClose={onClose} userEmail={userEmail} />
            </Modal>
        );
    }

    // TS now narrows `config`. Guard `pack` defensively in case the backend
    // response omits a known pack id.
    const pack = config.packs[selectedPack];
    if (!pack) {
        return (
            <Modal isOpen={isOpen} onClose={onClose} title={t('unavailable.title')} size="md">
                <UnavailableState onClose={onClose} userEmail={userEmail} />
            </Modal>
        );
    }

    const cardAvailable = config.enabled;
    const whatsappAvailable = !!config.whatsappNumber;

    // No purchase path at all (card killed AND no manual channel) → unavailable.
    if (!cardAvailable && !whatsappAvailable) {
        return (
            <Modal isOpen={isOpen} onClose={onClose} title={t('unavailable.title')} size="md">
                <UnavailableState onClose={onClose} userEmail={userEmail} />
            </Modal>
        );
    }
    // Two i18n keys (with/without email line) keep translator-facing strings
    // simple and let phone-only users avoid a dangling "My email: " line.
    const whatsappUrl = whatsappAvailable
        ? buildWhatsAppUrl(
            config.whatsappNumber,
            t(userEmail ? 'modal.whatsappMessageWithEmail' : 'modal.whatsappMessage', {
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
                    <div className="grid grid-cols-2 gap-3">
                        {PACKS_ORDER.map((p) => (
                            <PackOption
                                key={p}
                                pack={p}
                                priceCents={config.packs[p]?.priceCents}
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

                    {/* Card payment — links to the shared /checkout flow (same rules
                        as pricing: sanctions, login, native→web, Stripe form).
                        Hidden when the card top-up kill-switch is off. */}
                    {cardAvailable && (
                        <Link
                            href={`/checkout?topup=${selectedPack}`}
                            onClick={onClose}
                            className="flex items-center gap-3 p-3 rounded-lg border border-brand-300 hover:border-brand-500 hover:bg-brand-50 dark:border-brand-700 dark:hover:bg-brand-900/30 transition-colors"
                        >
                            <CreditCard className="w-5 h-5 text-brand-600 dark:text-brand-400 shrink-0" aria-hidden="true" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold">{t('method.card')}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">{t('method.cardSubtitle')}</p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-icon-muted shrink-0 rtl:rotate-180" aria-hidden="true" />
                        </Link>
                    )}

                    {/* WhatsApp manual path — bank transfer / USDT / cash */}
                    {whatsappUrl && (
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

interface UnavailableStateProps {
    onClose: () => void;
    userEmail?: string;
}

/**
 * Fallback when the top-up config fails to load (so pack prices are unknown).
 * Shows a WhatsApp contact path so the user always has an actionable next step.
 * Emits a Sentry breadcrumb on mount so the team learns about the failure from
 * monitoring rather than customer complaints.
 */
function UnavailableState({ onClose, userEmail }: UnavailableStateProps) {
    const t = useTranslations('topup');

    useEffect(() => {
        captureError(
            new Error('topup_config_load_failed'),
            'Top-up modal rendered unavailable state',
            { tags: { feature: 'topup', cause: 'load_failed' } },
        );
    }, []);

    const messageKey = userEmail ? 'unavailable.whatsappMessageWithEmail' : 'unavailable.whatsappMessage';
    const whatsappUrl = buildWhatsAppUrl(
        DEFAULT_SUPPORT_WHATSAPP_NUMBER,
        t(messageKey, { email: userEmail ?? '' }),
    );

    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg border status-info">
                <AlertCircle
                    className="w-5 h-5 shrink-0 mt-0.5"
                    aria-hidden="true"
                />
                <p className="text-sm leading-relaxed">
                    {t('errors.loadFailed')}
                </p>
            </div>

            <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full p-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold transition-colors"
            >
                <MessageCircle className="w-4 h-4" aria-hidden="true" />
                {t('unavailable.whatsappButton')}
            </a>

            <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={onClose}>
                    {t('modal.close')}
                </Button>
            </div>
        </div>
    );
}

interface PackOptionProps {
    pack: Pack;
    /** Price in cents from backend config. Always defined in the available state. */
    priceCents: number | undefined;
    selected: boolean;
    onSelect: () => void;
}

function PackOption({ pack, priceCents, selected, onSelect }: PackOptionProps) {
    const t = useTranslations('topup');
    const isBestValue = pack === '10k';

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
            <p className="text-xl font-bold mt-1">
                {priceCents !== undefined ? `$${priceCents / 100}` : '—'}
            </p>
        </button>
    );
}

function PackSkeleton() {
    return (
        <div
            aria-hidden="true"
            className="p-4 rounded-lg border-2 border-surface-200 dark:border-surface-700 animate-pulse"
        >
            <div className="h-3.5 w-24 bg-surface-200 dark:bg-surface-300 rounded mb-2" />
            <div className="h-6 w-14 bg-surface-200 dark:bg-surface-300 rounded" />
        </div>
    );
}
